// Builds a real mixed corpus (this repo's code and docs plus the bundled
// Wikipedia sample), runs the real Engine, and records everything the film
// shows: results, tokens, posting lists, BM25 terms and the storage offset.
// No numbers in the film are invented.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/engine.js";
import { tokenize, tokenizeDetailed } from "../../src/search/tokenizer.js";

const root = path.resolve(import.meta.dirname, "../..");
const query = process.argv[2] ?? "crash recovery";
const identifier = "replayWalRecord";
const code = [...fs.globSync("src/**/*.ts", { cwd: root }), ...fs.globSync("tests/**/*.ts", { cwd: root }), ...fs.globSync("scripts/*.ts", { cwd: root })];
const docs = fs.globSync("*.md", { cwd: root });
const wiki = fs.readFileSync(path.join(root, "corpus/wikipedia.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-video-"));
const engine = new Engine(dir);
try {
  engine.ingestDocuments([
    ...code.map((file) => ({ title: path.basename(file), path: file, content: fs.readFileSync(path.join(root, file), "utf8"), source: "folder", type: "code", language: "typescript", sourceId: `video:${file}` })),
    ...docs.map((file) => ({ title: path.basename(file), path: file, content: fs.readFileSync(path.join(root, file), "utf8"), source: "folder", type: "markdown", sourceId: `video:${file}` })),
    ...wiki,
  ]);
  const res = engine.search(query, { limit: 4, inspect: true, mode: "all" });
  const base = engine.search(query, { limit: 4, profile: "baseline", mode: "all" });
  const index = (engine as unknown as { index: { documentFrequency(t: string): number; postingEntries(t: string): Iterable<{ docId: string; termFrequency: number }> } }).index;
  const storage = (engine as unknown as { storage: { offsetIndex: Map<string, { segment: string; byteOffset: number; length: number }> } }).storage;
  const titleOf = (id: string) => String(engine.getDocument(id)?.title ?? id);
  const terms = [...new Set(tokenize(query))];
  const postings = terms.map((term) => {
    const entries = [...index.postingEntries(term)].sort((a, b) => b.termFrequency - a.termFrequency);
    return { term, df: index.documentFrequency(term), top: entries.slice(0, 6).map((e) => ({ title: titleOf(e.docId), tf: e.termFrequency })) };
  });
  // A readable ~64 character window around the first matched term, for the result row.
  const lineOf = (doc: Record<string, unknown>) => {
    const lines = String(doc.content ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const has = (l: string, w: string) => tokenize(l).includes(w);
    const line = lines.find((l) => terms.every((w) => has(l, w))) ?? lines.find((l) => terms.some((w) => has(l, w))) ?? "";
    const at = Math.max(0, line.toLowerCase().search(new RegExp(terms.join("|"))) - 18);
    const cut = line.slice(at, at + 64);
    return (at > 0 ? "…" : "") + cut + (line.length > at + 64 ? "…" : "");
  };
  const topId = res.hits[0]!.docId;
  const offset = storage.offsetIndex.get(topId)!;
  const out = {
    query,
    documents: engine.documentCount(),
    mix: { code: code.length, docs: docs.length, wikipedia: wiki.length },
    queryTerms: terms,
    identifier: { text: identifier, tokens: [...new Set(tokenizeDetailed(identifier).map((t) => t.term))] },
    tookMs: res.tookMs,
    total: res.total,
    candidates: res.inspector?.candidateCount,
    postingReads: res.inspector?.postingReads,
    hits: res.hits.map((h) => ({ title: String(h.doc.title), path: String(h.doc.path ?? h.doc.url ?? ""), type: String(h.doc.type ?? ""), score: h.score, line: lineOf(h.doc) })),
    baseline: base.hits.map((h) => ({ title: String(h.doc.title), score: h.score, breakdown: h.breakdown.map((b) => ({ term: b.term, tf: b.termFrequency, idf: b.idf, contribution: b.contribution })) })),
    postings,
    storage: { segment: offset.segment, byteOffset: offset.byteOffset, length: offset.length },
  };
  fs.writeFileSync(path.join(root, "video/search-data.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally { engine.close(); fs.rmSync(dir, { recursive: true, force: true }); }
