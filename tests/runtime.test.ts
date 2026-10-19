import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildServer } from "../src/api/server.js";

const roots: string[] = [];
const servers: Array<{ app: { close(): Promise<void> } }> = [];
function dir() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-runtime-")); roots.push(root); return root; }
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.app.close())); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it("serves concurrent HTTP searches before a bounded worker import completes", async () => {
  const server = await buildServer(dir(), { worker: true }); servers.push(server);
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const unique = await server.engine.addDocument({ content: "uniqueworkerneedle" });
  let finished = false;
  const importing = fetch(`${base}/documents/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ content: `worker batch ${i} ordinary searchable document` }))) }).then(async response => { expect(response.status).toBe(201); finished = true; return response.json(); });
  await new Promise(resolve => setTimeout(resolve, 20));
  const results = await Promise.all(Array.from({ length: 12 }, async () => {
    const [health, search] = await Promise.all([fetch(`${base}/health`), fetch(`${base}/search?q=uniqueworkerneedle`)]);
    expect(health.status).toBe(200);
    expect(search.status).toBe(200);
    expect((await search.json() as { hits: Array<{ docId: string }> }).hits[0]!.docId).toBe(unique);
    return !finished;
  }));
  expect(results.some(Boolean)).toBe(true);
  await importing;
  expect(await server.engine.documentCount()).toBe(3001);
}, 20000);

it("rejects excess RPCs and preserves exclusive writer ownership after shutdown", async () => {
  const store = dir();
  const server = await buildServer(store, { worker: true }); servers.push(server);
  const calls = Array.from({ length: 40 }, () => server.engine.documentCount());
  const results = await Promise.allSettled(calls);
  expect(results.filter(result => result.status === "rejected").length).toBeGreaterThan(0);
  await expect(buildServer(store, { worker: true })).rejects.toThrow();
  await server.app.close(); servers.pop();
  const reopened = await buildServer(store); servers.push(reopened);
  expect(reopened.engine.documentCount()).toBe(0);
}, 20000);

it("keeps queued writes after the entire bulk and exposes worker maintenance progress/cancel", async () => {
  const server = await buildServer(dir(), { worker: true }); servers.push(server);
  let bulkDone = false;
  const bulk = server.engine.addDocuments(Array.from({ length: 1000 }, (_, i) => ({ content: `serialbatch ${i}` }))).then(ids => { bulkDone = true; return ids; });
  const after = server.engine.addDocument({ content: "afterbatchneedle" }).then(id => { expect(bulkDone).toBe(true); return id; });
  await Promise.all([bulk, after]);
  const diagnostics = await server.app.inject({ method: "GET", url: "/diagnostics" }); expect(diagnostics.statusCode).toBe(200);
  const started = await server.app.inject({ method: "POST", url: "/maintenance/rebuild" }); expect(started.statusCode).toBe(202);
  const status = await server.app.inject({ method: "GET", url: "/maintenance/rebuild" });
  expect(["running", "completed"]).toContain(status.json().state);
  const cancelled = await server.app.inject({ method: "DELETE", url: "/maintenance/rebuild" }); expect(typeof cancelled.json().cancelled).toBe("boolean");
  const explanation = await server.app.inject({ method: "POST", url: "/search/explain-missing", payload: { query: "afterbatchneedle", id: await after } });
  expect(explanation.statusCode).toBe(200); expect(explanation.json().matched).toBe(true);
}, 20000);

it("serves searches during compaction and serializes queued writes until it commits", async () => {
  const server = await buildServer(dir(), { worker: true }); servers.push(server);
  const ids = await server.engine.addDocuments(Array.from({ length: 1000 }, (_, i) => ({ content: `maintenancequartz ${i}` })));
  await server.engine.deleteDocument(ids[0]!);
  let finished = false;
  const compact = server.engine.compact().then(result => { finished = true; return result; });
  const write = server.engine.addDocument({ content: "aftermaintenance" }).then(id => { expect(finished).toBe(true); return id; });
  const during = await server.engine.search("maintenancequartz");
  expect(during.total).toBe(999);
  expect(finished).toBe(false);
  expect((await compact).removedDocuments).toBe(1);
  expect((await server.engine.search("aftermaintenance")).hits[0]?.docId).toBe(await write);
  expect(await server.engine.getDocument(ids[0]!)).toBeNull();
}, 20000);


it("validates document policies before yielding any worker import batch", async () => {
  const server = await buildServer(dir(), { worker: true }); servers.push(server);
  const docs = [...Array.from({ length: 20 }, () => ({ content: "valid record" })), { content: "invalid", _access: { principals: "alice" } }];
  for (const method of ["addDocuments", "ingestDocuments"] as const) {
    await expect(server.engine[method](docs)).rejects.toThrow("invalid _access");
    expect(await server.engine.documentCount()).toBe(0);
  }
});
