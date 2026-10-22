import { encode, decode, publish, readCheckpoint } from "./binary.js";
import { TopHeap } from "../search/heap.js";

export type Metric = "cosine" | "dot" | "l2";
export interface VectorMetadata { documentId: string; revision: string; field: string; start: number; end: number; inputHash: string }
export interface VectorRow extends VectorMetadata { id: string; vector: Float32Array; deleted: boolean }
export interface Neighbor { id: string; distance: number }
export const compareNeighbors = (a: Neighbor, b: Neighbor) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function validateVector(vector: ArrayLike<number>, dimensions: number, metric: Metric): Float32Array {
  if (vector.length !== dimensions) throw new Error("embedding dimension mismatch");
  const result = Float32Array.from(vector);
  let norm = 0;
  for (const n of result) { if (!Number.isFinite(n)) throw new Error("embedding must contain finite Float32 values"); norm += n * n; }
  if (metric === "cosine" && !norm) throw new Error("cosine embedding must be nonzero");
  return result;
}
/** All metrics use ascending distance. L2 is squared Euclidean distance. */
export function distance(a: Float32Array, b: Float32Array, metric: Metric): number {
  let dot = 0, aa = 0, bb = 0, l2 = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (metric === "l2") l2 += (x - y) ** 2;
    else { dot += x * y; if (metric === "cosine") { aa += x * x; bb += y * y; } }
  }
  return metric === "l2" ? l2 : metric === "dot" ? -dot : 1 - Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}
export function boundedInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}
export class VectorStore {
  private readonly rows = new Map<string, VectorRow>();
  constructor(readonly dimensions: number, readonly model: string, readonly metric: Metric = "cosine") {
    boundedInteger(dimensions, "dimensions", 1, 65536);
    if (typeof model !== "string" || !model || model.length > 4096 || !["cosine", "dot", "l2"].includes(metric)) throw new Error("invalid vector model or metric");
  }
  get size() { return this.rows.size; }
  values() { return this.rows.values(); }
  get(id: string) { return this.rows.get(id); }
  insert(id: string, vector: ArrayLike<number>, metadata: VectorMetadata): void {
    if (this.rows.has(id)) throw new Error("duplicate vector id");
    this.put(id, vector, metadata);
  }
  replace(id: string, vector: ArrayLike<number>, metadata: VectorMetadata): void {
    if (!this.rows.has(id)) throw new Error("unknown vector id");
    this.put(id, vector, metadata);
  }
  private put(id: string, vector: ArrayLike<number>, metadata: VectorMetadata) {
    if (!id || id.length > 512 || !metadata || typeof metadata.documentId !== "string" || !metadata.documentId || typeof metadata.revision !== "string" || typeof metadata.field !== "string" || typeof metadata.inputHash !== "string" || !Number.isSafeInteger(metadata.start) || !Number.isSafeInteger(metadata.end) || metadata.start < 0 || metadata.end < metadata.start) throw new Error("invalid vector metadata");
    this.rows.set(id, { ...metadata, id, vector: validateVector(vector, this.dimensions, this.metric), deleted: false });
  }
  insertBatch(rows: Array<{ id: string; vector: ArrayLike<number>; metadata: VectorMetadata }>): void {
    const staged = new VectorStore(this.dimensions, this.model, this.metric);
    for (const row of rows) { if (this.rows.has(row.id)) throw new Error("duplicate vector id"); staged.insert(row.id, row.vector, row.metadata); }
    for (const row of staged.values()) this.rows.set(row.id, row);
  }
  delete(id: string): boolean { const row = this.rows.get(id); if (!row || row.deleted) return false; row.deleted = true; return true; }
  exact(query: ArrayLike<number>, k = 10, allow: (row: VectorRow) => boolean = () => true, groupBy?: (row: VectorRow) => string): Neighbor[] {
    boundedInteger(k, "k", 1, 100000);
    const vector = validateVector(query, this.dimensions, this.metric), heap = new TopHeap<Neighbor>(k, compareNeighbors);
    const grouped = new Map<string, Neighbor>();
    for (const row of this.rows.values()) if (!row.deleted && allow(row)) {
      const hit = { id: row.id, distance: distance(vector, row.vector, this.metric) };
      if (!groupBy) heap.offer(hit);
      else { const key = groupBy(row), previous = grouped.get(key); if (!previous || compareNeighbors(hit, previous) < 0) grouped.set(key, hit); }
    }
    for (const hit of grouped.values()) heap.offer(hit);
    return heap.sorted();
  }
  serialize(generation = 0, walSequence?: number): Buffer {
    boundedInteger(generation, "generation", 0, Number.MAX_SAFE_INTEGER);
    if (walSequence !== undefined) boundedInteger(walSequence, "WAL sequence", 0, Number.MAX_SAFE_INTEGER);
    const rows = [...this.rows.values()];
    const payload = Buffer.alloc(rows.length * this.dimensions * 4);
    let offset = 0;
    for (const row of rows) for (const value of row.vector) { payload.writeFloatLE(value, offset); offset += 4; }
    return encode({ kind: "vectors", version: 1, dimensions: this.dimensions, model: this.model, metric: this.metric, generation, walSequence, rows: rows.map(({ vector: _, ...row }) => row) }, payload);
  }
  checkpoint(file: string, generation = 0, walSequence?: number) { publish(file, this.serialize(generation, walSequence)); }
  static deserialize(data: Buffer): { store: VectorStore; generation: number; walSequence?: number } {
    const decoded = decode(data);
    const meta = decoded.metadata as { kind: string; version: number; dimensions: number; model: string; metric: Metric; generation: number; walSequence?: number; rows: Array<Omit<VectorRow, "vector">> };
    if (!meta || meta.kind !== "vectors" || meta.version !== 1 || !Array.isArray(meta.rows)) throw new Error("invalid vector checkpoint metadata");
    boundedInteger(meta.generation, "generation", 0, Number.MAX_SAFE_INTEGER);
    if (meta.walSequence !== undefined) boundedInteger(meta.walSequence, "WAL sequence", 0, Number.MAX_SAFE_INTEGER);
    const store = new VectorStore(meta.dimensions, meta.model, meta.metric);
    if (decoded.payload.length !== meta.rows.length * meta.dimensions * 4) throw new Error("invalid vector payload size");
    let offset = 0;
    for (const row of meta.rows) {
      if (typeof row.deleted !== "boolean") throw new Error("invalid vector tombstone");
      const vector = new Float32Array(meta.dimensions);
      for (let j = 0; j < vector.length; j++) { vector[j] = decoded.payload.readFloatLE(offset); offset += 4; }
      store.insert(row.id, vector, row); if (row.deleted) store.delete(row.id);
    }
    return { store, generation: meta.generation, walSequence: meta.walSequence };
  }
  static open(file: string) { return VectorStore.deserialize(readCheckpoint(file)); }
}
