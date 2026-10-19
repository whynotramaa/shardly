import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../src/api/server.js";

const count = Number(process.argv[2] ?? 3000);
assert(Number.isSafeInteger(count) && count >= 500 && count <= 10000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-maintenance-"));
const server = await buildServer(dir, { worker: true });
try {
  const base = await server.app.listen({ port: 0, host: "127.0.0.1" });
  const reference = await server.engine.addDocument({ content: "maintenancereference" });
  const dead = await server.engine.addDocument({ content: "dead record ".repeat(10000) });
  await server.engine.addDocuments(Array.from({ length: count }, (_, i) => ({ title: `Maintenance ${i}`, content: "background storage indexing workload ".repeat(12) })));
  await server.engine.deleteDocument(dead);
  // Establish HTTP connections before timing overlap with a short maintenance operation.
  assert.equal((await fetch(`${base}/search?q=maintenancereference`)).status, 200);
  let finished = false;
  let searchesDuringCompaction = 0;
  const times: number[] = [];
  const started = performance.now();
  // Post maintenance to the worker before sending HTTP searches, avoiding request-arrival races.
  const compact = server.engine.compact().then(result => {
    finished = true;
    assert.equal(result.removedDocuments, 1);
    assert(result.reclaimedBytes > 0);
    return result;
  });
  for (let i = 0; i < 40; i++) {
    const start = performance.now();
    const response = await fetch(`${base}/search?q=maintenancereference`);
    assert.equal(response.status, 200);
    const result = await response.json() as { hits: Array<{ docId: string }> };
    assert.equal(result.hits[0]?.docId, reference);
    times.push(performance.now() - start);
    if (!finished) searchesDuringCompaction++;
  }
  const result = await compact;
  assert(searchesDuringCompaction > 0, "searches must complete before compaction finishes");
  assert.equal(await server.engine.documentCount(), count + 1);
  assert.equal(await server.engine.getDocument(dead), null);
  times.sort((a, b) => a - b);
  const noOp = await fetch(`${base}/compact`, { method: "POST" });
  assert.equal(noOp.status, 200);
  assert.equal((await noOp.json() as { removedDocuments: number }).removedDocuments, 0);
  console.log(JSON.stringify({ label: "production-worker-http-concurrent-compaction", node: process.version, count, elapsedMs: performance.now() - started, searchesDuringCompaction, result, search: { samples: times.length, p50Ms: times[20], p95Ms: times[38], maxMs: times.at(-1) }, methodology: "Compaction RPC is posted before 40 sequential real loopback HTTP searches, so searches cannot overtake its start at the worker. Counts searches whose replies arrive before the compaction RPC resolves. Verifies retained documents, reclaimed tombstone bytes, and the HTTP no-op compaction route. Includes HTTP/RPC overhead. Snapshot commits and individual large records remain synchronous." }, null, 2));
} finally {
  try { await server.app.close(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
