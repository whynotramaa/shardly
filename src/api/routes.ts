import type { FastifyInstance } from "fastify";
import type { Engine } from "../engine.js";
import type { Document } from "../types.js";
import { extractDocuments } from "../ingest/extract.js";
import { fetchGithubDocuments } from "../ingest/github.js";

interface IdParam {
  id: string;
}

interface SearchQuery {
  q?: string;
  limit?: string;
}

/**
 * All HTTP routes, as a Fastify plugin over a single Engine instance. The
 * routes are thin: parse/validate input, call the engine, shape the response.
 * No storage or ranking logic leaks up here.
 */
export function registerRoutes(app: FastifyInstance, engine: Engine): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/stats", async () => ({ documents: engine.documentCount() }));

  // Ingest a single JSON document.
  app.post<{ Body: Document }>("/documents", async (req, reply) => {
    const body = req.body;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "body must be a JSON object" });
    }
    const id = engine.addDocument(body);
    return reply.code(201).send({ id });
  });

  // Bulk ingest — accepts an array of documents. Convenient for seeding/UI.
  app.post<{ Body: Document[] }>("/documents/bulk", async (req, reply) => {
    const body = req.body;
    if (!Array.isArray(body)) {
      return reply.code(400).send({ error: "body must be a JSON array" });
    }
    const ids = engine.addDocuments(body);
    return reply.code(201).send({ ids, count: ids.length });
  });

  // Upload files (multipart). Each file is turned into searchable text:
  // PDFs are extracted, structured formats parsed, binaries skipped with a
  // reason — so nothing garbage ends up in the index.
  app.post("/documents/upload", async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "expected a multipart upload" });
    }
    const results: Array<{
      filename: string;
      status: "indexed" | "skipped";
      reason?: string;
      documents: number;
    }> = [];

    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      const buffer = await part.toBuffer();
      const extracted = await extractDocuments(part.filename, buffer);
      if (extracted.docs.length > 0) engine.addDocuments(extracted.docs);
      results.push({
        filename: extracted.filename,
        status: extracted.status,
        reason: extracted.reason,
        documents: extracted.docs.length,
      });
    }

    const indexed = results.reduce((s, r) => s + r.documents, 0);
    return reply
      .code(201)
      .send({ results, indexed, documents: engine.documentCount() });
  });

  // Index a GitHub account: one document per repo (name/description/README),
  // optionally its source files too. An optional token unlocks private repos
  // and a higher rate limit.
  app.post<{
    Body: { user?: string; token?: string; deep?: boolean };
  }>("/ingest/github", async (req, reply) => {
    const { user, token, deep } = req.body ?? {};
    if (!user || user.trim().length === 0) {
      return reply.code(400).send({ error: "a GitHub username is required" });
    }
    try {
      const { docs, summary } = await fetchGithubDocuments({
        user: user.trim(),
        token: token?.trim() || undefined,
        deep: Boolean(deep),
      });
      if (docs.length > 0) engine.addDocuments(docs);
      return reply
        .code(201)
        .send({ ...summary, totalDocuments: engine.documentCount() });
    } catch (e) {
      return reply
        .code(400)
        .send({ error: e instanceof Error ? e.message : "GitHub indexing failed" });
    }
  });

  // Clear the entire store — wipes seed data so uploads are the whole corpus.
  app.post("/reset", async () => {
    engine.reset();
    return { ok: true, documents: 0 };
  });

  // O(1) lookup by id.
  app.get<{ Params: IdParam }>("/documents/:id", async (req, reply) => {
    const doc = engine.getDocument(req.params.id);
    if (doc === null) return reply.code(404).send({ error: "not found" });
    return { id: req.params.id, doc };
  });

  // Tombstone + de-index.
  app.delete<{ Params: IdParam }>("/documents/:id", async (req, reply) => {
    const ok = engine.deleteDocument(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });

  // Ranked full-text search with per-document score breakdown.
  app.get<{ Querystring: SearchQuery }>("/search", async (req, reply) => {
    const q = req.query.q;
    if (!q || q.trim().length === 0) {
      return reply.code(400).send({ error: "query parameter 'q' is required" });
    }
    return engine.search(q, parseLimit(req.query.limit));
  });

  // Indexed search vs naive linear scan, timed side by side.
  app.get<{ Querystring: SearchQuery }>("/benchmark", async (req, reply) => {
    const q = req.query.q;
    if (!q || q.trim().length === 0) {
      return reply.code(400).send({ error: "query parameter 'q' is required" });
    }
    return engine.benchmark(q, parseLimit(req.query.limit));
  });
}

function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "10", 10);
  if (Number.isNaN(n) || n <= 0) return 10;
  return Math.min(n, 100);
}
