import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/api/server.js";

let tmpDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-api-"));
  ({ app } = await buildServer(tmpDir));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function post(url: string, payload: unknown) {
  return app.inject({ method: "POST", url, payload: payload as object });
}

describe("API", () => {
  it("POST /documents then GET /documents/:id round-trips", async () => {
    const created = await post("/documents", { title: "hello world" });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const got = await app.inject({ method: "GET", url: `/documents/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ id, doc: { title: "hello world" } });
  });

  it("rejects non-object bodies", async () => {
    const res = await post("/documents", [1, 2, 3]);
    expect(res.statusCode).toBe(400);
  });

  it("GET missing document is 404", async () => {
    const res = await app.inject({ method: "GET", url: "/documents/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE tombstones and removes from search", async () => {
    const { id } = (await post("/documents", { body: "deletable content" })).json() as {
      id: string;
    };
    const del = await app.inject({ method: "DELETE", url: `/documents/${id}` });
    expect(del.statusCode).toBe(204);

    const search = await app.inject({ method: "GET", url: "/search?q=deletable" });
    expect((search.json() as { total: number }).total).toBe(0);
  });

  it("GET /search returns ranked hits with score breakdown", async () => {
    await post("/documents/bulk", [
      { title: "distributed storage engines", body: "log structured merge" },
      { title: "react frontend", body: "css and components" },
      { title: "storage internals", body: "segments and offset index storage" },
    ]);

    const res = await app.inject({ method: "GET", url: "/search?q=storage&limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total: number;
      hits: { score: number; breakdown: { term: string }[] }[];
    };
    expect(body.total).toBe(2);
    expect(body.hits[0]!.score).toBeGreaterThan(0);
    expect(body.hits[0]!.breakdown[0]!.term).toBe("storage");
    // ranked descending
    expect(body.hits[0]!.score).toBeGreaterThanOrEqual(body.hits[1]!.score);
  });

  it("GET /search without q is 400", async () => {
    const res = await app.inject({ method: "GET", url: "/search" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /benchmark agrees with indexed search on the top hit", async () => {
    await post("/documents/bulk", [
      { t: "alpha beta gamma storage" },
      { t: "storage storage storage tiny" },
      { t: "unrelated content here" },
    ]);
    const res = await app.inject({ method: "GET", url: "/benchmark?q=storage" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { topHitsMatch: boolean; naive: unknown; indexed: unknown };
    expect(body.topHitsMatch).toBe(true);
  });

  it("POST /reset clears all documents and the index", async () => {
    await post("/documents/bulk", [
      { filename: "a.txt", content: "storage engines and indexes" },
      { filename: "b.txt", content: "more storage content" },
    ]);
    expect((await app.inject({ method: "GET", url: "/stats" })).json()).toEqual({
      documents: 2,
    });

    const reset = await app.inject({ method: "POST", url: "/reset" });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ ok: true, documents: 0 });

    expect((await app.inject({ method: "GET", url: "/stats" })).json()).toEqual({
      documents: 0,
    });
    const search = await app.inject({ method: "GET", url: "/search?q=storage" });
    expect((search.json() as { total: number }).total).toBe(0);

    // The store must still work after a reset.
    const created = await post("/documents", { filename: "c.txt", content: "fresh storage" });
    expect(created.statusCode).toBe(201);
    const after = await app.inject({ method: "GET", url: "/search?q=storage" });
    expect((after.json() as { total: number }).total).toBe(1);
  });

  it("reset survives a restart (empty stays empty)", async () => {
    await post("/documents", { content: "temporary" });
    await app.inject({ method: "POST", url: "/reset" });
    await app.close();

    ({ app } = await buildServer(tmpDir));
    expect((await app.inject({ method: "GET", url: "/stats" })).json()).toEqual({
      documents: 0,
    });
  });

  it("data survives a server restart", async () => {
    const { id } = (await post("/documents", { keep: "me around" })).json() as {
      id: string;
    };
    await app.close();

    ({ app } = await buildServer(tmpDir));
    const got = await app.inject({ method: "GET", url: `/documents/${id}` });
    expect(got.json()).toEqual({ id, doc: { keep: "me around" } });
    const search = await app.inject({ method: "GET", url: "/search?q=around" });
    expect((search.json() as { total: number }).total).toBe(1);
  });
});
