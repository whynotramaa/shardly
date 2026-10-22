import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { boundedInteger, validateVector } from "./store.js";

export interface EmbeddingProvider {
  readonly identity: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
  close?(): Promise<void>;
}
export interface Reranker {
  readonly identity: string;
  rerank(query: string, documents: string[], signal?: AbortSignal): Promise<Array<{ index: number; score: number }>>;
  close?(): Promise<void>;
}
export async function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    listener = () => reject(signal.reason ?? new Error("inference cancelled"));
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener("abort", listener); }
}
/** Deterministic test fixture; token hashing does not encode semantic meaning. */
export class MockEmbeddings implements EmbeddingProvider {
  readonly identity: string;
  constructor(readonly dimensions = 32) { boundedInteger(dimensions, "dimensions", 2, 4096); this.identity = `mock-hash-1:${dimensions}`; }
  async embed(texts: string[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    return texts.map(text => {
      const vector = new Float32Array(this.dimensions);
      for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [""]) {
        const hash = createHash("sha256").update(token).digest();
        const at = hash.readUInt32LE() % this.dimensions; vector[at] = vector[at]! + (hash[4]! & 1 ? 1 : -1);
      }
      if (!vector.some(n => n !== 0)) vector[0] = 1;
      const norm = Math.hypot(...vector); return vector.map(n => n / norm);
    });
  }
}
export interface LocalModelOptions { model?: string; revision?: string; dimensions?: number; cacheDir?: string; offline?: boolean; timeoutMs?: number; rerankerModel?: string; rerankerRevision?: string }
export const DEFAULT_EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_EMBED_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";
export const DEFAULT_RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";
export const DEFAULT_RERANK_REVISION = "a09144355adeed5f58c8ed011d209bf8ee5a1fec";

/** One worker owns both optional ONNX sessions; cancellation terminates its bounded queue. */
export class LocalInference implements EmbeddingProvider, Reranker {
  readonly identity: string;
  readonly rerankerIdentity: string;
  readonly dimensions: number;
  private worker?: Worker;
  private sequence = 0;
  private closed = false;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  readonly options: LocalModelOptions;
  constructor(options: LocalModelOptions = {}) {
    if (options.model && options.model !== DEFAULT_EMBED_MODEL && !options.revision) throw new Error("custom models require a pinned revision");
    if (options.rerankerModel && options.rerankerModel !== DEFAULT_RERANK_MODEL && !options.rerankerRevision) throw new Error("custom rerankers require a pinned revision");
    this.dimensions = boundedInteger(options.dimensions ?? 384, "dimensions", 1, 4096);
    boundedInteger(options.timeoutMs ?? 120000, "inference timeout", 1, 600000);
    this.options = { ...options, model: options.model ?? DEFAULT_EMBED_MODEL, revision: options.revision ?? DEFAULT_EMBED_REVISION, rerankerModel: options.rerankerModel ?? DEFAULT_RERANK_MODEL, rerankerRevision: options.rerankerRevision ?? DEFAULT_RERANK_REVISION };
    this.identity = JSON.stringify(["transformers.js@4.3.1", this.options.model, this.options.revision, "q8", "mean", "normalize", this.dimensions]);
    this.rerankerIdentity = JSON.stringify(["transformers.js@4.3.1", this.options.rerankerModel, this.options.rerankerRevision, "q8", "logits", 512]);
  }
  private fail(worker: Worker, error: Error) {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear(); void worker.terminate();
  }
  private invoke(operation: "embed" | "rerank", input: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("inference worker closed"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.pending.size >= 8) return Promise.reject(new Error("inference queue is full"));
    if (!this.worker) {
      const module = new URL("./inference-worker.js", import.meta.url), source = import.meta.url.endsWith(".ts");
      if (source) module.pathname = module.pathname.replace(/\.js$/, ".ts");
      const execArgv = process.execArgv.filter(arg => !arg.startsWith("--input-type"));
      const worker = source
        ? new Worker(`const {workerData}=require('node:worker_threads'); import('tsx/esm/api').then(({register})=>{register();return import(workerData.module)}).catch(e=>{throw e});`, { eval: true, execArgv, workerData: { ...this.options, module: module.href } })
        : new Worker(module, { execArgv, workerData: this.options });
      this.worker = worker;
      worker.on("error", error => this.fail(worker, error));
      worker.on("exit", code => this.fail(worker, new Error(`inference worker stopped (${code})`)));
      worker.on("message", (row: { id: number; result?: unknown; error?: string }) => {
        if (this.worker !== worker) return;
        const call = this.pending.get(row.id); if (!call) return;
        this.pending.delete(row.id); if (row.error) call.reject(new Error(row.error)); else call.resolve(row.result);
      });
    }
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => this.fail(worker, new Error("inference cancelled or timed out"));
      const timer = setTimeout(abort, this.options.timeoutMs ?? 120000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.pending.set(id, { resolve(value) { cleanup(); resolve(value); }, reject(error) { cleanup(); reject(error); } });
      signal?.addEventListener("abort", abort, { once: true });
      try { worker.postMessage({ id, operation, input }); }
      catch (error) { this.pending.delete(id); cleanup(); reject(error); }
    });
  }
  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (!texts.length) return [];
    if (texts.length > 64 || texts.some(text => typeof text !== "string" || text.length > 65536)) throw new Error("embedding batch exceeds budget");
    const rows = await this.invoke("embed", texts, signal) as Float32Array[];
    if (rows.length !== texts.length) throw new Error("invalid local embedding batch");
    return rows.map(row => validateVector(row, this.dimensions, "cosine"));
  }
  async rerank(query: string, documents: string[], signal?: AbortSignal) {
    if (!documents.length) return [];
    if (documents.length > 200 || query.length > 2000 || documents.some(text => text.length > 12000)) throw new Error("reranking exceeds budget");
    const scores = await this.invoke("rerank", { query, documents }, signal) as number[];
    if (scores.length !== documents.length || scores.some(n => !Number.isFinite(n))) throw new Error("invalid local reranking scores");
    return scores.map((score, index) => ({ index, score })).sort((a, b) => b.score - a.score || a.index - b.index);
  }
  async close() { this.closed = true; if (this.worker) { const worker = this.worker; this.fail(worker, new Error("inference worker closed")); await worker.terminate(); } }
}
