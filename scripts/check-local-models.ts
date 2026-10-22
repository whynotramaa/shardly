import assert from "node:assert/strict";
import path from "node:path";
import { LocalInference } from "../src/vector/providers.js";
import { distance } from "../src/vector/store.js";
const cacheDir = path.resolve(process.env.SHARDLY_MODEL_CACHE ?? ".cache/models");
const input = ["a cat sleeps on a sofa", "a feline rests on a couch", "write ahead log transaction recovery"];
const online = new LocalInference({ cacheDir, offline: process.env.OFFLINE === "1" });
let vectors: Float32Array[] = [], ranking: Array<{ index: number; score: number }> = [], onlineMs = 0;
try {
  const started = performance.now(); vectors = await online.embed(input); ranking = await online.rerank("a feline pet", [input[2]!, input[0]!]); onlineMs = performance.now() - started;
  assert(vectors.every(row => row.length === 384 && row.every(Number.isFinite)));
  assert(distance(vectors[0]!, vectors[1]!, "cosine") < distance(vectors[0]!, vectors[2]!, "cosine"));
  assert.equal(ranking[0]!.index, 1);
} finally { await online.close(); }
const offline = new LocalInference({ cacheDir, offline: true });
let offlineMs = 0;
try {
  const started = performance.now(), repeated = await offline.embed(input), ranked = await offline.rerank("a feline pet", [input[2]!, input[0]!]); offlineMs = performance.now() - started;
  repeated.forEach((row, i) => row.forEach((value, j) => assert(Math.abs(value - vectors[i]![j]!) < 1e-6)));
  assert.equal(ranked[0]!.index, 1);
} finally { await offline.close(); }
console.log(JSON.stringify({ timestamp: new Date().toISOString(), node: process.version, embedding: online.identity, reranker: online.rerankerIdentity, dimensions: 384, finite: true, semanticPairCheck: true, ranking, firstLoadAndInferenceMs: onlineMs, offlineLoadAndInferenceMs: offlineMs, offlineRepeatWithinTolerance: 1e-6 }, null, 2));
