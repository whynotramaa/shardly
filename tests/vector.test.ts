import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { VectorStore, distance } from "../src/vector/store.js";
import { HnswIndex } from "../src/vector/hnsw.js";
import { PriorityQueue, BoundedQueue } from "../src/vector/queue.js";
const meta = { documentId: "parent", revision: "v1", field: "content", start: 0, end: 10, inputHash: "hash" };
export function randomVectors(count: number, dimensions: number, seed = 7) {
  let state = seed;
  return Array.from({ length: count }, () => Float32Array.from({ length: dimensions }, () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 - .5; }));
}
it("orders a heap without losing duplicate priorities", () => {
  const queue = new PriorityQueue<number>((a, b) => a - b);
  for (const n of [4, 0, 8, 2, 2, 1]) queue.push(n);
  expect(Array.from({ length: 6 }, () => queue.pop())).toEqual([0, 1, 2, 2, 4, 8]);
  expect(queue.pop()).toBeUndefined();
});
it("bounds candidate storage while preserving the best priorities across evictions", () => {
  const queue = new BoundedQueue<number>(5, (a, b) => a - b);
  for (let round = 0; round < 20; round++) {
    for (let value = 30; value >= 0; value--) queue.push(value);
    expect(queue.size).toBe(5);
    expect(Array.from({ length: 5 }, () => queue.pop())).toEqual([0, 1, 2, 3, 4]);
  }
});
it("validates vectors, metrics, batch atomicity, replacement and tombstones", () => {
  const x = new Float32Array([3, 4]), y = new Float32Array([0, 4]);
  expect(distance(x, y, "cosine")).toBeCloseTo(.2);
  expect(distance(x, y, "dot")).toBe(-16); expect(distance(x, y, "l2")).toBe(9);
  const store = new VectorStore(2, "fixture@1");
  for (const bad of [[1], [0, 0], [NaN, 1], [Infinity, 1], [1e40, 1]]) expect(() => store.insert("bad", bad, meta)).toThrow();
  expect(() => store.insertBatch([{ id: "a", vector: [1, 0], metadata: meta }, { id: "b", vector: [1], metadata: meta }])).toThrow();
  expect(store.size).toBe(0);
  store.insert("a", [1, 0], meta); expect(() => store.insert("a", [1, 0], meta)).toThrow();
  store.replace("a", [0, 1], meta); expect(store.exact([0, 1])[0]?.distance).toBeCloseTo(0);
  store.delete("a"); expect(store.exact([0, 1])).toEqual([]);
  const reopened = VectorStore.deserialize(store.serialize(12)); expect(reopened.generation).toBe(12); expect(reopened.store.get("a")?.deleted).toBe(true);
  const damaged = store.serialize(); damaged[30] = damaged[30]! ^ 1;
  expect(() => VectorStore.deserialize(damaged)).toThrow(/checksum/);
});
it("builds reciprocal bounded layers and has reproducible recall against exact search", () => {
  const vectors = randomVectors(600, 24), store = new VectorStore(24, "random@1"), graph = new HnswIndex(store, { M: 12, efConstruction: 100 });
  vectors.forEach((vector, i) => { store.insert(String(i), vector, meta); graph.add(String(i)); });
  graph.validate(); expect(graph.stats().maxLevel).toBeGreaterThan(0);
  let correct = 0;
  for (const query of randomVectors(30, 24, 123)) {
    const truth = new Set(store.exact(query, 10).map(hit => hit.id));
    correct += graph.search(query, 10, 100).filter(hit => truth.has(hit.id)).length;
  }
  expect(correct / 300).toBeGreaterThan(.9);
  const reopened = HnswIndex.deserialize(graph.serialize(5), store, 5); reopened.validate();
  expect(reopened.search(vectors[0]!, 10, 80)).toEqual(graph.search(vectors[0]!, 10, 80));
  store.delete("0"); expect(graph.search(vectors[0]!, 10, 100).some(hit => hit.id === "0")).toBe(false);
  expect(graph.search(vectors[1]!, 10, 100, row => row.id === "1").map(hit => hit.id)).toEqual(["1"]);
  const damaged = graph.serialize(5); damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
  expect(() => HnswIndex.deserialize(damaged, store, 5)).toThrow();
});
it("publishes binary checkpoints and ignores incomplete temporary files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-vectors-"));
  try {
    const file = path.join(dir, "vectors.bin"), store = new VectorStore(2, "fixture@1");
    store.insert("a", [1, 0], meta); store.checkpoint(file, 7);
    fs.writeFileSync(file + ".interrupted.tmp", "partial");
    expect(VectorStore.open(file).store.exact([1, 0])[0]?.id).toBe("a");
    fs.truncateSync(file, 20); expect(() => VectorStore.open(file)).toThrow();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
it("handles empty and identical-vector indexes deterministically", () => {
  const store = new VectorStore(2, "fixture"), graph = new HnswIndex(store, { M: 4 });
  expect(graph.search([1, 0])).toEqual([]); graph.validate();
  for (let i = 0; i < 80; i++) { store.insert(String(i).padStart(3, "0"), [1, 0], meta); graph.add(String(i).padStart(3, "0")); }
  graph.validate(); expect(graph.search([1, 0], 10, 100)).toEqual(store.exact([1, 0], 10));
});
it.each(["cosine", "dot", "l2"] as const)("matches the exact baseline at exhaustive exploration for %s", metric => {
  const store = new VectorStore(8, "fixture", metric), graph = new HnswIndex(store, { M: 8, efConstruction: 40 });
  randomVectors(150, 8).forEach((vector, i) => { store.insert(String(i), vector, meta); graph.add(String(i)); });
  graph.validate();
  for (const query of randomVectors(5, 8, 1234)) expect(graph.search(query, 10, 150)).toEqual(store.exact(query, 10));
});
it("selects exact parent results before applying the final limit", () => {
  const store = new VectorStore(2, "fixture");
  for (let i = 0; i < 30; i++) store.insert(String(i), [1, .001 * i], { ...meta, documentId: "a" });
  store.insert("other", [0, 1], { ...meta, documentId: "b" });
  expect(store.exact([1, 0], 2, () => true, row => row.documentId).map(hit => store.get(hit.id)!.documentId)).toEqual(["a", "b"]);
});
it("binds vector and graph checkpoints to the same WAL watermark", () => {
  const store = new VectorStore(2, "fixture"); store.insert("a", [1, 0], meta);
  const graph = new HnswIndex(store); graph.add("a");
  expect(VectorStore.deserialize(store.serialize(7, 42)).walSequence).toBe(42);
  expect(() => HnswIndex.deserialize(graph.serialize(7, 42), store, 7, 41)).toThrow(/incompatible/);
  expect(HnswIndex.deserialize(graph.serialize(7, 42), store, 7, 42).search([1, 0])[0]?.id).toBe("a");
});
it("rejects an empty checkpoint when live vectors have not been indexed", () => {
  const store = new VectorStore(2, "fixture"); store.insert("a", [1, 0], meta);
  expect(() => new HnswIndex(store).serialize()).toThrow(/missing/);
});
