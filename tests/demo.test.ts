import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { buildServer } from "../src/api/server.js";
import { DEMO_DOCUMENTS } from "../src/ingest/demo.js";

it("runs the whole demo in a separate worker, deduplicates repeats, and verifies actual SIGKILL recovery without changing the main store", async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-demo-test-"));
  const server = await buildServer(store, { worker: true });
  const demoRoots: string[] = [];
  const mkdtemp = fs.promises.mkdtemp;
  const tempSpy = vi.spyOn(fs.promises, "mkdtemp").mockImplementation(async prefix => {
    const root = await mkdtemp(prefix); demoRoots.push(root); return root;
  });
  try {
    const realId = await server.engine.addDocument({ source: "user", content: "checksum mismatch privateuserneedle", secret: "keep" });
    // Even normal documents deliberately marked demo remain outside the demo store.
    await server.engine.addDocument({ source: "demo", content: "checksum mismatch normalstoreonlyneedle" });
    const before = await server.engine.exportBackup();
    const unseeded = await server.app.inject({ method: "GET", url: "/demo/search?q=checksum" }); expect(unseeded.statusCode).toBe(400);
    const seed = await server.app.inject({ method: "POST", url: "/demo/seed" }); expect(seed.statusCode).toBe(200);
    expect(seed.json().documents).toBe(DEMO_DOCUMENTS.length);
    const repeat = await server.app.inject({ method: "POST", url: "/demo/seed" });
    expect(repeat.json()).toEqual(seed.json());
    const search = await server.app.inject({ method: "GET", url: "/demo/search?q=checksum%20mismatch&source=user&inspect=true" });
    expect(search.statusCode).toBe(200); expect(search.json().total).toBeGreaterThan(0);
    for (const hit of search.json().hits) { expect(hit.doc.source).toBe("demo"); expect(hit.docId).not.toBe(realId); }
    const isolation = await server.app.inject({ method: "GET", url: "/demo/search?q=normalstoreonlyneedle" }); expect(isolation.json().total).toBe(0);
    const compare = await server.app.inject({ method: "POST", url: "/demo/search/compare", payload: { query: "checksum mismatch", options: { source: "user" } } });
    expect(compare.statusCode).toBe(200);
    for (const profile of ["baseline", "tuned"]) for (const hit of compare.json()[profile].hits) expect(hit.doc.source).toBe("demo");
    const imported = await server.app.inject({ method: "POST", url: "/demo/import" }); expect(imported.json().added).toBe(1);
    const duplicate = await server.app.inject({ method: "POST", url: "/demo/import" }); expect(duplicate.json()).toEqual({ added: 0, updated: 0, duplicates: 1, documents: DEMO_DOCUMENTS.length + 1 });
    const durability = await server.app.inject({ method: "POST", url: "/demo/durability" });
    expect(durability.statusCode).toBe(200);
    expect(durability.json()).toMatchObject({ verified: true, before: DEMO_DOCUMENTS.length + 1, after: DEMO_DOCUMENTS.length + 1 });
    expect(durability.json().detail).toContain("SIGKILL");
    expect(await server.engine.exportBackup()).toEqual(before);
    const stillSearchable = await server.app.inject({ method: "GET", url: "/demo/search?q=checksum" }); expect(stillSearchable.json().total).toBeGreaterThan(0);
  } finally {
    tempSpy.mockRestore();
    await server.app.close();
    fs.rmSync(store, { recursive: true, force: true });
    expect(demoRoots.length).toBeGreaterThanOrEqual(2);
    for (const root of demoRoots) expect(fs.existsSync(root)).toBe(false);
  }
}, 20000);


it("preserves exact whitespace and symbol queries in every isolated demo search and compare route", async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-demo-query-test-"));
  const server = await buildServer(store);
  try {
    // A separate reference index supplies the same fixture contents for direct-engine parity.
    server.engine.ingestDocuments(DEMO_DOCUMENTS);
    expect((await server.app.inject({ method: "POST", url: "/demo/seed" })).statusCode).toBe(200);
    for (const match of ["literal", "substring"] as const) {
      for (const query of [" writeAheadLog.", "writeAheadLog. ", "\n  writeAheadLog.", "documentId);\n", "\u00a0writeAheadLog.", " 日本語", "。 ", "  "]) {
        const direct = server.engine.search(query, { match, source: "demo" });
        const search = await server.app.inject({ method: "GET", url: `/demo/search?q=${encodeURIComponent(query)}&match=${match}` });
        expect(search.statusCode).toBe(200);
        expect(search.json().query).toBe(query);
        expect(search.json().terms).toEqual(direct.terms);
        expect(search.json().total).toBe(direct.total);
        expect(search.json().hits.map((hit: typeof direct.hits[number]) => ({ sourceId: hit.doc.sourceId, passages: hit.passages })).sort((a: { sourceId: unknown }, b: { sourceId: unknown }) => String(a.sourceId).localeCompare(String(b.sourceId))))
          .toEqual(direct.hits.map(hit => ({ sourceId: hit.doc.sourceId, passages: hit.passages })).sort((a: { sourceId: unknown }, b: { sourceId: unknown }) => String(a.sourceId).localeCompare(String(b.sourceId))));
        const expected = server.engine.compare(query, { match, source: "demo" });
        for (const url of ["/demo/compare", "/demo/search/compare"]) {
          const compare = await server.app.inject({ method: "POST", url, payload: { query, options: { match } } });
          expect(compare.statusCode).toBe(200);
          for (const profile of ["baseline", "tuned"] as const) {
            expect(compare.json()[profile].query).toBe(query);
            expect(compare.json()[profile].total).toBe(expected[profile].total);
            expect(compare.json()[profile].hits.map((hit: typeof direct.hits[number]) => ({ sourceId: hit.doc.sourceId, snippet: hit.snippet })).sort((a: { sourceId: unknown }, b: { sourceId: unknown }) => String(a.sourceId).localeCompare(String(b.sourceId))))
              .toEqual(expected[profile].hits.map(hit => ({ sourceId: hit.doc.sourceId, snippet: hit.snippet })).sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId))));
          }
        }
      }
    }
    for (const query of ["", "x".repeat(2001)]) {
      expect((await server.app.inject({ method: "GET", url: `/demo/search?q=${encodeURIComponent(query)}` })).statusCode).toBe(400);
    }
    for (const query of [null, 123, "", "x".repeat(2001)]) {
      for (const url of ["/demo/compare", "/demo/search/compare"]) {
        expect((await server.app.inject({ method: "POST", url, payload: { query } })).statusCode).toBe(400);
      }
    }
  } finally {
    await server.app.close();
    fs.rmSync(store, { recursive: true, force: true });
  }
}, 20000);
