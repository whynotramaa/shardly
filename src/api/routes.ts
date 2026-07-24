import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { Engine } from "../engine.js";
import type { Document } from "../types.js";
import { extractDocuments } from "../ingest/extract.js";
import { fetchGithubDocuments } from "../ingest/github.js";
import { countCorpus, streamCorpus } from "../ingest/corpus.js";

interface IdParam {
  id: string;
}

interface SearchQuery {
  q?: string;
  limit?: string;
}

interface ListQuery {
  offset?: string;
  limit?: string;
}


function previewDoc(doc: Document, maxLen = 280): Document {
  const out: Record<string, unknown> = {};
  let truncated = false;
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === "string" && value.length > maxLen) {
      out[key] = value.slice(0, maxLen).trimEnd() + "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦";
      truncated = true;
    } else {
      out[key] = value;
    }
  }
  if (truncated) out._truncated = true;
  return out;
}


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

  // Bulk ingest ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â accepts an array of documents. Convenient for seeding/UI.
  app.post<{ Body: Document[] }>("/documents/bulk", async (req, reply) => {
    const body = req.body;
    if (!Array.isArray(body)) {
      return reply.code(400).send({ error: "body must be a JSON array" });
    }
    const ids = engine.addDocuments(body);
    return reply.code(201).send({ ids, count: ids.length });
  });

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

  app.get("/corpus/wikipedia/status", async () => ({
    available: await countCorpus(),
    indexed: engine.collectBySource("wikipedia").length,
  }));

  app.post("/corpus/wikipedia/index", async (reqIgnored, reply) => {
    void reqIgnored;
    const total = await countCorpus();
    reply.header("content-type", "application/x-ndjson");
    reply.header("cache-control", "no-cache");
    const stream = new PassThrough();
    const write = (o: unknown) => stream.write(JSON.stringify(o) + "\n");

    void (async () => {
      try {
        const existing = new Set(
          engine
            .collectBySource("wikipedia")
            .map((d) => d.pageid)
            .filter((p): p is number => typeof p === "number"),
        );
        let indexed = 0;
        await streamCorpus((docs) => {
          const fresh = docs.filter(
            (d) =>
              typeof d.pageid !== "number" || !existing.has(d.pageid as number),
          );
          if (fresh.length > 0) {
            engine.addDocuments(fresh);
            indexed += fresh.length;
          }
          write({ type: "progress", indexed, total });
        });
        engine.snapshot();
        write({ type: "done", indexed, documents: engine.documentCount() });
      } catch (e) {
        write({
          type: "error",
          error: e instanceof Error ? e.message : "Corpus indexing failed",
        });
      } finally {
        stream.end();
      }
    })();

    return reply.send(stream);
  });

  app.post("/corpus/wikipedia/deindex", async () => {
    const targets = engine.collectBySource("wikipedia");
    let removed = 0;
    for (const t of targets) if (engine.deleteDocument(t.id)) removed++;
    engine.snapshot();
    return { removed, documents: engine.documentCount() };
  });

  // Clear the entire store ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â wipes seed data so uploads are the whole corpus.
  app.post("/reset", async () => {
    engine.reset();
    return { ok: true, documents: 0 };
  });

  // Browse indexed documents (paginated), with snippet-trimmed previews.
  app.get<{ Querystring: ListQuery }>("/documents", async (req) => {
    const offset = Math.max(0, Number.parseInt(req.query.offset ?? "0", 10) || 0);
    const limit = parseLimit(req.query.limit, 50, 200);
    const { total, items } = engine.listDocuments(offset, limit);
    return {
      total,
      offset,
      limit,
      items: items.map((it) => ({ id: it.id, doc: previewDoc(it.doc) })),
    };
  });

  // O(1) lookup by id ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â returns the FULL document for the detail view.
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

  app.get<{ Querystring: SearchQuery }>("/search", async (req, reply) => {
    const q = req.query.q;
    if (!q || q.trim().length === 0) {
      return reply.code(400).send({ error: "query parameter 'q' is required" });
    }
    const result = engine.search(q, parseLimit(req.query.limit));
    return {
      ...result,
      hits: result.hits.map((h) => ({ ...h, doc: previewDoc(h.doc) })),
    };
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

function parseLimit(raw: string | undefined, fallback = 10, max = 100): number {
  const n = Number.parseInt(raw ?? String(fallback), 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}







