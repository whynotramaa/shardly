import { createHash } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { validateDocumentPolicy } from "../search/filters.js";
import { Engine } from "../engine.js";
import { extractDocuments, type ExtractOptions } from "../ingest/extract.js";
import type { Document } from "../types.js";

const port = parentPort!;
const engine = new Engine(workerData.dataDir);
process.on("uncaughtException", error => {
  try { engine.close(); } finally { throw error; }
});
const allowed = new Set([
  "retrievalStatus", "retrievalManifest", "retrievalVersions", "fetchEvidence", "backupPage", "getDocumentRecord",
  "addDocument", "addDocuments", "getDocument", "deleteDocument", "documentCount", "listDocuments", "collectBySource", "reset",
  "search", "naiveSearch", "benchmark", "suggest", "diagnostics", "compare", "ingestDocuments", "exportBackup", "restoreBackup",
  "compact", "snapshot", "close", "explainMissing", "rebuildIndex", "rebuildStatus", "cancelRebuild",
]);
let writing = false;
const waiting: Array<() => void> = [];
const reads = new Set(["documentCount", "getDocument", "listDocuments", "collectBySource", "search", "suggest", "diagnostics", "compare", "benchmark", "naiveSearch", "exportBackup", "explainMissing", "rebuildStatus", "cancelRebuild"]);
for (const method of ["retrievalStatus", "retrievalManifest", "retrievalVersions", "fetchEvidence", "backupPage", "getDocumentRecord"]) reads.add(method);

async function call(method: string, args: unknown[]): Promise<unknown> {
  if (method === "hash") return createHash("sha256").update(args[0] as Uint8Array).digest("hex");
  if (method === "extract") {
    const data = args[1] as Uint8Array;
    return extractDocuments(args[0] as string, Buffer.from(data.buffer, data.byteOffset, data.byteLength), args[2] as ExtractOptions | undefined);
  }
  if (!allowed.has(method)) throw new Error("Unknown engine method");
  const fn = (engine as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!;
  if (method !== "addDocuments" && method !== "ingestDocuments") return fn.apply(engine, args);
  const docs = args[0] as Document[];
  docs.forEach(validateDocumentPolicy);
  const ids: string[] = [];
  let added = 0, updated = 0, duplicates = 0;
  for (let offset = 0; offset < docs.length; offset += 16) {
    const batch = docs.slice(offset, offset + 16);
    if (method === "addDocuments") ids.push(...engine.addDocuments(batch));
    else {
      const result = engine.ingestDocuments(batch);
      ids.push(...result.ids); added += result.added; updated += result.updated; duplicates += result.duplicates;
    }
    await yieldTurn();
  }
  return method === "addDocuments" ? ids : { ids, added, updated, duplicates };
}

port.on("message", (message: { id: number; method: string; args: unknown[] }) => {
  const run = async () => {
    const write = !reads.has(message.method) && message.method !== "extract" && message.method !== "hash";
    if (write) writing = true;
    try { port.postMessage({ id: message.id, result: await call(message.method, message.args) }); }
    catch (error) { port.postMessage({ id: message.id, error: error instanceof Error ? error.message : "Engine failed", statusCode: (error as { statusCode?: number }).statusCode }); }
    finally {
      if (write) { writing = false; waiting.shift()?.(); }
    }
  };
  if (writing && (!reads.has(message.method) && message.method !== "extract" && message.method !== "hash")) waiting.push(() => { void run(); });
  else void run();
});
port.postMessage({ id: 0 });
