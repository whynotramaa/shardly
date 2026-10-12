import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/engine.js";
import { rankingMetrics } from "./relevance-metrics.js";

const folder = path.resolve(process.argv[2] ?? ".cache/relevance/scifact");
const readLines = (file: string): Record<string, unknown>[] => fs.readFileSync(path.join(folder, file), "utf8").trim().split("\n").map(line => JSON.parse(line));
const corpus = readLines("corpus.jsonl");
const queries = new Map(readLines("queries.jsonl").map(row => [String(row._id), String(row.text)]));
const judgments = new Map<string, Record<string, number>>();
for (const line of fs.readFileSync(path.join(folder, "qrels/test.tsv"), "utf8").trim().split("\n").slice(1)) {
  const [queryId, docId, score] = line.split("\t");
  assert(queryId && docId && Number.isFinite(Number(score)), "invalid qrel");
  const grades = judgments.get(queryId) ?? {};
  grades[docId] = Number(score);
  judgments.set(queryId, grades);
}
assert.equal(corpus.length, 5183, "expected full BEIR SciFact corpus");
assert.equal(judgments.size, 300, "expected all 300 externally judged test queries");
const corpusIds = new Set(corpus.map(row => String(row._id)));
for (const [id, grades] of judgments) {
  assert(queries.has(id));
  assert(Object.keys(grades).every(docId => corpusIds.has(docId)));
  assert(Object.values(grades).some(grade => grade > 0));
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-real-eval-"));
let engine: Engine | undefined;
try {
  engine = new Engine(dir);
  const ingestStart = performance.now();
  // Public scientific abstracts retain their dataset IDs. Labels are never supplied to the engine.
  engine.restoreBackup({ version: 1, documents: corpus.map(row => ({ id: String(row._id), doc: { title: String(row.title), content: String(row.text), source: "scifact" } })) });
  const ingestMs = performance.now() - ingestStart;
  const run = (profile: "baseline" | "tuned") => {
    const cases = [...judgments].map(([queryId, grades]) => {
      const started = performance.now();
      const hits = engine!.search(queries.get(queryId)!, { profile, mode: "any", limit: 10 });
      return { queryId, ...rankingMetrics(hits.hits.map(hit => hit.docId), grades, 10), tookMs: performance.now() - started };
    });
    const times = cases.map(test => test.tookMs).sort((a, b) => a - b);
    return { MRR10: cases.reduce((sum, test) => sum + test.mrr, 0) / cases.length, nDCG10: cases.reduce((sum, test) => sum + test.ndcg, 0) / cases.length, recall10: cases.reduce((sum, test) => sum + test.recall, 0) / cases.length, p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], cases };
  };
  console.log(JSON.stringify({ dataset: "BEIR SciFact", corpusDocuments: corpus.length, judgedQueries: judgments.size, judgments: "External expert-authored annotations distributed by BEIR; no Shardly-authored labels or per-query tuning", mode: "any", cutoff: 10, source: "https://github.com/beir-cellar/beir/wiki/Datasets-available", originalSource: "https://github.com/allenai/scifact", licenses: "SciFact claims/annotations CC BY 4.0; abstracts ODC-By 1.0", domainLimit: "Scientific abstracts and claims, not code navigation or personal document relevance", ingestMs, baseline: run("baseline"), tuned: run("tuned") }, null, 2));
} finally {
  try { engine?.close(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
