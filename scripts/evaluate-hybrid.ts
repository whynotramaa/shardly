import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Engine } from "../src/engine.js";
import { SemanticIndex, fuse } from "../src/search/semantic.js";
import { LocalInference, MockEmbeddings, type EmbeddingProvider } from "../src/vector/providers.js";
import { rankingMetrics } from "./relevance-metrics.js";

const folder = path.resolve(process.argv[2] ?? ".cache/relevance/scifact");
const mock = process.env.MOCK === "1", rerankDepth = Number(process.env.RERANK_DEPTH ?? 20), queryLimit = Number(process.env.QUERY_LIMIT ?? 300);
assert(Number.isSafeInteger(rerankDepth) && rerankDepth >= 0 && rerankDepth <= 100);
assert(Number.isSafeInteger(queryLimit) && queryLimit > 0 && queryLimit <= 300);
const read = (file: string): Record<string, unknown>[] => fs.readFileSync(path.join(folder, file), "utf8").trim().split("\n").map(line => JSON.parse(line));
const corpus = read("corpus.jsonl"), queries = new Map(read("queries.jsonl").map(row => [String(row._id), String(row.text)]));
const judgments = new Map<string, Record<string, number>>();
for (const line of fs.readFileSync(path.join(folder, "qrels/test.tsv"), "utf8").trim().split("\n").slice(1)) {
  const [id, doc, grade] = line.split("\t"); assert(id && doc && Number.isFinite(Number(grade)));
  const grades = judgments.get(id) ?? {}; grades[doc] = Number(grade); judgments.set(id, grades);
}
assert.equal(corpus.length, 5183); assert.equal(judgments.size, 300);
const local = mock ? undefined : new LocalInference({ cacheDir: path.resolve(".cache/models"), offline: process.env.OFFLINE === "1", timeoutMs: 120000 });
const delegate: EmbeddingProvider = local ?? new MockEmbeddings(384);
const queryVectors = new Map<string, Float32Array>();
const provider: EmbeddingProvider = { identity: delegate.identity, dimensions: delegate.dimensions, async embed(texts, signal) { if (texts.length === 1 && queryVectors.has(texts[0]!)) return [queryVectors.get(texts[0]!)!]; return delegate.embed(texts, signal); } };
const directory = path.resolve(process.env.EVAL_DATA_DIR ?? (mock ? ".cache/evaluation-mock" : ".cache/evaluation-local"));
const engine = new Engine(directory), semantic = new SemanticIndex(engine, directory, { provider, hnsw: { M: 16, efConstruction: 128 } });
const metrics = (ids: string[], grades: Record<string, number>) => ({ ndcg10: rankingMetrics(ids, grades, 10).ndcg, recall10: rankingMetrics(ids, grades, 10).recall, recall100: rankingMetrics(ids, grades, 100).recall, mrr10: rankingMetrics(ids, grades, 10).mrr });
const cases: Array<Record<string, unknown>> = [];
try {
  const ingest = performance.now();
  engine.restoreBackup({ version: 1, documents: corpus.map(row => ({ id: String(row._id), doc: { title: String(row.title), content: String(row.text), source: "scifact" } })) });
  const ingestMs = performance.now() - ingest;
  const indexing = performance.now();
  if (semantic.status().indexedGeneration !== engine.retrievalStatus().indexGeneration) { semantic.start(); await semantic.settled(); }
  assert.equal(semantic.status().indexedGeneration, engine.retrievalStatus().indexGeneration, JSON.stringify(semantic.status()));
  const indexingMs = performance.now() - indexing;
  for (const [id, grades] of [...judgments].slice(0, queryLimit)) {
    const query = queries.get(id)!; assert(query);
    const embeddingStart = performance.now(); const [vector] = await delegate.embed([query]); queryVectors.set(query, vector!); const queryEmbeddingMs = performance.now() - embeddingStart;
    const start = performance.now(), lexical = engine.search(query, { mode: "any", limit: 100, profile: "tuned" }), bm25Ms = performance.now() - start;
    const exactStart = performance.now(), exact = await semantic.search(query, {}, 100, undefined, { exact: true }), exactMs = performance.now() - exactStart;
    const annStart = performance.now(), ann = await semantic.search(query, {}, 100, undefined, { efSearch: 256 }), annMs = performance.now() - annStart;
    const fusionStart = performance.now(), hybrid = fuse([lexical.hits.map(hit => ({ documentId: hit.docId, score: hit.score })), ann.hits]).slice(0, 100), fusionMs = performance.now() - fusionStart;
    const rerankStart = performance.now(); let reranked = hybrid;
    if (local && rerankDepth) {
      const selected = hybrid.slice(0, rerankDepth), documents = selected.map(row => { const doc = engine.getDocument(row.documentId)!; return `${doc.title}\n${doc.content}`.slice(0, 12000); });
      const ranked = await local.rerank(query, documents);
      reranked = [...ranked.map(row => selected[row.index]!), ...hybrid.slice(rerankDepth)];
    }
    const rerankMs = performance.now() - rerankStart;
    cases.push({ queryId: id, bm25: { ...metrics(lexical.hits.map(hit => hit.docId), grades), retrievalMs: bm25Ms }, exact: { ...metrics(exact.hits.map(hit => hit.documentId), grades), retrievalMs: exactMs }, hnsw: { ...metrics(ann.hits.map(hit => hit.documentId), grades), retrievalMs: annMs }, hybrid: { ...metrics(hybrid.map(hit => hit.documentId), grades), retrievalMs: bm25Ms + annMs + fusionMs }, ...(local && rerankDepth ? { reranked: { ...metrics(reranked.map(hit => hit.documentId), grades), retrievalMs: bm25Ms + annMs + fusionMs, rerankMs, totalMs: queryEmbeddingMs + bm25Ms + annMs + fusionMs + rerankMs } } : {}), queryEmbeddingMs });
    if (cases.length % 25 === 0) console.error(`evaluated ${cases.length}/${queryLimit}`);
  }
  const modes = ["bm25", "exact", "hnsw", "hybrid", ...(local && rerankDepth ? ["reranked"] : [])];
  const summary = Object.fromEntries(modes.map(mode => {
    const rows = cases.map(row => row[mode] as Record<string, number>), times = rows.map(row => row.retrievalMs!).sort((a, b) => a - b);
    return [mode, { ...Object.fromEntries(["ndcg10", "recall10", "recall100", "mrr10"].map(key => [key, rows.reduce((sum, row) => sum + row[key]!, 0) / rows.length])), p50RetrievalMs: times[Math.floor(times.length * .5)], p95RetrievalMs: times[Math.floor(times.length * .95)] }];
  }));
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), dataset: "BEIR SciFact", split: "test", corpusDocuments: corpus.length, judgedQueries: judgments.size, evaluatedQueries: cases.length, completeEvaluation: cases.length === judgments.size, lexicalProfile: "tuned", model: delegate.identity, reranker: local?.rerankerIdentity, mockWarning: mock ? "Token hashing fixture only; not a semantic relevance evaluation" : undefined, parentDocumentDeduplication: true, rerankDepth, ingestMs, indexingMs, index: semantic.status(), summary, cases }, null, 2));
} finally { await semantic.close(); await local?.close(); engine.close(); }
