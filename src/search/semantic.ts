import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { RuntimeEngine } from "../runtime/engine.js";
import type { SearchOptions } from "../types.js";
import { documentFields } from "./tokenizer.js";
import { chunkDocument, type ChunkOptions } from "./chunker.js";
import { VectorStore, validateVector, boundedInteger, type Metric, type VectorRow } from "../vector/store.js";
import { HnswIndex, type HnswOptions } from "../vector/hnsw.js";
import { LocalInference, withAbort, type EmbeddingProvider, type Reranker } from "../vector/providers.js";
import { encode, decode, publish, readCheckpoint } from "../vector/binary.js";

export interface SemanticConfig {
  url?: string; model?: string; revision?: string; token?: string;
  rerankUrl?: string; rerankModel?: string; rerankRevision?: string; rerankToken?: string;
  provider?: EmbeddingProvider; reranker?: Reranker; local?: boolean; offline?: boolean; cacheDir?: string;
  dimensions?: number; metric?: Metric; chunks?: ChunkOptions; hnsw?: HnswOptions; efSearch?: number;
}
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

export function fuse(lists: Array<Array<{ documentId: string; score: number }>>, method: "rrf" | "weighted" = "rrf", alpha = 0.5, options: { constant?: number; weights?: number[] } = {}): Array<{ documentId: string; score: number }> {
  const constant = options.constant ?? 60, weights = options.weights ?? lists.map(() => 1);
  if (!Number.isFinite(constant) || constant < 1 || weights.length !== lists.length || weights.some(n => !Number.isFinite(n) || n < 0)) throw new Error("invalid RRF configuration");
  const scores = new Map<string, number>();
  lists.forEach((list, leg) => {
    const seen = new Set<string>(), values = list.map(hit => hit.score), min = Math.min(...values), max = Math.max(...values);
    list.forEach((hit, rank) => {
      if (seen.has(hit.documentId)) return;
      seen.add(hit.documentId);
      const contribution = method === "rrf" ? weights[leg]! / (constant + rank + 1) : (leg === 0 ? 1 - alpha : alpha) * (max === min ? 1 : (hit.score - min) / (max - min));
      if (!contribution) return;
      scores.set(hit.documentId, (scores.get(hit.documentId) ?? 0) + contribution);
    });
  });
  return [...scores].map(([documentId, score]) => ({ documentId, score })).sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId));
}

