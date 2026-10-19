import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Session } from "node:inspector/promises";
import { Engine } from "../src/engine.js";

const count = Number(process.argv[2] ?? 10000);
assert(Number.isSafeInteger(count) && count >= 100 && count <= 100000);
assert(global.gc, "run with node --expose-gc --import tsx scripts/profile-engine.ts");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-profile-"));
const session = new Session(); session.connect();
const engine = new Engine(dir);
try {
  global.gc();
  const before = process.memoryUsage();
  await session.post("HeapProfiler.startSampling", { samplingInterval: 32768 });
  for (let offset = 0; offset < count; offset += 1000) {
    engine.addDocuments(Array.from({ length: Math.min(1000, count - offset) }, (_, i) => ({ title: `storage index ${offset + i}`, body: "storage index engine implementation benchmark ".repeat(4), seq: offset + i })));
  }
  assert.equal(engine.documentCount(), count);
  assert.equal(engine.search("storage").total, count);
  global.gc();
  const after = process.memoryUsage();
  const { profile } = await session.post("HeapProfiler.stopSampling");
  const totals = new Map<string, number>();
  const walk = (node: typeof profile.head) => {
    const key = `${node.callFrame.functionName || "anonymous"} ${node.callFrame.url.split("/").slice(-2).join("/")}`;
    totals.set(key, (totals.get(key) ?? 0) + node.selfSize);
    for (const child of node.children) walk(child);
  };
  walk(profile.head);
  const { postingMemory, documentCache } = engine.diagnostics() as { postingMemory: unknown; documentCache: unknown };
  console.log(JSON.stringify({ count, node: process.version, before, after, retainedHeapGrowth: after.heapUsed - before.heapUsed, allocations: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 16), postingMemory, documentCache, methodology: "Deterministic short documents with unique numeric identifiers. Heap sampled during ingestion at 32 KiB intervals; forced GC before and after. Sampling is approximate. Retained heap excludes external typed-array memory, reported separately. Does not establish a memory limit for arbitrary documents." }, null, 2));
} finally {
  session.disconnect();
  try { engine.close(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
