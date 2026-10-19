import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildServer } from "../src/api/server.js";

let directory: string, server: Awaited<ReturnType<typeof buildServer>>;
beforeEach(async () => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-stream-")); server = await buildServer(directory); });
afterEach(async () => { await server.app.close(); fs.rmSync(directory, { recursive: true, force: true }); });

it("round-trips checksummed streaming backups and server collections", async () => {
  const id = server.engine.addDocument({ content: "streamed evidence" });
  const state = { version: 1, collections: [{ id: "saved-collection", name: "Evidence", docIds: [id] }], searches: [{ id: "saved-query", name: "Recovery", query: "evidence", options: {} }] };
  expect((await server.app.inject({ method: "PUT", url: "/workspace", payload: state })).statusCode).toBe(200);
  const exportResponse = await server.app.inject({ url: "/backup/stream" });
  expect(exportResponse.statusCode).toBe(200);
  expect(exportResponse.body).toContain('"type":"footer"');
  server.engine.reset();
  const restore = await server.app.inject({ method: "POST", url: "/backup/stream", headers: { "content-type": "application/x-ndjson" }, payload: exportResponse.body });
  expect(restore.statusCode).toBe(200);
  expect(restore.json()).toMatchObject({ added: 1, duplicates: 0, count: 1 });
  const repeated = await server.app.inject({ method: "POST", url: "/backup/stream", headers: { "content-type": "application/x-ndjson" }, payload: exportResponse.body });
  expect(repeated.json().duplicates).toBe(1);
  await server.app.close(); server = await buildServer(directory);
  expect((await server.app.inject({ url: "/workspace" })).json()).toEqual(state);
  const search = await server.app.inject({ method: "POST", url: "/retrieve", payload: { query: "evidence", collectionId: "saved-collection" } });
  expect(search.json().hits[0].documentId).toBe(id);
  expect((await server.app.inject({ url: "/backup" })).json().workspace).toEqual(state);
});

it("rejects incomplete, tampered, and conflicting streams before adding documents", async () => {
  server.engine.addDocument({ content: "original" });
  const exported = (await server.app.inject({ url: "/backup/stream" })).body;
  server.engine.reset();
  const post = (payload: string) => server.app.inject({ method: "POST", url: "/backup/stream", headers: { "content-type": "application/x-ndjson" }, payload });
  expect((await post(exported.replace('original', 'tampered'))).statusCode).toBe(400);
  expect(server.engine.documentCount()).toBe(0);
  expect((await post(exported.split('\n').slice(0, -2).join('\n') + '\n')).statusCode).toBe(400);
  expect(server.engine.documentCount()).toBe(0);
});