export class SemanticIndex {
  private store?: VectorStore;
  private graph?: HnswIndex;
  private graphStatistics?: ReturnType<HnswIndex["stats"]>;
  private generation = -1;
  private walSequence?: number;
  private jobGeneration = -1;
  private readonly file: string;
  private readonly graphFile: string;
  private readonly progressFile: string;
  private readonly jobFile: string;
  private controller?: AbortController;
  private running?: Promise<void>;
  private local?: LocalInference;
  private provider?: EmbeddingProvider;
  private reranker?: Reranker;
  private progress: { state: string; processed: number; total: number; error?: string } = { state: "idle", processed: 0, total: 0 };
  private recoveryMs = 0;
  private indexingMs = 0;
  private searchMs = 0;
  private embeddingMs = 0;
  private rerankingMs = 0;
  private checkpointError?: string;
  readonly config: SemanticConfig;
  private readonly fingerprint: string;
  constructor(private engine: RuntimeEngine, directory: string, config?: SemanticConfig) {
    const started = performance.now();
    this.config = config ?? { url: process.env.SHARDLY_EMBEDDING_URL, model: process.env.SHARDLY_EMBEDDING_MODEL, revision: process.env.SHARDLY_EMBEDDING_REVISION, token: process.env.SHARDLY_EMBEDDING_TOKEN, dimensions: process.env.SHARDLY_EMBEDDING_DIMENSIONS ? Number(process.env.SHARDLY_EMBEDDING_DIMENSIONS) : undefined, rerankUrl: process.env.SHARDLY_RERANK_URL, rerankModel: process.env.SHARDLY_RERANK_MODEL, rerankRevision: process.env.SHARDLY_RERANK_REVISION, rerankToken: process.env.SHARDLY_RERANK_TOKEN, local: process.env.SHARDLY_LOCAL_EMBEDDINGS === "1", offline: process.env.SHARDLY_MODEL_OFFLINE === "1", cacheDir: process.env.SHARDLY_MODEL_CACHE };
    if (this.config.dimensions !== undefined) boundedInteger(this.config.dimensions, "embedding dimensions", 1, 4096);
    for (const value of [this.config.url, this.config.rerankUrl]) if (value) { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("inference URL must be HTTP without embedded credentials"); }
    if (this.config.local) this.local = new LocalInference({ model: this.config.model, revision: this.config.revision, dimensions: this.config.dimensions, offline: this.config.offline, cacheDir: this.config.cacheDir, rerankerModel: this.config.rerankModel, rerankerRevision: this.config.rerankRevision });
    this.provider = this.config.provider ?? this.local;
    this.reranker = this.config.reranker ?? this.local;
    if (this.provider) {
      boundedInteger(this.provider.dimensions, "provider dimensions", 1, 4096);
      if (typeof this.provider.identity !== "string" || !this.provider.identity || this.provider.identity.length > 4096) throw new Error("embedding providers require a stable model identity");
    }
    this.fingerprint = createHash("sha256").update(JSON.stringify(["tokens-1", this.provider?.identity ?? [this.config.url, this.config.model, this.config.revision], this.config.chunks ?? {}, this.config.metric ?? "cosine", this.config.dimensions])).digest("hex");
    this.file = path.join(directory, "index", "semantic.vectors.bin");
    this.graphFile = path.join(directory, "index", "semantic.hnsw.bin");
    this.progressFile = path.join(directory, "index", "semantic.progress.bin");
    this.jobFile = path.join(directory, "index", "semantic.job.bin");
    try {
      const saved = VectorStore.open(this.file);
      if (saved.store.model !== this.fingerprint) throw new Error("semantic checkpoint model/configuration changed; rebuild required");
      this.store = saved.store; this.generation = saved.generation; this.walSequence = saved.walSequence;
      try {
        this.graph = HnswIndex.open(this.graphFile, this.store, this.generation, this.walSequence);
        if (this.config.hnsw?.M !== undefined && this.graph.M !== this.config.hnsw.M || this.config.hnsw?.efConstruction !== undefined && this.graph.efConstruction !== this.config.hnsw.efConstruction) throw new Error("graph construction configuration changed");
      }
      catch { this.graph = new HnswIndex(this.store, this.config.hnsw); this.graph.rebuild(); this.checkpointError = "graph checkpoint missing or invalid; rebuilt from vectors"; }
      this.graphStatistics = this.graph.stats();
    } catch (error) {
      if (fs.existsSync(this.file)) this.checkpointError = error instanceof Error ? error.message : "invalid semantic checkpoint";
    }
    try {
      const job = decode(readCheckpoint(this.jobFile)).metadata as { kind: string; config: string; generation: number; state: string; processed: number; total: number; error?: string };
      if (job.kind !== "semantic-job" || job.config !== this.fingerprint || !Number.isSafeInteger(job.generation) || !Number.isSafeInteger(job.processed) || !Number.isSafeInteger(job.total) || job.processed < 0 || job.total < job.processed || !["running", "failed", "cancelled", "completed"].includes(job.state) || job.error !== undefined && typeof job.error !== "string") throw new Error("invalid semantic job");
      this.jobGeneration = job.generation;
      this.progress = { state: job.state === "running" ? "interrupted" : job.state === "completed" && this.generation !== job.generation ? "stale" : job.state, processed: job.processed, total: job.total, error: job.error };
    } catch { /* Job state is reconstructed from document versions and verified vectors if missing. */ }
    this.recoveryMs = performance.now() - started;
  }
  status() {
    const records = [...(this.store?.values() ?? [])];
    return { enabled: !!(this.provider || this.config.url && this.config.model), model: this.provider?.identity ?? this.config.model, modelRevision: this.config.revision, indexedGeneration: this.generation, walSequence: this.walSequence, jobGeneration: this.jobGeneration, passages: records.filter(row => !row.deleted).length, dimensions: this.store?.dimensions ?? this.provider?.dimensions ?? 0, rerankerEnabled: !!(this.reranker || this.config.rerankUrl), rerankerModel: this.reranker === this.local ? this.local?.rerankerIdentity : this.reranker?.identity ?? this.config.rerankModel, graph: this.graphStatistics, checkpointError: this.checkpointError, checkpointBytes: [this.file, this.graphFile, this.progressFile, this.jobFile].reduce((n, file) => n + (fs.existsSync(file) ? fs.statSync(file).size : 0), 0), recoveryMs: this.recoveryMs, indexingMs: this.indexingMs, searchMs: this.searchMs, embeddingMs: this.embeddingMs, rerankingMs: this.rerankingMs, pendingDocuments: Math.max(0, this.progress.total - this.progress.processed), failedJobs: this.progress.state === "failed" ? 1 : 0, ...this.progress };
  }
  private saveJob() {
    publish(this.jobFile, encode({ kind: "semantic-job", config: this.fingerprint, generation: this.jobGeneration, ...this.progress }, Buffer.alloc(0)));
  }
  async embeddings(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    signal?.throwIfAborted();
    if (!texts.length) return [];
    const started = performance.now();
    try {
      let vectors: Float32Array[];
      if (this.provider) {
        const rows = await withAbort(this.provider.embed(texts, signal), signal);
        if (rows.length !== texts.length || rows.some(row => row.length !== this.provider!.dimensions)) throw new Error("invalid provider embedding batch");
        vectors = rows.map(row => this.config.metric && this.config.metric !== "cosine" ? validateVector(row, this.provider!.dimensions, this.config.metric) : Float32Array.from(normalize(Array.from(row))));
      } else {
        if (!this.config.url || !this.config.model) throw new Error("semantic retrieval is not configured");
        const ollama = new URL(this.config.url).pathname.endsWith("/api/embed");
        const result = await jsonRequest(this.config.url, { model: this.config.model, input: texts, ...(ollama ? { truncate: false } : {}) }, this.config.token, signal);
        if (!ollama && Array.isArray(result.data)) {
          const items = result.data as Array<{ index: number }>;
          if (new Set(items.map(row => row.index)).size !== texts.length || items.some(row => !Number.isSafeInteger(row.index) || row.index < 0 || row.index >= texts.length)) throw new Error("inference returned an invalid embedding batch mapping");
        }
        const data = ollama ? result.embeddings : Array.isArray(result.data) ? [...result.data].sort((a, b) => (a as {index:number}).index - (b as {index:number}).index).map(row => (row as {embedding:unknown}).embedding) : undefined;
        if (!Array.isArray(data) || data.length !== texts.length) throw new Error("inference returned an invalid embedding batch");
        vectors = data.map(row => this.config.metric && this.config.metric !== "cosine" && Array.isArray(row) ? validateVector(row, row.length, this.config.metric) : Float32Array.from(normalize(row)));
      }
      if (vectors.some(v => v.length !== vectors[0]!.length || this.config.dimensions && v.length !== this.config.dimensions)) throw new Error("inference returned inconsistent dimensions");
      return vectors;
    } finally { this.embeddingMs = performance.now() - started; }
  }
  start(): ReturnType<SemanticIndex["status"]> {
    if (this.running) return this.status();
    if (!this.status().enabled) throw Object.assign(new Error("configure an embedding provider or enable local embeddings first"), { statusCode: 400 });
    this.controller = new AbortController();
    this.progress = { state: "running", processed: 0, total: 0 };
    this.running = this.rebuild(this.controller.signal).catch(error => {
      this.progress.state = this.controller?.signal.aborted ? "cancelled" : "failed";
      this.progress.error = error instanceof Error ? error.message : "Semantic indexing failed; retry to resume.";
      try { this.saveJob(); } catch { this.checkpointError = "semantic job state could not be persisted; retry from document versions"; }
    }).finally(() => { this.running = undefined; });
    return this.status();
  }
  cancel() { this.controller?.abort(); return this.status(); }
  async close() { this.cancel(); await this.running; await this.local?.close(); }
  async settled() { await this.running; }
  private async rebuild(signal: AbortSignal) {
    // shortcut: graph construction yields between batches; move it to a worker when measured request latency requires it.
    const started = performance.now(), captured = await this.engine.retrievalStatus(), generation = captured.indexGeneration;
    this.jobGeneration = generation; this.progress.total = captured.documents; this.saveJob();
    const old = new Map<string, Float32Array>();
    for (const row of this.store?.values() ?? []) old.set(row.inputHash, row.vector);
    try { const resumed = VectorStore.open(this.progressFile); if (resumed.store.model === this.fingerprint) for (const row of resumed.store.values()) old.set(row.inputHash, row.vector); } catch { /* A partial progress checkpoint is derived; retry inference. */ }
    let next: VectorStore | undefined, graph: HnswIndex | undefined;
    for (let offset = 0; ;) {
      signal.throwIfAborted();
      const batch = await this.engine.retrievalManifest({}, offset, 100);
      if (batch.indexGeneration !== generation) throw new Error("semantic index changed during backfill; retry");
      this.progress.total = batch.total;
      for (const { id, revision, doc } of batch.items) {
        const fields = new Map(documentFields(doc).map(f => [f.field, f.text]));
        const chunks = chunkDocument(id, revision, doc, this.config.chunks);
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
            if (!next) { next = new VectorStore(vector.length, this.fingerprint, this.config.metric); graph = new HnswIndex(next, this.config.hnsw); }
            if ((next.size + 1) * next.dimensions * 4 > 512 * 1024 * 1024) throw new Error("semantic index exceeds 512 MiB vector budget");
            next.insert(row.block.id, vector, { documentId: id, revision, field: row.block.field, start: row.block.start, end: row.block.end, inputHash: row.inputHash });
            graph!.add(row.block.id);
          }
          await yieldTurn();
        }
        this.progress.processed++;
      }
      // Resume at the last complete page after inference failure or process termination.
      if (next) next.checkpoint(this.progressFile, generation, captured.walSequence);
      this.saveJob();
      if (offset + batch.items.length >= batch.total) break;
      if (!batch.items.length) throw new Error("semantic manifest made no progress");
      offset = batch.nextOffset;
    }
    next ??= new VectorStore(this.provider?.dimensions ?? this.config.dimensions ?? this.store?.dimensions ?? 1, this.fingerprint, this.config.metric);
    graph ??= new HnswIndex(next, this.config.hnsw);
    if ((await this.engine.retrievalStatus()).indexGeneration !== generation) throw new Error("semantic index changed during backfill; retry");
    signal.throwIfAborted();
    next.checkpoint(this.file, generation, captured.walSequence);
    graph.checkpoint(this.graphFile, generation, captured.walSequence);
    this.store = next; this.graph = graph; this.generation = generation;
    this.walSequence = captured.walSequence;
    this.graphStatistics = graph.stats();
    this.progress.state = "completed"; this.checkpointError = undefined;
    this.saveJob();
    this.indexingMs = performance.now() - started;
    fs.rmSync(this.progressFile, { force: true });
  }
  async search(query: string, options: SearchOptions, limit = 100, signal?: AbortSignal, tuning: { exact?: boolean; efSearch?: number } = {}) {
    const started = performance.now();
    const store = this.store, graph = this.graph, generation = this.generation;
    let versions = await this.engine.retrievalVersions(options);
    if (!store?.size || !graph) return { hits: [], complete: generation === versions.indexGeneration, generation: versions.indexGeneration, statistics: { algorithm: "empty", tookMs: performance.now() - started } };
    const [vector] = await this.embeddings([query], signal);
    signal?.throwIfAborted();
    versions = await this.engine.retrievalVersions(options);
    const allowed = new Map(versions.items.map(item => [item.id, item.revision]));
    const allow = (row: VectorRow) => allowed.get(row.documentId) === row.revision;
    const selective = !!(options.scope || options.filter || options.docIds || options.source || options.repo || options.type || options.language);
    const exact = tuning.exact || selective;
    const candidates = Math.min(store.size, Math.max(limit, limit * 8));
    const requestedEfSearch = tuning.efSearch ?? this.config.efSearch ?? 128, efSearch = Math.max(candidates, requestedEfSearch);
    const rows = exact ? store.exact(vector!, limit, allow, row => row.documentId) : graph.search(vector!, candidates, efSearch, allow);
    const best = new Map<string, { documentId: string; score: number; record: VectorRow }>();
    for (const item of rows) {
      const record = store.get(item.id)!;
      if (!allow(record) || best.has(record.documentId)) continue;
      best.set(record.documentId, { documentId: record.documentId, score: store.metric === "cosine" ? 1 - item.distance : -item.distance, record });
    }
    this.searchMs = performance.now() - started;
    if ((await this.engine.retrievalStatus(options.scope)).indexGeneration !== versions.indexGeneration) return { hits: [], complete: false, generation: versions.indexGeneration, statistics: { algorithm: "index-changed", tookMs: this.searchMs } };
    return { hits: [...best.values()].slice(0, limit), complete: generation === versions.indexGeneration, generation: versions.indexGeneration, statistics: { algorithm: exact ? "exact-prefilter" : "hnsw-postfilter", candidates: rows.length, efSearch: exact ? undefined : efSearch, requestedEfSearch, tookMs: this.searchMs, embeddingMs: this.embeddingMs } };
  }
  async rerank(query: string, documents: string[], signal?: AbortSignal): Promise<Array<{ index: number; score: number }>> {
    const started = performance.now();
    try {
      if (this.reranker) return await withAbort(this.reranker.rerank(query, documents, signal), signal);
      if (!this.config.rerankUrl) throw new Error("reranker is not configured");
      const result = await jsonRequest(this.config.rerankUrl, { model: this.config.rerankModel, query, documents, top_n: documents.length }, this.config.rerankToken, signal);
      const rows = result.results as Array<{ index: number; relevance_score: number }>;
      if (!Array.isArray(rows) || rows.length !== documents.length || new Set(rows.map(r => r.index)).size !== rows.length || rows.some(r => !Number.isSafeInteger(r.index) || r.index < 0 || r.index >= documents.length || !Number.isFinite(r.relevance_score))) throw new Error("invalid reranker candidate mapping");
      return rows.map(r => ({ index: r.index, score: r.relevance_score })).sort((a, b) => b.score - a.score || a.index - b.index);
    } finally { this.rerankingMs = performance.now() - started; }
  }
}
