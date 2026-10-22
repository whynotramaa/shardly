import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Engine } from "../src/engine.js";
import { SemanticIndex, fuse } from "../src/search/semantic.js";
import { MockEmbeddings, LocalInference } from "../src/vector/providers.js";
import { chunkDocument } from "../src/search/chunker.js";
import { Retrieval } from "../src/api/retrieval.js";
import { buildServer } from "../src/api/server.js";

const dirs: string[] = [], engines: Engine[] = [], indexes: SemanticIndex[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-hybrid-")); dirs.push(dir);
  const engine = new Engine(dir); engines.push(engine);
  const provider = new MockEmbeddings(32), semantic = new SemanticIndex(engine, dir, { provider, chunks: { size: 12, overlap: 3 } }); indexes.push(semantic);
  return { dir, engine, semantic, provider, retrieval: new Retrieval(engine, semantic) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const index of indexes.splice(0)) await index.close();
  for (const engine of engines.splice(0)) engine.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
it("chunks Unicode text with overlap, original offsets, stable parent-scoped IDs and version changes", () => {
  const text = "One two three four. Five six seven eight. Nine ten eleven twelve. More words follow here. 😀 Unicode remains intact.";
  const chunks = chunkDocument("a", "v1", { content: text, source: "test" }, { size: 8, overlap: 2 });
  expect(chunks.length).toBeGreaterThan(2);
  expect(chunks[0]?.end).toBe(text.indexOf("Nine"));
  for (const chunk of chunks) { expect(chunk.tokens).toBeLessThanOrEqual(8); expect(text.slice(chunk.start, chunk.end).trim()).not.toBe(""); expect(chunk.documentId).toBe("a"); }
  expect(chunks[1]!.start).toBeLessThan(chunks[0]!.end);
  expect(chunkDocument("a", "v1", { content: text }, { size: 8, overlap: 2 }).map(c => c.id)).toEqual(chunks.map(c => c.id));
  expect(chunkDocument("b", "v1", { content: text })[0]!.id).not.toBe(chunkDocument("a", "v1", { content: text })[0]!.id);
  expect(chunkDocument("a", "v2", { content: text })[0]!.id).not.toBe(chunkDocument("a", "v1", { content: text })[0]!.id);
  expect(() => chunkDocument("a", "v1", { content: text }, { size: 3, overlap: 3 })).toThrow();
  expect(chunkDocument("a", "v1", { content: "猫喜欢睡觉。狗喜欢玩耍。", contentLanguage: "zh" }, { size: 3, overlap: 1 }).length).toBeGreaterThan(0);
});
it("weights rank fusion independently of incomparable raw scores", () => {
  const lists = [[{ documentId: "a", score: 999 }], [{ documentId: "b", score: .9 }]];
  expect(fuse(lists, "rrf", .5, { constant: 10, weights: [0, 2] })[0]?.documentId).toBe("b");
  expect(() => fuse(lists, "rrf", .5, { constant: 0 })).toThrow();
});
it("rebuilds a missing graph, rejects corrupt vectors and keeps live revision and filter semantics", async () => {
  const { engine, semantic, provider, dir } = fixture();
  const id = engine.addDocument({ content: "storage recovery durability", tags: ["public"], _access: { tenant: "a" } });
  engine.addDocument({ content: "storage recovery private", tags: ["private"], _access: { tenant: "b" } });
  semantic.start(); await semantic.settled(); expect(semantic.status().state).toBe("completed");
  fs.unlinkSync(path.join(dir, "index/semantic.hnsw.bin"));
  const reopened = new SemanticIndex(engine, dir, { provider, chunks: { size: 12, overlap: 3 } }); indexes.push(reopened);
  expect(reopened.status().checkpointError).toContain("rebuilt");
  const filtered = await reopened.search("storage", { scope: { tenant: "a" }, filter: { field: "tags", op: "eq", value: "public" } });
  expect(filtered.hits.map(row => row.documentId)).toEqual([id]); expect(filtered.statistics.algorithm).toBe("exact-prefilter");
  engine.replaceDocument(id, { content: "a different revision", _access: { tenant: "a" } });
  expect((await reopened.search("storage", { scope: { tenant: "a" } })).hits).toEqual([]);
  semantic.start(); await semantic.settled(); expect((await semantic.search("different", { scope: { tenant: "a" } })).hits[0]?.documentId).toBe(id);
  engine.deleteDocument(id); expect((await semantic.search("different", { scope: { tenant: "a" } })).hits).toEqual([]);
  const file = path.join(dir, "index/semantic.vectors.bin"), damaged = fs.readFileSync(file); damaged[35] = damaged[35]! ^ 1; fs.writeFileSync(file, damaged);
  const broken = new SemanticIndex(engine, dir, { provider, chunks: { size: 12, overlap: 3 } }); indexes.push(broken);
  expect(broken.status().passages).toBe(0); expect(broken.status().checkpointError).toContain("checksum");
});
it("retains the prior checkpoint after inference failure and retries idempotently", async () => {
  const { engine, semantic, provider } = fixture();
  engine.addDocument({ content: "first document" }); semantic.start(); await semantic.settled();
  const generation = semantic.status().indexedGeneration;
  engine.addDocument({ content: "second document" });
  const embed = vi.spyOn(provider, "embed").mockRejectedValue(new Error("fixture unavailable"));
  semantic.start(); await semantic.settled(); expect(semantic.status().state).toBe("failed"); expect(semantic.status().indexedGeneration).toBe(generation);
  embed.mockRestore(); semantic.start(); await semantic.settled(); expect(semantic.status().passages).toBe(2);
  semantic.start(); await semantic.settled(); expect(semantic.status().passages).toBe(2);
});
it("builds cited context within budget and preserves search response fields", async () => {
  const { engine, semantic, retrieval } = fixture();
  engine.addDocument({ title: "Storage", content: "Storage recovery uses a durable transaction log. Every acknowledged document is retained after a process crash. More text describes the recovery procedure and checksums." });
  semantic.start(); await semantic.settled();
  const result = await retrieval.retrieve({ query: "storage recovery", strategy: "hybrid", tokenBudget: 9, neighbors: 1, maxBytes: 100000 });
  expect(result.context.tokens).toBeLessThanOrEqual(9); expect(result.context.evidence.length).toBeGreaterThan(0);
  expect(result.context.text).toContain("[C1]"); expect(result.context.evidence[0]?.reference).toBeTruthy();
  for (const row of result.context.evidence) {
    const fetched = engine.fetchEvidence({ reference: row.reference }); expect(fetched.state).toBe("complete"); if (fetched.state === "complete") expect(fetched.passage.text).toBe(row.text);
  }
});
it("falls back when an injected reranker fails and reports dense candidates independently", async () => {
  const { engine, dir, provider } = fixture();
  engine.addDocuments([{ content: "storage durability" }, { content: "recovery integrity" }]);
  const semantic = new SemanticIndex(engine, dir, { provider, reranker: { identity: "broken", async rerank() { throw new Error("unavailable"); } } }); indexes.push(semantic);
  semantic.start(); await semantic.settled();
  const result = await new Retrieval(engine, semantic).search({ query: "storage", strategy: "hybrid", rerank: true });
  expect(result.retrievalState).toBe("degraded_retrieval"); expect(result.hits.length).toBeGreaterThan(0);
  const dense = await new Retrieval(engine, semantic).search({ query: "storage", strategy: "dense" }); expect(dense.hits[0]?.scores.lexical).toBeUndefined();
});
it("cancels and shuts down local worker requests without downloading models", async () => {
  const local = new LocalInference({ offline: true, cacheDir: "/nonexistent-shardly-models", timeoutMs: 1 });
  await expect(local.embed(["test"])).rejects.toThrow(/cancelled|timed out/);
  await local.close(); await expect(local.embed(["test"])).rejects.toThrow(/closed/);
  const controller = new AbortController(); controller.abort();
  await expect(new MockEmbeddings().embed(["test"], controller.signal)).rejects.toBeDefined();
});
it("keeps replacement, batch, retrieval aliases and health available through the worker API", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-hybrid-api-")); dirs.push(dir);
  const { app } = await buildServer(dir, { worker: true });
  try {
    const batch = await app.inject({ method: "POST", url: "/documents/batch", payload: [{ sourceId: "test", content: "oldword" }] });
    expect(batch.statusCode).toBe(201); const id = batch.json().ids[0];
    expect((await app.inject({ method: "PUT", url: `/documents/${id}`, payload: { content: "newword" } })).statusCode).toBe(200);
    const result = await app.inject({ method: "POST", url: "/search/lexical", payload: { query: "newword" } }); expect(result.json().hits[0]?.documentId).toBe(id);
    const context = await app.inject({ method: "POST", url: "/retrieve", payload: { query: "newword", tokenBudget: 2 } }); expect(context.json().context.tokens).toBe(1);
    expect((await app.inject({ method: "GET", url: "/index/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/index/stats" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/search/hybrid", payload: { query: "newword", weights: [-1, 2] } })).statusCode).toBe(400);
  } finally { await app.close(); }
});
it("bounds waits for a provider that ignores reranking cancellation", async () => {
  const { engine, dir, provider } = fixture();
  engine.addDocument({ content: "storage recovery" });
  const semantic = new SemanticIndex(engine, dir, { provider, reranker: { identity: "hung", async rerank() { return new Promise(() => {}); } } }); indexes.push(semantic);
  const result = await new Retrieval(engine, semantic).search({ query: "storage", rerank: true, deadlineMs: 10 });
  expect(result.retrievalState).toBe("degraded_retrieval"); expect(result.hits.length).toBe(1);
});
it("preserves structured source metadata in retrieved context", async () => {
  const { engine, retrieval } = fixture();
  engine.addDocument({ content: "storage recovery", tags: ["durable"], metadata: { author: "fixture", edition: 2 } });
  const result = await retrieval.retrieve({ query: "storage", tokenBudget: 20 });
  expect(result.context.evidence[0]?.metadata.metadata).toEqual({ author: "fixture", edition: 2 });
  expect(result.context.evidence[0]?.metadata.tags).toEqual(["durable"]);
});
it("rechecks document visibility after asynchronous query embedding", async () => {
  const { engine, semantic, provider } = fixture();
  const id = engine.addDocument({ content: "storage recovery" }); semantic.start(); await semantic.settled();
  const original = provider.embed.bind(provider);
  vi.spyOn(provider, "embed").mockImplementation(async (...args) => { engine.deleteDocument(id); return original(...args); });
  expect((await semantic.search("storage", {})).hits).toEqual([]);
});
it("resumes verified embedding progress after failure beyond a completed page", async () => {
  const { engine, semantic, provider, dir } = fixture();
  engine.addDocuments(Array.from({ length: 101 }, (_, i) => ({ content: `document storage ${i}` })));
  const original = provider.embed.bind(provider); let generated = 0;
  const embed = vi.spyOn(provider, "embed").mockImplementation(async (...args) => { if (++generated === 101) throw new Error("interrupted second page"); return original(...args); });
  semantic.start(); await semantic.settled(); expect(semantic.status().state).toBe("failed"); expect(semantic.status().passages).toBe(0);
  embed.mockRestore(); const retry = vi.spyOn(provider, "embed");
  const reopened = new SemanticIndex(engine, dir, { provider, chunks: { size: 12, overlap: 3 } }); indexes.push(reopened);
  reopened.start(); await reopened.settled(); expect(reopened.status().state).toBe("completed"); expect(reopened.status().passages).toBe(101); expect(retry.mock.calls.length).toBe(1);
});
it("persists failed backfill diagnostics and checkpoint WAL watermarks across restart", async () => {
  const { engine, semantic, provider, dir } = fixture();
  engine.addDocument({ content: "storage recovery" });
  const broken = vi.spyOn(provider, "embed").mockRejectedValue(new Error("model temporarily absent"));
  semantic.start(); await semantic.settled();
  const reopened = new SemanticIndex(engine, dir, { provider, chunks: { size: 12, overlap: 3 } }); indexes.push(reopened);
  expect(reopened.status().state).toBe("failed"); expect(reopened.status().failedJobs).toBe(1);
  expect(reopened.status().error).toContain("temporarily absent");
  broken.mockRestore(); reopened.start(); await reopened.settled();
  expect(reopened.status().walSequence).toBe(engine.retrievalStatus().walSequence);
});
it("rebuilds persisted graphs when construction settings change", async () => {
  const { engine, semantic, provider, dir } = fixture(); engine.addDocument({ content: "storage recovery" });
  semantic.start(); await semantic.settled();
  const changed = new SemanticIndex(engine, dir, { provider, chunks: { size: 12, overlap: 3 }, hnsw: { M: 6, efConstruction: 40 } }); indexes.push(changed);
  expect(changed.status().graph?.M).toBe(6); expect(changed.status().graph?.efConstruction).toBe(40);
  expect((await changed.search("storage", {})).hits.length).toBe(1);
});
it("bounds manifest page bytes and advances backfill by the actual returned page", async () => {
  const { engine, semantic } = fixture();
  const ids = engine.addDocuments([{ content: "first storage" }, { content: "second recovery" }, { content: "third durable" }]);
  const storage = Reflect.get(engine, "storage") as import("../src/storage/storage.js").Storage;
  vi.spyOn(storage, "documentBytes").mockReturnValue(5 * 1024 * 1024);
  const page = engine.retrievalManifest({}, 0, 100);
  expect(page.items.map(row => row.id)).toEqual([ids[0]]); expect(page.nextOffset).toBe(1);
  semantic.start(); await semantic.settled(); expect(semantic.status().state).toBe("completed"); expect(semantic.status().passages).toBe(3);
});
