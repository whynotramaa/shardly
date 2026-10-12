import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine.js";
import { tokenize, tokenizeDocument } from "../src/search/tokenizer.js";
import { idf } from "../src/search/rank.js";
import { BM25_K1, BM25_B } from "../src/config.js";

const count = Number(process.argv[2] ?? 10000);
assert(Number.isSafeInteger(count) && count >= 100 && count <= 100000, "document count must be 100–100000");
const runs = 20;
const queries = ["checksum integrity", "recovery latency", "vector", "storage", "unfindable"];
const topics = ["checksum integrity", "crash recovery latency", "vector ranking", "storage index", "protocol network", "cache memory", "tokenizer relevance", "snapshot durability", "shard replication", "query document"];
const docs = Array.from({ length: count }, (_, seq) => ({ title: `${topics[seq % topics.length]} ${seq}`, body: `${topics[seq % topics.length]} ${topics[(seq * 7 + 3) % topics.length]} ${"engine implementation benchmark ".repeat(4)}`, seq }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-fts-"));
let engine: Engine | undefined;
try {
  const memoryBefore = process.memoryUsage().heapUsed;
  engine = new Engine(dir);
  const started = performance.now();
  const ids: string[] = [];
  for (let offset = 0; offset < count; offset += 1000) ids.push(...engine.addDocuments(docs.slice(offset, offset + 1000)));
  engine.snapshot();
  const ingestMs = performance.now() - started;
  const heapGrowthBytes = process.memoryUsage().heapUsed - memoryBefore;
  const memoryAtIngest = process.memoryUsage();
  const measure = (profile: "baseline" | "tuned") => queries.map(query => {
    const times: number[] = [];
    let result = engine!.search(query, { profile, limit: 10 });
    for (let run = 0; run < runs + 3; run++) {
      const start = performance.now();
      result = engine!.search(query, { profile, limit: 10 });
      if (run >= 3) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    assert.equal(query === "unfindable" ? result.total : result.hits.length, query === "unfindable" ? 0 : 10);
    return { query, total: result.total, p50Ms: times[Math.floor(runs * .5)], p95Ms: times[Math.min(runs - 1, Math.floor(runs * .95))], ids: result.hits.map(hit => hit.docId) };
  });
  const baseline = measure("baseline");
  const tuned = measure("tuned");
  const prepared = docs.map((doc, i) => {
    const terms = tokenizeDocument(doc);
    const tf = new Map<string, number>();
    for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
    return { id: ids[i]!, length: terms.length, terms, tf };
  });
  const averageLength = prepared.reduce((sum, doc) => sum + doc.length, 0) / count;
  const pretokenizedScan = queries.map((query, index) => {
    const terms = [...new Set(tokenize(query))];
    const idfs = new Map(terms.map(term => [term, idf(count, prepared.filter(doc => doc.tf.has(term)).length)]));
    const times: number[] = [];
    let top: Array<{ id: string; score: number }> = [];
    let total = 0;
    for (let run = 0; run < runs + 3; run++) {
      const started = performance.now();
      top = []; total = 0;
      for (const doc of prepared) {
        let score = 0;
        for (const term of terms) {
          const tf = doc.tf.get(term) ?? 0;
          if (tf) score += idfs.get(term)! * tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * doc.length / averageLength));
        }
        if (!score) continue;
        total++;
        if (top.length < 10 || score >= top.at(-1)!.score) {
          top.push({ id: doc.id, score });
          top.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
          if (top.length > 10) top.pop();
        }
      }
      if (run >= 3) times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    assert.equal(total, baseline[index]!.total);
    assert.deepEqual(top.map(hit => hit.id), baseline[index]!.ids);
    return { query, total, p50Ms: times[Math.floor(runs * .5)], p95Ms: times[Math.min(runs - 1, Math.floor(runs * .95))], topTenMatch: true };
  });
  const input = { runs, documents: prepared.map(doc => ({ id: doc.id, terms: doc.terms.join(" ") })), queries: queries.map(query => ({ query, terms: tokenize(query) })) };
  const python = spawnSync("python3", [fileURLToPath(new URL("./compare-fts.py", import.meta.url))], { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (python.error || python.status !== 0) throw python.error ?? new Error(`SQLite comparison failed: ${python.stderr}`);
  const sqlite = JSON.parse(python.stdout);
  assert.equal(sqlite.results.length, queries.length);
  assert.equal(sqlite.results.at(-1).ids.length, 0);
  engine.close(); engine = undefined;
  const restartStart = performance.now();
  engine = new Engine(dir);
  const restartMs = performance.now() - restartStart;
  assert.equal(engine.documentCount(), count);
  console.log(JSON.stringify({ corpus: "deterministic synthetic topics", count, runs, nodeVersion: process.version, platform: `${process.platform}/${process.arch}`, cpus: os.cpus()[0]?.model, ingestMs, heapGrowthBytes, memoryAtIngest, rssBytes: process.memoryUsage().rss, restartMs, baseline, tuned, pretokenizedScan, sqlite, methodology: "Warm single-process queries, 3 warmups + 20 samples. Pre-tokenized linear scan uses identical baseline BM25 and asserts top-ten agreement. SQLite receives identical pre-tokenized text in an in-memory FTS5 table. Shardly returns documents, snippets and explanations; SQLite returns IDs only. SQLite BM25 constants, IDF floor, tie ordering and field/passage behavior differ; this is not a quality equivalence or universal speed claim. Ingest timings exclude external token preparation for SQLite; heap growth is GC-sensitive. memoryAtIngest includes typed-array allocations in external/arrayBuffers; final RSS covers the Node process only, including scan preparation and reopened engine." }, null, 2));
} finally {
  engine?.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
