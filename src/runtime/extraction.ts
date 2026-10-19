import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { extractDocuments, type ExtractOptions } from "../ingest/extract.js";

if (!isMainThread) {
  const { filename, data, options } = workerData as { filename: string; data: Uint8Array; options: ExtractOptions };
  extractDocuments(filename, Buffer.from(data), options).then(result => parentPort!.postMessage(result), error => { throw error; });
}

let active = 0;
export async function extractIsolated(filename: string, buffer: Buffer, options?: ExtractOptions): ReturnType<typeof extractDocuments> {
  if (active >= 2) throw Object.assign(new Error("extraction workers busy; retry later"), { statusCode: 503 });
  active++;
  const source = import.meta.url.endsWith(".ts");
  let worker: Worker | undefined;
  try {
    const entry = new URL(source ? "./extraction.ts" : "./extraction.js", import.meta.url);
    const data = { filename, data: buffer, options, module: entry.href };
    worker = source ? new Worker(`const {workerData}=require('node:worker_threads');import('tsx/esm/api').then(({register})=>{register();return import(workerData.module)}).catch(e=>{throw e})`, { eval: true, workerData: data, resourceLimits: { maxOldGenerationSizeMb: 256 } }) : new Worker(entry, { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("extraction exceeded its time budget")), 120000);
      worker!.once("message", value => { clearTimeout(timer); resolve(value); });
      worker!.once("error", error => { clearTimeout(timer); reject(error); });
      worker!.once("exit", () => { clearTimeout(timer); reject(new Error("extraction worker stopped before delivering its result")); });
    });
  } finally { await worker?.terminate(); active--; }
}
