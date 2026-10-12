import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/api/server.js";

let dir: string;
let server: Awaited<ReturnType<typeof buildServer>>;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-features-"));
  server = await buildServer(dir);
});
afterEach(async () => { await server.app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("validated search and management API", () => {
  it("deduplicates repeated multipart uploads and updates the same file identity", async () => {
    const upload = (content: string) => server.app.inject({
      method: "POST", url: "/documents/upload",
      headers: { "content-type": "multipart/form-data; boundary=shardly-test" },
      payload: `--shardly-test\r\nContent-Disposition: form-data; name="file"; filename="guide.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--shardly-test--\r\n`,
    });
    const first = await upload("checksum original");
    expect(first.statusCode).toBe(201);
    expect(first.json().results[0].added).toBe(1);
    const id = server.engine.search("original").hits[0]!.docId;
    expect((await upload("checksum original")).json().results[0].duplicates).toBe(1);
    expect((await upload("checksum revised")).json().results[0].updated).toBe(1);
    expect(server.engine.documentCount()).toBe(1);
    expect(server.engine.search("original").total).toBe(0);
    expect(server.engine.search("revised").hits[0]!.docId).toBe(id);
  });

  it.each(["literal", "substring"] as const)("preserves exact query whitespace and symbols in %s HTTP routes", async match => {
    const id = server.engine.addDocument({ content: "foobar C++bare; surrounded C++ symbol;\tC++tab; C++\u00a0; 🚀rocket" });
    for (const query of [" foo", "foo ", " C++", "C++ ", "\tC++", "C++\u00a0", "\u2003C++", " 🚀", "  "]) {
      const direct = server.engine.search(query, { match });
      const searched = await server.app.inject({ method: "GET", url: `/search?q=${encodeURIComponent(query)}&match=${match}` });
      expect(searched.statusCode).toBe(200);
      const actual = searched.json();
      expect(actual.query).toBe(query);
      expect(actual.terms).toEqual(direct.terms);
      expect(actual.total).toBe(direct.total);
      expect(actual.hits.map((hit: typeof direct.hits[number]) => ({ docId: hit.docId, passages: hit.passages })))
        .toEqual(direct.hits.map(hit => ({ docId: hit.docId, passages: hit.passages })));
      const compared = await server.app.inject({ method: "POST", url: "/search/compare", payload: { query, options: { match } } });
      expect(compared.statusCode).toBe(200);
      const expected = server.engine.compare(query, { match });
      for (const profile of ["baseline", "tuned"] as const) {
        expect(compared.json()[profile].query).toBe(query);
        expect(compared.json()[profile].total).toBe(expected[profile].total);
        expect(compared.json()[profile].hits.map((hit: typeof direct.hits[number]) => hit.snippet))
          .toEqual(expected[profile].hits.map(hit => hit.snippet));
      }
      const explanation = await server.app.inject({ method: "POST", url: "/search/explain-missing", payload: { query, id, options: { match } } });
      expect(explanation.statusCode).toBe(200);
      expect(explanation.json()).toEqual(server.engine.explainMissing(query, id, { match }));
    }
  });

  it("validates raw query type, emptiness and length on every normal search route", async () => {
    const id = server.engine.addDocument({ content: "keep" });
    for (const query of ["", "x".repeat(2001)]) {
      expect((await server.app.inject({ method: "GET", url: `/search?q=${encodeURIComponent(query)}` })).statusCode).toBe(400);
    }
    for (const query of [null, 123, "", "x".repeat(2001)]) {
      for (const url of ["/search/compare", "/search/explain-missing"]) {
        expect((await server.app.inject({ method: "POST", url, payload: { query, id } })).statusCode).toBe(400);
      }
    }
    const query = "  keep  ";
    const response = await server.app.inject({ method: "GET", url: `/search?q=${encodeURIComponent(query)}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(server.engine.search(query).total);
    expect(response.json().query).toBe(query);
  });

  it("reports query grammar and backup conflicts as input errors without writes", async () => {
    for (const query of ['"unfinished', "-missing", "the and"]) {
      expect((await server.app.inject({ method: "GET", url: `/search?q=${encodeURIComponent(query)}` })).statusCode).toBe(400);
    }
    const id = server.engine.addDocument({ content: "original" });
    const conflict = await server.app.inject({ method: "POST", url: "/backup", payload: { backup: { version: 1, documents: [
      { id: "new-id", doc: { content: "must not be written" } }, { id, doc: { content: "conflict" } },
    ] } } });
    expect(conflict.statusCode).toBe(400);
    expect(server.engine.documentCount()).toBe(1);
    expect(server.engine.getDocument(id)).toEqual({ content: "original" });
  });

  it("validates pagination and suggestions instead of silently coercing input", async () => {
    for (const url of ["/documents?offset=-1", "/documents?limit=abc", "/suggest?q=abc&limit=99", "/benchmark?q=abc&limit=1.5"]) {
      expect((await server.app.inject({ method: "GET", url })).statusCode).toBe(400);
    }
  });
  it("validates every bulk item before writing anything", async () => {
    const response = await server.app.inject({ method: "POST", url: "/documents/bulk", payload: [{ content: "valid" }, null] });
    expect(response.statusCode).toBe(400);
    expect(server.engine.documentCount()).toBe(0);
  });

  it("rejects invalid option values and synonym payloads", async () => {
    for (const options of ["mode=maybe", "offset=-1", "limit=1000", "typos=1", "groupBy=filename", "synonyms=%7Bbad"]) {
      expect((await server.app.inject({ method: "GET", url: `/search?q=storage&${options}` })).statusCode).toBe(400);
    }
  });

  it("supports filtered inspection and suggestion responses", async () => {
    await server.app.inject({ method: "POST", url: "/documents/bulk", payload: [
      { source: "github", repo: "demo/core", content: "storage recovery" },
      { source: "upload", content: "storage guide" },
    ] });
    const response = await server.app.inject({ method: "GET", url: "/search?q=storage&source=github&inspect=true" });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(1);
    expect(response.json().inspector).toBeDefined();
    const suggestion = await server.app.inject({ method: "GET", url: "/suggest?q=stor" });
    expect(suggestion.json().suggestions).toContain("storage");
  });

  it("rejects an invalid backup completely before changing the store", async () => {
    server.engine.addDocument({ content: "keep me" });
    const response = await server.app.inject({ method: "POST", url: "/backup", payload: {
      backup: { version: 1, documents: [{ id: "valid-id", doc: { content: "new" } }, { id: "bad-id", doc: [] }] },
    } });
    expect(response.statusCode).toBe(400);
    expect(server.engine.documentCount()).toBe(1);
  });

  it("exports a portable backup with a download header", async () => {
    const id = server.engine.addDocument({ content: "preserved" });
    const response = await server.app.inject({ method: "GET", url: "/backup" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("shardly-backup.json");
    expect(response.json().documents).toEqual([{ id, doc: { content: "preserved" } }]);
  });

  it("rejects duplicate IDs in backups", async () => {
    const response = await server.app.inject({ method: "POST", url: "/backup", payload: {
      backup: { version: 1, documents: [{ id: "same", doc: {} }, { id: "same", doc: {} }] },
    } });
    expect(response.statusCode).toBe(400);
    expect(server.engine.documentCount()).toBe(0);
  });

  it("validates job types and GitHub fields without storing credentials", async () => {
    for (const payload of [{ kind: "unknown" }, { kind: "github", user: 123 }, { kind: "github", user: "demo", deep: "yes" }]) {
      expect((await server.app.inject({ method: "POST", url: "/jobs", payload })).statusCode).toBe(400);
    }
    expect((await server.app.inject({ method: "GET", url: "/jobs" })).json()).toEqual({ jobs: [] });
  });

  it("does not grant CORS access to an unrelated origin", async () => {
    const response = await server.app.inject({ method: "GET", url: "/stats", headers: { origin: "https://unrelated.example" } });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    server.engine.addDocument({ content: "preserved" });
    const reset = await server.app.inject({ method: "POST", url: "/reset", headers: { origin: "https://unrelated.example" } });
    expect(reset.statusCode).toBe(403);
    expect(server.engine.documentCount()).toBe(1);
  });
});
