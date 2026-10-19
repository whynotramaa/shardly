import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildServer } from "../src/api/server.js";
import { blocks } from "../src/search/evidence.js";

let directory: string;
let server: Awaited<ReturnType<typeof buildServer>>;
beforeEach(async () => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-retrieval-")); server = await buildServer(directory); });
afterEach(async () => { await server.app.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it("returns bounded, versioned evidence and rejects update/delete races after restart", async () => {
  const { ids: [id] } = server.engine.ingestDocuments([{ sourceId: "guide", filename: "guide.md", content: "# Recovery\n\nThe 🚀 WAL survives a crash.\n\n" + "tail ".repeat(5000) }]);
  const searched = await server.app.inject({ method: "POST", url: "/retrieve", payload: { query: "WAL", maxBytes: 4096 } });
  expect(searched.statusCode).toBe(200);
  expect(Buffer.byteLength(searched.body)).toBeLessThanOrEqual(4096);
  const hit = searched.json().hits[0];
  expect(hit.documentId).toBe(id);
  const ref = hit.passages[0].reference;
  const fetch = () => server.app.inject({ method: "POST", url: "/fetch", payload: { references: [ref] } });
  expect((await fetch()).json().items[0].passage.text).toContain("WAL");
  await server.app.close(); server = await buildServer(directory);
  expect((await fetch()).json().items[0].state).toBe("complete");
  server.engine.ingestDocuments([{ sourceId: "guide", filename: "guide.md", content: "new version" }]);
  expect((await fetch()).json().items[0].state).toBe("stale_reference");
  server.engine.deleteDocument(id!);
  expect((await fetch()).json().items[0].state).toBe("not_found");
});

it("supports bounded typed filters, batch errors, and generation-bound cursors", async () => {
  server.engine.addDocuments(Array.from({ length: 8 }, (_, i) => ({ content: "storage", path: `src/${i}.ts`, modifiedAt: i, tags: [i % 2 ? "odd" : "even"] })));
  const search = (payload: object) => server.app.inject({ method: "POST", url: "/search", payload });
  const filter = { and: [{ field: "tags", op: "in", value: ["even"] }, { field: "modifiedAt", op: "gte", value: 2 }] };
  const first = (await search({ query: "storage", filter, limit: 1 })).json();
  expect(first.total).toBe(3);
  const second = (await search({ query: "storage", filter, limit: 1, cursor: first.nextCursor })).json();
  expect(second.hits[0].documentId).not.toBe(first.hits[0].documentId);
  server.engine.addDocument({ content: "storage" });
  expect((await search({ query: "storage", filter, limit: 1, cursor: first.nextCursor })).statusCode).toBe(409);
  expect((await search({ query: "storage", filter: { field: "_access", op: "eq", value: "secret" } })).statusCode).toBe(400);
  const batch = await server.app.inject({ method: "POST", url: "/search/batch", payload: { queries: ["storage", { query: "" }] } });
  expect(batch.json().results[0].result.hits.length).toBeGreaterThan(0);
  expect(batch.json().results[1].error).toBeTruthy();
});

it("excludes policy metadata and honors explicit searchable fields", async () => {
  server.engine.addDocument({ title: "public", body: "selectedneedle", secret: "hiddenneedle", _search: { fields: ["title", "body"] }, _access: { tenant: "tenantneedle" }, _extraction: { parser: "parserneedle" } });
  expect(server.engine.search("selectedneedle").total).toBe(1);
  for (const query of ["hiddenneedle", "tenantneedle", "parserneedle"]) expect(server.engine.search(query).total).toBe(0);
  expect(blocks({ content: "# Heading\n\nparagraph\n\n```ts\nconst x=1;\n```" }).some(b => b.heading === "Heading")).toBe(true);
});

it("enforces read scope across search, fetch, literal modes, status, and admin routes", async () => {
  await server.app.close();
  const admin = "administrator-token-123456789", reader = "readonly-token-12345678901234";
  vi.stubEnv("SHARDLY_ADMIN_TOKEN", admin);
  vi.stubEnv("SHARDLY_READ_KEYS", JSON.stringify({ [reader]: { tenant: "a", principals: ["alice"] } }));
  server = await buildServer(directory);
  const privateId = server.engine.addDocument({ content: "privatewal", _access: { tenant: "b", principals: ["bob"] } });
  server.engine.addDocument({ content: "publicwal", _access: { tenant: "a", principals: ["alice"] } });
  const headers = { authorization: `Bearer ${reader}` };
  for (const match of ["text", "literal", "substring"]) {
    const response = await server.app.inject({ method: "POST", url: "/retrieve", headers, payload: { query: "wal", prefix: true, match } });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("privatewal");
  }
  expect((await server.app.inject({ method: "POST", url: "/fetch", headers, payload: { items: [{ documentId: privateId }] } })).json().items[0].state).toBe("not_found");
  expect((await server.app.inject({ url: "/retrieval/status", headers })).json().documents).toBe(1);
  expect((await server.app.inject({ method: "POST", url: "/reset", headers })).statusCode).toBe(403);
  expect((await server.app.inject({ url: "/backup", headers })).statusCode).toBe(403);
  expect((await server.app.inject({ url: "/search?q=privatewal", headers })).statusCode).toBe(403);
  expect((await server.app.inject({ url: "/search/compare?q=privatewal", headers })).statusCode).toBe(403);
  expect((await server.app.inject({ url: "/stats" })).statusCode).toBe(401);
});

it("validates whole-batch policies before writing and supports quoted metadata filters", async () => {
  const before = server.engine.documentCount();
  expect(() => server.engine.addDocuments([{ content: "valid" }, { content: "invalid", _access: { principals: "alice" } }])).toThrow("invalid _access");
  expect(server.engine.documentCount()).toBe(before);
  expect(() => server.engine.ingestDocuments([{ content: "valid" }, { _search: { fields: [42] } }])).toThrow("invalid _search");
  expect(server.engine.documentCount()).toBe(before);
  server.engine.addDocument({ source: "personal library", content: "recovery" });
  const result = await server.app.inject({ method: "POST", url: "/retrieve", payload: { query: 'source:"personal library" recovery' } });
  expect(result.statusCode).toBe(200);
  expect(result.json().hits).toHaveLength(1);
});

it("segments explicit languages, preserves Unicode offsets, and bounds typo expansion", () => {
  server.engine.addDocument({ content: "数据库恢复指南", contentLanguage: "zh" });
  const result = server.engine.search("数据库", { contentLanguage: "zh" });
  expect(result.total).toBe(1);
  const snippet = result.hits[0]!.snippet!;
  expect(snippet.text).toContain("数据库");
  server.engine.addDocument({ content: "storage durability" });
  expect(server.engine.search("stroage", { typos: true }).total).toBe(1);
  expect(server.engine.search("storage", { contentLanguage: "en" }).total).toBe(1);
  expect(server.engine.search("sto", { typos: true }).total).toBe(0);
});


it("keeps fenced blocks typed and never splits a Unicode surrogate pair", () => {
  const doc = { content: "# Guide\n\n```ts\nconst x=1;\n```\n\nAfter code.\n" };
  const parsed = blocks(doc);
  expect(parsed.find(block => doc.content.slice(block.start, block.end).includes("const x"))?.kind).toBe("code");
  const unicode = { content: "abc🚀def" };
  for (const block of blocks(unicode, 4)) expect(unicode.content.slice(block.start, block.end)).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  expect(() => blocks(unicode, 0)).toThrow("budget");
});


it("keeps upload namespaces and same-name versions separate while stable keys survive reorder", async () => {
  const upload = (filename: string, content: string, query: string) => server.app.inject({ method: "POST", url: `/documents/upload?${query}`, headers: { "content-type": "multipart/form-data; boundary=shardly-test" }, payload: `--shardly-test\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--shardly-test--\r\n` });
  const first = await upload("notes.md", "first version", "mode=add");
  expect(first.statusCode).toBe(201);
  expect((await upload("notes.md", "second version", "mode=add")).statusCode).toBe(201);
  expect(server.engine.documentCount()).toBe(2);
  await upload("notes.md", "first version", "mode=add");
  expect(server.engine.documentCount()).toBe(2);
  const rows = [{ key: "a", content: "alpha" }, { key: "b", content: "beta" }];
  await upload("records.json", JSON.stringify(rows), "namespace=records&recordKey=key&mode=replace");
  const before = server.engine.search("alpha").hits[0]!.docId;
  await upload("records.json", JSON.stringify([...rows].reverse()), "namespace=records&recordKey=key&mode=replace");
  expect(server.engine.search("alpha").hits[0]?.docId).toBe(before);
  expect(server.engine.documentCount()).toBe(4);
  expect((await upload("records.json", '[{"key":"a"},{"key":"a"}]', "recordKey=key")).statusCode).toBe(400);
  expect(server.engine.documentCount()).toBe(4);
  const excluded = await upload(".env", "SECRET=hidden", "");
  expect(excluded.json().results[0]?.status ?? excluded.json().files?.[0]?.status).toBe("skipped");
});
