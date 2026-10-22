import { createHash } from "node:crypto";
import { PriorityQueue, BoundedQueue } from "./queue.js";
import { VectorStore, distance, compareNeighbors, validateVector, boundedInteger, type Neighbor, type VectorRow } from "./store.js";
import { encode, decode, publish, readCheckpoint } from "./binary.js";

export interface HnswOptions { M?: number; efConstruction?: number; seed?: number }
interface Node { id: string; ordinal: number; links: Set<string>[] }
export class HnswIndex {
  private readonly nodes = new Map<string, Node>();
  private entry?: string;
  private randomState: number;
  private last?: string;
  readonly M: number;
  readonly efConstruction: number;
  constructor(readonly store: VectorStore, options: HnswOptions = {}) {
    this.M = boundedInteger(options.M ?? 16, "M", 2, 128);
    this.efConstruction = boundedInteger(options.efConstruction ?? 128, "efConstruction", this.M, 100000);
    this.randomState = boundedInteger(options.seed ?? 42, "seed", 1, 0xffffffff);
  }
  private level() {
    this.randomState ^= this.randomState << 13; this.randomState ^= this.randomState >>> 17; this.randomState ^= this.randomState << 5;
    this.randomState >>>= 0;
    return Math.min(32, Math.floor(-Math.log((this.randomState + 1) / 4294967297) / Math.log(this.M)));
  }
  private candidate(query: Float32Array, id: string): Neighbor {
    return { id, distance: distance(query, this.store.get(id)!.vector, this.store.metric) };
  }
  private greedy(query: Float32Array, entry: string, layer: number): Neighbor {
    let current = this.candidate(query, entry), changed = true;
    while (changed) {
      changed = false;
      for (const id of this.nodes.get(current.id)!.links[layer] ?? []) {
        const next = this.candidate(query, id);
        if (compareNeighbors(next, current) < 0) { current = next; changed = true; }
      }
    }
    return current;
  }
  private explore(query: Float32Array, entries: string[], ef: number, layer: number): Neighbor[] {
    const candidates = new BoundedQueue<Neighbor>(ef * 2 * this.M, compareNeighbors);
    const best = new PriorityQueue<Neighbor>((a, b) => compareNeighbors(b, a));
    const seen = new Set<string>();
    for (const id of entries) { const row = this.candidate(query, id); candidates.push(row); best.push(row); seen.add(id); }
    while (candidates.size) {
      const current = candidates.pop()!;
      if (best.size >= ef && compareNeighbors(current, best.peek()!) > 0) break;
      for (const id of this.nodes.get(current.id)!.links[layer] ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const row = this.candidate(query, id);
        if (best.size < ef || compareNeighbors(row, best.peek()!) < 0) {
          candidates.push(row); best.push(row);
          if (best.size > ef) best.pop();
        }
      }
    }
    return best.sorted().reverse();
  }
  private select(query: Float32Array, candidates: Neighbor[], limit: number): string[] {
    if (!limit) return [];
    const selected: string[] = [];
    for (const candidate of candidates) {
      if (selected.every(id => distance(this.store.get(candidate.id)!.vector, this.store.get(id)!.vector, this.store.metric) >= candidate.distance)) selected.push(candidate.id);
      if (selected.length === limit) break;
    }
    // Fill unused capacity to retain connectivity on small or duplicate-vector datasets.
    for (const candidate of candidates) { if (selected.length === limit) break; if (!selected.includes(candidate.id)) selected.push(candidate.id); }
    return selected;
  }
  private prune(id: string, layer: number) {
    const node = this.nodes.get(id)!, links = node.links[layer]!, limit = layer === 0 ? 2 * this.M : this.M;
    if (links.size <= limit) return;
    const query = this.store.get(id)!.vector;
    // Retain the insertion chain so pruning equal vectors cannot disconnect the base graph.
    const protectedLinks = layer === 0 ? [...links].filter(other => Math.abs(this.nodes.get(other)!.ordinal - node.ordinal) === 1) : [];
    const kept = new Set([...protectedLinks, ...this.select(query, [...links].filter(other => !protectedLinks.includes(other)).map(other => this.candidate(query, other)).sort(compareNeighbors), limit - protectedLinks.length)]);
    for (const other of links) if (!kept.has(other)) { links.delete(other); this.nodes.get(other)!.links[layer]!.delete(id); }
  }
  add(id: string): void {
    if (this.nodes.has(id)) throw new Error("duplicate HNSW node");
    const row = this.store.get(id);
    if (!row || row.deleted) throw new Error("HNSW insertion requires a live vector");
    const level = this.level(), node: Node = { id, ordinal: this.nodes.size, links: Array.from({ length: level + 1 }, () => new Set()) };
    if (!this.entry) { this.nodes.set(id, node); this.entry = id; this.last = id; return; }
    let entry = this.entry;
    const top = this.nodes.get(entry)!.links.length - 1;
    for (let layer = top; layer > level; layer--) entry = this.greedy(row.vector, entry, layer).id;
    this.nodes.set(id, node);
    for (let layer = Math.min(top, level); layer >= 0; layer--) {
      const candidates = this.explore(row.vector, [entry], this.efConstruction, layer);
      const neighbors = this.select(row.vector, candidates, layer === 0 ? 2 * this.M : this.M);
      for (const other of neighbors) { node.links[layer]!.add(other); this.nodes.get(other)!.links[layer]!.add(id); }
      for (const other of neighbors) this.prune(other, layer);
      this.prune(id, layer);
      if (candidates.length) entry = candidates[0]!.id;
    }
    if (this.last) { node.links[0]!.add(this.last); this.nodes.get(this.last)!.links[0]!.add(id); this.prune(this.last, 0); this.prune(id, 0); }
    this.last = id;
    if (level > top) this.entry = id;
  }
  search(query: ArrayLike<number>, k = 10, efSearch = 64, allow: (row: VectorRow) => boolean = () => true): Neighbor[] {
    boundedInteger(k, "k", 1, 100000); boundedInteger(efSearch, "efSearch", 1, 1000000);
    const vector = validateVector(query, this.store.dimensions, this.store.metric);
    if (!this.entry) return [];
    let entry = this.entry;
    for (let layer = this.nodes.get(entry)!.links.length - 1; layer > 0; layer--) entry = this.greedy(vector, entry, layer).id;
    return this.explore(vector, [entry], Math.max(k, efSearch), 0).filter(hit => { const row = this.store.get(hit.id)!; return !row.deleted && allow(row); }).slice(0, k);
  }
  rebuild() { this.nodes.clear(); this.entry = undefined; this.last = undefined; for (const row of this.store.values()) if (!row.deleted) this.add(row.id); }
  validate() {
    if (!this.nodes.size) {
      if (this.entry !== undefined) throw new Error("empty graph has entry");
      for (const row of this.store.values()) if (!row.deleted) throw new Error("live vector missing from HNSW graph");
      return;
    }
    const entry = this.nodes.get(this.entry!);
    if (!entry) throw new Error("missing HNSW entry");
    for (const node of this.nodes.values()) {
      if (!this.store.get(node.id) || node.links.length > entry.links.length) throw new Error("invalid HNSW node");
      node.links.forEach((links, layer) => {
        if (links.size > (layer === 0 ? 2 * this.M : this.M)) throw new Error("HNSW degree exceeds bound");
        for (const other of links) if (other === node.id || !this.nodes.get(other)?.links[layer]?.has(node.id)) throw new Error("invalid HNSW reciprocal edge");
      });
    }
    for (const row of this.store.values()) if (!row.deleted && !this.nodes.has(row.id)) throw new Error("live vector missing from HNSW graph");
    const ordered = [...this.nodes.values()];
    for (let i = 1; i < ordered.length; i++) if (!ordered[i]!.links[0]!.has(ordered[i - 1]!.id)) throw new Error("HNSW base connectivity invariant failed");
  }
  stats() {
    let edges = 0, maxLevel = -1;
    for (const node of this.nodes.values()) { maxLevel = Math.max(maxLevel, node.links.length - 1); for (const links of node.links) edges += links.size; }
    return { nodes: this.nodes.size, directedEdges: edges, maxLevel, M: this.M, efConstruction: this.efConstruction, vectorBytes: this.store.size * this.store.dimensions * 4 };
  }
  serialize(generation = 0, walSequence?: number) {
    this.validate();
    const rows = [...this.nodes.values()], numbers = new Map(rows.map((row, i) => [row.id, i]));
    let words = rows.length;
    for (const row of rows) for (const links of row.links) words += 1 + links.size;
    const data = Buffer.alloc(words * 4); let offset = 0;
    const write = (value: number) => { data.writeUInt32LE(value, offset); offset += 4; };
    for (const row of rows) { write(row.links.length); for (const links of row.links) { write(links.size); for (const id of links) write(numbers.get(id)!); } }
    return encode({ kind: "hnsw", version: 1, generation, walSequence, M: this.M, efConstruction: this.efConstruction, randomState: this.randomState, entry: this.entry, ids: rows.map(row => row.id), vectors: createHash("sha256").update(this.store.serialize(generation, walSequence)).digest("hex") }, data);
  }
  checkpoint(file: string, generation = 0, walSequence?: number) { publish(file, this.serialize(generation, walSequence)); }
  static deserialize(data: Buffer, store: VectorStore, generation = 0, walSequence?: number) {
    const { metadata, payload } = decode(data);
    const m = metadata as { kind: string; version: number; generation: number; walSequence?: number; M: number; efConstruction: number; randomState: number; entry?: string; ids: string[]; vectors: string };
    if (!m || m.kind !== "hnsw" || m.version !== 1 || m.generation !== generation || m.walSequence !== walSequence || m.vectors !== createHash("sha256").update(store.serialize(generation, walSequence)).digest("hex") || !Array.isArray(m.ids) || new Set(m.ids).size !== m.ids.length || m.ids.length > store.size) throw new Error("incompatible HNSW checkpoint");
    const index = new HnswIndex(store, { M: m.M, efConstruction: m.efConstruction, seed: m.randomState });
    let offset = 0;
    const read = () => { if (offset + 4 > payload.length) throw new Error("truncated HNSW graph"); const value = payload.readUInt32LE(offset); offset += 4; return value; };
    for (const id of m.ids) {
      const levels = boundedInteger(read(), "levels", 1, 33), links: Set<string>[] = [];
      for (let layer = 0; layer < levels; layer++) {
        const count = boundedInteger(read(), "degree", 0, layer === 0 ? 2 * index.M : index.M), neighbors = new Set<string>();
        for (let i = 0; i < count; i++) { const other = m.ids[read()]; if (!other || neighbors.has(other)) throw new Error("invalid HNSW edge"); neighbors.add(other); }
        links.push(neighbors);
      }
      index.nodes.set(id, { id, ordinal: index.nodes.size, links });
    }
    if (offset !== payload.length) throw new Error("unexpected HNSW trailing data");
    index.entry = m.entry; index.last = m.ids.at(-1); index.validate(); return index;
  }
  static open(file: string, store: VectorStore, generation = 0, walSequence?: number) { return HnswIndex.deserialize(readCheckpoint(file), store, generation, walSequence); }
}
