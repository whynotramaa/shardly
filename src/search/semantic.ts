import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { RuntimeEngine } from "../runtime/engine.js";
import type { SearchOptions } from "../types.js";
import { ANALYSIS_VERSION, blocks, chunkHash } from "./evidence.js";
import { documentFields } from "./tokenizer.js";

interface VectorRecord { id: string; documentId: string; revision: string; field: string; start: number; end: number; inputHash: string; vector: number[] }
interface Cache { version: 1; config: string; generation: number; dimensions: number; records: VectorRecord[] }
export interface SemanticConfig { url?: string; model?: string; revision?: string; token?: string; rerankUrl?: string; rerankModel?: string; rerankToken?: string }

async function jsonRequest(url: string, body: unknown, token?: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "error" });
  if (!response.ok || !response.body) throw new Error("inference provider rejected the request");
  const chunks: Uint8Array[] = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error("inference response exceeds its budget"); } chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function normalize(vector: unknown): number[] {
  if (!Array.isArray(vector) || !vector.length || vector.length > 4096 || vector.some(n => typeof n !== "number" || !Number.isFinite(n))) throw new Error("invalid embedding vector");
  const magnitude = Math.hypot(...vector as number[]);
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error("embedding vector has invalid magnitude");
  return (vector as number[]).map(n => n / magnitude);
}

export function fuse(lists: Array<Array<{ documentId: string; score: number }>>, method: "rrf" | "weighted" = "rrf", alpha = 0.5): Array<{ documentId: string; score: number }> {
  const scores = new Map<string, number>();
  lists.forEach((list, leg) => {
    const seen = new Set<string>(), values = list.map(hit => hit.score), min = Math.min(...values), max = Math.max(...values);
    list.forEach((hit, rank) => {
      if (seen.has(hit.documentId)) return;
      seen.add(hit.documentId);
      const contribution = method === "rrf" ? 1 / (60 + rank + 1) : (leg === 0 ? 1 - alpha : alpha) * (max === min ? 1 : (hit.score - min) / (max - min));
      scores.set(hit.documentId, (scores.get(hit.documentId) ?? 0) + contribution);
    });
  });
  return [...scores].map(([documentId, score]) => ({ documentId, score })).sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId));
}

