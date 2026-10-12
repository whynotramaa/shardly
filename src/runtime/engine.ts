import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { Engine } from "../engine.js";
import { extractDocuments, type ExtractOptions } from "../ingest/extract.js";

export type AsyncEngine = { [K in keyof Engine]: Engine[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };
export type RuntimeEngine = { [K in keyof Engine]: Engine[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<Awaited<R>> : never };
export interface Extraction { extract(filename: string, buffer: Buffer, options?: ExtractOptions): ReturnType<typeof extractDocuments>; available(): boolean; hash(buffer: Buffer): Promise<string> }
export class WorkerUnavailable extends Error { readonly statusCode = 503; }

export async function startWorker(dataDir: string): Promise<AsyncEngine & Extraction> {
  const module = new URL("./worker.js", import.meta.url);
  const source = import.meta.url.endsWith(".ts");
  if (source) module.pathname = module.pathname.replace(/\.js$/, ".ts");
  const execArgv = process.execArgv.filter(arg => !arg.startsWith("--input-type"));
  const worker = source
    ? new Worker(`const { workerData } = require('node:worker_threads'); import('tsx/esm/api').then(({register}) => { register(); return import(workerData.module); }).catch(error => { throw error; });`, { eval: true, execArgv, workerData: { dataDir, module: module.href } })
    : new Worker(module, { execArgv, workerData: { dataDir } });
  let seq = 0;
  let failed: Error | undefined;
  let closing = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    failed = new WorkerUnavailable(error.message);
    for (const call of pending.values()) call.reject(failed);
    pending.clear();
  };
  const ready = new Promise<void>((resolve, reject) => {
    pending.set(0, { resolve: () => resolve(), reject });
  });
  worker.on("message", (message: { id: number; result?: unknown; error?: string; statusCode?: number }) => {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(Object.assign(new Error(message.error), { statusCode: message.statusCode }));
    else call.resolve(message.result);
  });
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`Engine worker stopped (${code})`)));
  try { await ready; } catch (error) { await worker.terminate(); throw error; }
  const invoke = (method: string, args: unknown[]): Promise<unknown> => {
    if (failed) return Promise.reject(failed);
    if (closing && method !== "close") return Promise.reject(new WorkerUnavailable("Engine is shutting down"));
    if (pending.size >= 32 && method !== "close") return Promise.reject(new WorkerUnavailable("Engine queue is full; retry later"));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, method, args }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  return new Proxy({} as AsyncEngine & Extraction, {
    get: (_, method: string) => method === "then" ? undefined : method === "available" ? () => !failed && !closing : method === "close" ? async () => {
      if (closing) return;
      closing = true;
      try { await invoke("close", []); } finally { await worker.terminate(); }
    } : (...args: unknown[]) => invoke(method, args),
  });
}

export const inlineExtraction: Extraction = { extract: extractDocuments, available: () => true, hash: async buffer => createHash("sha256").update(buffer).digest("hex") };
