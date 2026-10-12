import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { buildServer } from "../src/api/server.js";

const count = Number(process.argv[2] ?? 3000);
assert(Number.isSafeInteger(count) && count >= 500 && count <= 10000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-concurrent-"));
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
const server = await buildServer(dir, { worker: true });
try {
  const base = await server.app.listen({ port: 0, host: "127.0.0.1" });
  const initial = await fetch(`${base}/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Durability reference", content: "checksum concurrentreference storage", source: "benchmark" }) });
  assert.equal(initial.status, 201);
  const id = (await initial.json() as { id: string }).id;
  const docs = Array.from({ length: count }, (_, i) => ({ title: `Import ${i}`, content: "background storage indexing workload ".repeat(12), source: "load" }));
  let importing = true;
  const healthTimes: number[] = [], searchTimes: number[] = [];
  let searchesDuringImport = 0;
  let partialImportSearches = 0;
  eventLoop.enable();
  const started = performance.now();
  const ingest = fetch(`${base}/documents/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(docs) }).then(async response => {
    assert.equal(response.status, 201, await response.text().then(text => response.ok ? "" : text));
    importing = false;
  });
  const sample = async (route: string, times: number[], checkSearch = false) => {
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200);
      const value = await response.json() as { hits?: Array<{ docId: string }>; status?: string };
      times.push(performance.now() - start);
      if (checkSearch) {
        assert.equal(value.hits?.[0]?.docId, id);
        if (importing) searchesDuringImport++;
        const stats = await (await fetch(`${base}/stats`)).json() as { documents: number };
        if (stats.documents > 1 && stats.documents < count + 1) partialImportSearches++;
      } else assert.equal(value.status, "ok");
    }
  };
  await Promise.all([ingest, sample("/health", healthTimes), sample("/search?q=concurrentreference", searchTimes, true)]);
  assert(searchesDuringImport > 0, "no searches completed while importing");
  assert(partialImportSearches > 0, "no search stream observed partially indexed import batches");
  assert.equal((await (await fetch(`${base}/stats`)).json() as { documents: number }).documents, count + 1);
  const percentiles = (times: number[]) => {
    times.sort((a, b) => a - b);
    return { samples: times.length, p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1) };
  };
  console.log(JSON.stringify({ label: "production-worker-http-concurrent-import", node: process.version, count, elapsedMs: performance.now() - started, searchesDuringImport, partialImportSearches, health: percentiles(healthTimes), search: percentiles(searchTimes), eventLoopDelay: { meanMs: eventLoop.mean / 1e6, maxMs: eventLoop.max / 1e6 }, methodology: "Real loopback HTTP, one bulk import and sequential streams of 40 health and 40 search requests started concurrently. Each search is followed by a stats request to verify searches observe partially indexed batches. Existing unique reference must remain first. Includes RPC, JSON and HTTP overhead. Does not model many users, large PDFs, or physical disk faults." }, null, 2));
} finally {
  eventLoop.disable();
  try { await server.app.close(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