export class SemanticIndex {
  private cache: Cache;
  private readonly file: string;
  private controller?: AbortController;
  private running?: Promise<void>;
  private progress: { state: string; processed: number; total: number; error?: string } = { state: "idle", processed: 0, total: 0 };
  readonly config: SemanticConfig;
  private readonly fingerprint: string;
  constructor(private engine: RuntimeEngine, directory: string, config?: SemanticConfig) {
    this.config = config ?? { url: process.env.SHARDLY_EMBEDDING_URL, model: process.env.SHARDLY_EMBEDDING_MODEL, revision: process.env.SHARDLY_EMBEDDING_REVISION, token: process.env.SHARDLY_EMBEDDING_TOKEN, rerankUrl: process.env.SHARDLY_RERANK_URL, rerankModel: process.env.SHARDLY_RERANK_MODEL, rerankToken: process.env.SHARDLY_RERANK_TOKEN };
    for (const value of [this.config.url, this.config.rerankUrl]) if (value) { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("inference URL must be HTTP without embedded credentials"); }
    this.fingerprint = createHash("sha256").update(JSON.stringify([ANALYSIS_VERSION, this.config.url, this.config.model, this.config.revision, "title-heading-passage-1"])).digest("hex");
    this.file = path.join(directory, "index", "semantic.json");
    this.cache = { version: 1, config: this.fingerprint, generation: -1, dimensions: 0, records: [] };
    try {
      if (fs.statSync(this.file).size > 128 * 1024 * 1024) throw new Error("cache too large");
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8")) as Cache;
      if (saved.version !== 1 || saved.config !== this.fingerprint || !Array.isArray(saved.records) || saved.records.length > 20000 || !Number.isSafeInteger(saved.dimensions) || saved.dimensions < 1 || saved.dimensions > 4096 || saved.records.length * saved.dimensions > 4_000_000) throw new Error("incompatible cache");
      for (const row of saved.records) { if (typeof row.id !== "string" || typeof row.documentId !== "string" || typeof row.revision !== "string" || typeof row.field !== "string" || !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end) || row.start < 0 || row.end < row.start || row.vector?.length !== saved.dimensions) throw new Error("invalid cached passage"); normalize(row.vector); }
      this.cache = saved;
    } catch { /* Derived cache corruption never blocks lexical search. */ }
  }
  status() { return { enabled: !!(this.config.url && this.config.model), model: this.config.model, modelRevision: this.config.revision, indexedGeneration: this.cache.generation, passages: this.cache.records.length, dimensions: this.cache.dimensions, rerankerEnabled: !!this.config.rerankUrl, ...this.progress }; }
  async embeddings(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.url || !this.config.model) throw new Error("semantic retrieval is not configured");
    const ollama = new URL(this.config.url).pathname.endsWith("/api/embed");
    const result = await jsonRequest(this.config.url, { model: this.config.model, input: texts, ...(ollama ? { truncate: false } : {}) }, this.config.token, signal);
    const data = ollama ? result.embeddings : Array.isArray(result.data) ? [...result.data].sort((a, b) => (a as {index:number}).index - (b as {index:number}).index).map(row => (row as {embedding:unknown}).embedding) : undefined;
    if (!Array.isArray(data) || data.length !== texts.length) throw new Error("inference returned an invalid embedding batch");
    const vectors = data.map(normalize);
    if (vectors.some(v => v.length !== vectors[0]!.length)) throw new Error("inference returned inconsistent dimensions");
    return vectors;
  }
  start(): ReturnType<SemanticIndex["status"]> {
    if (this.running) return this.status();
    if (!this.config.url || !this.config.model) throw Object.assign(new Error("configure an embedding endpoint and model first"), { statusCode: 400 });
    this.controller = new AbortController();
    this.progress = { state: "running", processed: 0, total: 0 };
    this.running = this.rebuild(this.controller.signal).catch(error => { this.progress.state = this.controller?.signal.aborted ? "cancelled" : "failed"; this.progress.error = error instanceof Error && error.message.startsWith("semantic ") ? error.message : "Semantic indexing failed; check provider availability and resource limits."; }).finally(() => { this.running = undefined; });
    return this.status();
  }
  cancel() { this.controller?.abort(); return this.status(); }
  async close() { this.cancel(); await this.running; }
  async settled() { await this.running; }
  private async rebuild(signal: AbortSignal) {
    const generation = (await this.engine.retrievalStatus()).indexGeneration;
    const records: VectorRecord[] = [], old = new Map(this.cache.records.map(row => [row.inputHash, row.vector]));
    let dimensions = 0;
    for (let offset = 0; ; offset += 100) {
      signal.throwIfAborted();
      const batch = await this.engine.retrievalManifest({}, offset, 100);
      if (batch.indexGeneration !== generation) throw new Error("semantic index changed during backfill; retry");
      this.progress.total = batch.total;
      for (const { id, revision, doc } of batch.items) {
        const fields = new Map(documentFields(doc).map(f => [f.field, f.text]));
        const chunks = blocks(doc).filter(b => !["source", "repo", "type", "language", "sourceId", "path", "filename", "pageOffsets"].includes(b.field));
        for (let at = 0; at < chunks.length; at += 16) {
          signal.throwIfAborted();
          const local = chunks.slice(at, at + 16).map(block => {
            const input = `${String(doc.title ?? doc.filename ?? "").slice(0, 512)}\n${block.heading ?? ""}\n${fields.get(block.field)!.slice(block.start, block.end)}`;
            return { block, input, inputHash: createHash("sha256").update(input).digest("hex") };
          });
          const missing = local.filter(row => !old.has(row.inputHash));
          const embedded = missing.length ? await this.embeddings(missing.map(row => row.input), signal) : [];
          missing.forEach((row, i) => old.set(row.inputHash, embedded[i]!));
          for (const row of local) {
            const vector = old.get(row.inputHash)!;
            dimensions ||= vector.length;
            if (vector.length !== dimensions) throw new Error("semantic model dimension changed during indexing");
            if ((records.length + 1) * dimensions > 4_000_000) throw new Error("semantic index exceeds vector memory budget");
            records.push({ id: chunkHash(revision, row.block), documentId: id, revision, field: row.block.field, start: row.block.start, end: row.block.end, inputHash: row.inputHash, vector });
            if (records.length > 20000) throw new Error("semantic index exceeds 20000-passage exact-search budget");
          }
        }
        this.progress.processed++;
        await yieldTurn();
      }
      if (offset + batch.items.length >= batch.total) break;
    }
    if ((await this.engine.retrievalStatus()).indexGeneration !== generation) throw new Error("semantic index changed during backfill; retry");
    signal.throwIfAborted();
    const next: Cache = { version: 1, config: this.fingerprint, generation, dimensions, records };
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 128 * 1024 * 1024) throw new Error("semantic index exceeds cache byte budget");
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    const dir = fs.openSync(path.dirname(this.file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    this.cache = next; this.progress.state = "completed";
  }
  async search(query: string, options: SearchOptions, limit = 100, signal?: AbortSignal) {
    const versions = await this.engine.retrievalVersions(options), allowed = new Map(versions.items.map(item => [item.id, item.revision]));
    if (!this.cache.records.length) return { hits: [], complete: versions.items.length === 0, generation: versions.indexGeneration };
    const [vector] = await this.embeddings([query], signal);
    if (vector!.length !== this.cache.dimensions) throw new Error("semantic model dimension changed; rebuild embeddings");
    const best = new Map<string, { documentId: string; score: number; record: VectorRecord }>();
    for (let i = 0; i < this.cache.records.length; i++) {
      if (i % 256 === 0) { await yieldTurn(); signal?.throwIfAborted(); }
      const record = this.cache.records[i]!;
      if (allowed.get(record.documentId) !== record.revision) continue;
      const score = record.vector.reduce((sum, value, j) => sum + value * vector![j]!, 0);
      if (score > (best.get(record.documentId)?.score ?? -Infinity)) best.set(record.documentId, { documentId: record.documentId, score, record });
    }
    return { hits: [...best.values()].sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId)).slice(0, limit), complete: this.cache.generation === versions.indexGeneration, generation: versions.indexGeneration };
  }
  async rerank(query: string, documents: string[], signal?: AbortSignal): Promise<Array<{ index: number; score: number }>> {
    if (!this.config.rerankUrl) throw new Error("reranker is not configured");
    const result = await jsonRequest(this.config.rerankUrl, { model: this.config.rerankModel, query, documents, top_n: documents.length }, this.config.rerankToken, signal);
    const rows = result.results as Array<{ index: number; relevance_score: number }>;
    if (!Array.isArray(rows) || rows.length !== documents.length || new Set(rows.map(r => r.index)).size !== rows.length || rows.some(r => !Number.isSafeInteger(r.index) || r.index < 0 || r.index >= documents.length || !Number.isFinite(r.relevance_score))) throw new Error("invalid reranker candidate mapping");
    return rows.map(r => ({ index: r.index, score: r.relevance_score })).sort((a, b) => b.score - a.score || a.index - b.index);
  }
}
