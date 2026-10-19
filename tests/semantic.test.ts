import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Engine } from "../src/engine.js";
import { SemanticIndex, fuse, normalize } from "../src/search/semantic.js";
import { Retrieval } from "../src/api/retrieval.js";

let dir: string, engine: Engine, semantic: SemanticIndex, provider: http.Server, requests: number, endpoint: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-semantic-")); engine = new Engine(dir); requests = 0;
  provider = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); res.setHeader("content-type", "application/json");
    if (req.url === "/rerank") { res.end(JSON.stringify({ results: body.documents.map((_: string, i: number) => ({ index: i, relevance_score: i })) })); return; }
    requests++;
    res.end(JSON.stringify({ embeddings: body.input.map((s: string) => /feline|cat/i.test(s) ? [1, 0] : [0, 1]) }));
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(provider.address() as import('node:net').AddressInfo).port}`;
  semantic = new SemanticIndex(engine, dir, { url: endpoint + "/api/embed", model: "fixture", revision: "pinned-test", rerankUrl: endpoint + "/rerank" });
});
afterEach(async () => { await semantic.close(); engine.close(); await new Promise<void>(resolve => provider.close(() => resolve())); fs.rmSync(dir, { recursive: true, force: true }); });

it("retrieves semantic-only evidence, reranks mappings, and survives restart with cached vectors", async () => {
  const feline = engine.ingestDocuments([{ sourceId: "animal-record", content: "a feline sleeps", _access: { tenant: "a" } }]).ids[0]!;
  engine.addDocument({ content: "write ahead log", _access: { tenant: "b" } });
  semantic.start(); await semantic.settled(); expect(semantic.status().state).toBe("completed");
  const retrieval = new Retrieval(engine, semantic);
  const result = await retrieval.search({ query: "cat", strategy: "hybrid", rerank: true }, { tenant: "a" });
  expect(result.hits[0]?.documentId).toBe(feline);
  expect(result.hits[0]?.passages[0]?.text).toContain("feline");
  expect(result.hits[0]?.scores.dense).toBeCloseTo(1);
  expect(result.hits[0]?.scores.reranker).toBe(0);
  const oldRequests = requests;
  semantic.start(); await semantic.settled(); expect(requests).toBe(oldRequests);
  const reopened = new SemanticIndex(engine, dir, semantic.config);
  expect(reopened.status().passages).toBe(semantic.status().passages);
  expect((await reopened.search("cat", { scope: { tenant: "a" } })).hits[0]?.documentId).toBe(feline);
  const reference = result.hits[0]!.passages[0]!.reference!;
  engine.ingestDocuments([{ sourceId: "animal-record", content: "now completely changed", _access: { tenant: "a" } }]);
  expect((await reopened.search("cat", { scope: { tenant: "a" } })).hits).toEqual([]);
  expect(engine.fetchEvidence({ reference }, { tenant: "a" }).state).toBe("stale_reference");
  engine.deleteDocument(feline);
  expect((await reopened.search("cat", {})).hits.some(hit => hit.documentId === feline)).toBe(false);
});

it("falls back explicitly when inference fails and enforces exact-only query constraints", async () => {
  engine.addDocument({ content: "storage recovery" });
  const unconfigured = new Retrieval(engine);
  const result = await unconfigured.search({ query: "storage", strategy: "hybrid" });
  expect(result.retrievalState).toBe("degraded_retrieval");
  expect(result.hits).toHaveLength(1);
  await expect(unconfigured.search({ query: '"storage recovery"', strategy: "hybrid" })).rejects.toThrow("require lexical");
});

it("keeps fusion deterministic and rejects malformed vectors", () => {
  expect(fuse([[{ documentId: "a", score: 100 }, { documentId: "a", score: 99 }], [{ documentId: "b", score: 1 }]])).toHaveLength(2);
  expect(fuse([[{ documentId: "a", score: 10 }, { documentId: "b", score: 1 }], [{ documentId: "b", score: 1 }]])[0]?.documentId).toBe("b");
  expect(normalize([3, 4])).toEqual([0.6, 0.8]);
  for (const vector of [[], [0, 0], [Infinity, 1], [NaN, 1], ["a"]]) expect(() => normalize(vector)).toThrow();
});

it("reranks the candidate pool before selecting the final page", async () => {
  engine.addDocuments([{ title: "First", content: "storage storage storage" }, { title: "Second", content: "storage" }]);
  const initial = engine.search("storage", { limit: 10 }).hits;
  const result = await new Retrieval(engine, semantic).search({ query: "storage", rerank: true, limit: 1 });
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]?.documentId).toBe(initial[1]?.docId);
  expect(result.hits[0]?.scores.reranker).toBe(1);
  expect(result.nextCursor).toBeUndefined();
});


it("allows a semantic query even when the lexical analyzer removes every term", async () => {
  engine.addDocument({ content: "storage recovery" });
  semantic.start(); await semantic.settled();
  const result = await new Retrieval(engine, semantic).search({ query: "the", strategy: "dense" });
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]?.scores.dense).toBeCloseTo(1);
});
