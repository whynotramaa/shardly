import assert from "node:assert/strict";
import os from "node:os";
import { VectorStore } from "../src/vector/store.js";
import { HnswIndex } from "../src/vector/hnsw.js";

const sizes = (process.env.SIZES ?? "10000").split(",").map(Number), dimensions = Number(process.env.DIMENSIONS ?? 64);
const configurations = (process.env.M_VALUES ?? "12").split(",").map(Number), constructionValues = (process.env.CONSTRUCTION_VALUES ?? "80").split(",").map(Number);
const exploration = (process.env.EF_VALUES ?? "32,128,512").split(",").map(Number), queries = Number(process.env.QUERIES ?? 30);
assert(Number.isSafeInteger(queries) && queries > 0 && queries <= 10000);
let randomState = 12345;
function vector() { return Float32Array.from({ length: dimensions }, () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296 - .5; }); }
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!;
const latency = (values: number[]) => ({ p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99) });
const reports = [];
for (const count of sizes) for (const M of configurations) for (const efConstruction of constructionValues) {
  assert(Number.isSafeInteger(count) && count > 0 && count <= 1000000);
  randomState = 12345;
  const store = new VectorStore(dimensions, "synthetic-uniform-12345"), graph = new HnswIndex(store, { M, efConstruction, seed: 42 });
  const before = process.memoryUsage(), started = performance.now();
  for (let i = 0; i < count; i++) {
    const id = String(i); store.insert(id, vector(), { documentId: id, revision: "1", field: "content", start: 0, end: 1, inputHash: id }); graph.add(id);
  }
  const buildMs = performance.now() - started; graph.validate();
  const memory = process.memoryUsage(), test = Array.from({ length: queries }, vector), exactMs: number[] = [];
  const truth = test.map(query => { const start = performance.now(); const result = store.exact(query, Math.min(100, count)); exactMs.push(performance.now() - start); return result; });
  const runs = exploration.map(efSearch => {
    const times: number[] = [], recalls = { at1: 0, at10: 0, at100: 0 };
    // Warm graph traversal separately from measured queries.
    graph.search(test[0]!, Math.min(100, count), efSearch);
    test.forEach((query, i) => {
      const start = performance.now(), hits = graph.search(query, Math.min(100, count), efSearch); times.push(performance.now() - start);
      for (const k of [1, 10, 100] as const) {
        const expected = new Set(truth[i]!.slice(0, k).map(row => row.id));
        recalls[`at${k}`] += hits.slice(0, k).filter(row => expected.has(row.id)).length / expected.size;
      }
    });
    return { efSearch, effectiveEfSearch: Math.max(Math.min(100, count), efSearch), recall1: recalls.at1 / queries, recall10: recalls.at10 / queries, recall100: recalls.at100 / queries, ...latency(times) };
  });
  const vectorBytes = store.serialize().length, graphBytes = graph.serialize().length;
  reports.push({ count, dimensions, M, efConstruction, queries, buildMs, vectorsPerSecond: count / (buildMs / 1000), memory: { before, after: memory, rssDelta: memory.rss - before.rss, note: "Process memory; GC and allocator retention affect deltas across configurations" }, serializedVectorBytes: vectorBytes, serializedGraphBytes: graphBytes, exact: latency(exactMs), runs });
}
console.log(JSON.stringify({ timestamp: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, metric: "cosine", data: "deterministic uniform random coordinates, no embedding inference", reports }, null, 2));
