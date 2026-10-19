import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { excludedPath } from "../ingest/extract.js";
import { CONTENT_LANGUAGES } from "../search/tokenizer.js";
import { WorkspaceStore, validateWorkspace } from "./workspace.js";
import type { FastifyInstance } from "fastify";
import type { RuntimeEngine, Extraction } from "../runtime/engine.js";
import type { DemoRuntime } from "../runtime/demo.js";
import type { FolderSources } from "../ingest/folders.js";
import type { Document, SearchOptions } from "../types.js";
import { fetchGithubDocuments } from "../ingest/github.js";
import { countCorpus } from "../ingest/corpus.js";
import type { IngestJobs } from "../ingest/jobs.js";
import { InputError, object, documents, text, queryText, optionalText, flag, integer, choice, synonyms } from "./validation.js";

interface IdParam {
  id: string;
}

interface SearchQuery {
  q?: string;
  limit?: string;
  [key: string]: unknown;
}

interface ListQuery {
  offset?: string;
  limit?: string;
}

function previewDoc(doc: Document, maxLen = 280): Document {
  let truncated = false;

  const trim = (value: unknown): unknown => {
    if (typeof value === "string" && value.length > maxLen) {
      truncated = true;
      return value.slice(0, maxLen).trimEnd() + "\u2026";
    }
    if (Array.isArray(value)) return value.map(trim);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = trim(v);
      return out;
    }
    return value;
  };

  const out = trim(doc) as Record<string, unknown>;
  if (truncated) out._truncated = true;
  return out;
}

export function registerRoutes(app: FastifyInstance, engine: RuntimeEngine, jobs: IngestJobs, folders: FolderSources, extraction: Extraction, demo: DemoRuntime, workspace: WorkspaceStore): void {
  app.get("/health", async (req, reply) => {
    void req;
    return extraction.available() ? { status: "ok" } : reply.code(503).send({ status: "unavailable" });
  });

  app.get("/stats", async () => ({ documents: await engine.documentCount() }));

  app.post<{ Body: Document }>("/documents", async (req, reply) => {
    const body = documents([req.body])[0]!;
    const id = await engine.addDocument(body);
    return reply.code(201).send({ id });
  });

  app.post<{ Body: Document[] }>("/documents/bulk", async (req, reply) => {
    const body = documents(req.body);
    const ids = await engine.addDocuments(body);
    return reply.code(201).send({ ids, count: ids.length });
  });

  app.post("/documents/upload", async (req, reply) => {
    const input = req.query as Record<string, unknown>;
    const namespace = optionalText(input.namespace, "namespace", 128);
    const mode = choice(input.mode, "mode", ["add", "replace"]) ?? "replace";
    const recordKey = optionalText(input.recordKey, "recordKey", 128);
    const contentLanguage = choice(input.contentLanguage, "contentLanguage", CONTENT_LANGUAGES);
    const includeSensitive = flag(input.includeSensitive, "includeSensitive") ?? false;
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "expected a multipart upload" });
    }
    const results: Array<{
      filename: string;
      status: "indexed" | "skipped";
      reason?: string;
      documents: number;
      added?: number;
      updated?: number;
      duplicates?: number;
      parser?: string;
      warnings?: string[];
    }> = [];

    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      const buffer = await part.toBuffer();
      if (!includeSensitive && excludedPath(part.filename)) { results.push({ filename: part.filename, status: "skipped", reason: "excluded sensitive filename; explicitly enable includeSensitive to index it", documents: 0 }); continue; }
      const extracted = await extraction.extract(part.filename, buffer);
      const keys = extracted.docs.map((doc, ordinal) => recordKey ? doc[recordKey] : ordinal);
      if (keys.some(key => typeof key === "string" ? !key.length : typeof key !== "number" || !Number.isFinite(key)) || new Set(keys.map(String)).size !== keys.length) throw new InputError("missing or duplicate record keys");
      const suffix = mode === "add" ? `:${createHash("sha256").update(buffer).digest("hex")}` : "";
      const ingestion = extracted.docs.length > 0 ? await engine.ingestDocuments(
        extracted.docs.map((doc, ordinal) => ({ ...doc, ...(contentLanguage ? { contentLanguage } : {}), source: "upload", sourceId: `${namespace ? `upload-group:${JSON.stringify([namespace, part.filename, String(keys[ordinal])])}` : `upload:${part.filename}:${keys[ordinal]}`}${suffix}` })),
      ) : undefined;
      results.push({
        filename: extracted.filename,
        parser: extracted.parser ?? "utf8",
        warnings: extracted.warnings,
        status: extracted.status,
        reason: extracted.reason,
        documents: extracted.docs.length,
        ...ingestion,
      });
    }

    const indexed = results.reduce((s, r) => s + r.documents, 0);
    return reply
      .code(201)
      .send({ results, indexed, documents: await engine.documentCount() });
  });

  app.post<{
    Body: { user?: string; token?: string; deep?: boolean };
  }>("/ingest/github", async (req, reply) => {
    const body = object(req.body);
    const user = text(body.user, "GitHub target", 256);
    const token = optionalText(body.token, "GitHub token", 512);
    const deep = flag(body.deep, "deep") ?? false;
    try {
      const { docs, summary } = await fetchGithubDocuments({
        user: user.trim(),
        token: token?.trim() || undefined,
        deep: Boolean(deep),
      });
      const ingestion = await engine.ingestDocuments(docs);
      return reply
        .code(201)
        .send({ ...summary, ingestion, totalDocuments: await engine.documentCount() });
    } catch (e) {
      return reply
        .code(400)
        .send({ error: token ? (e instanceof Error ? e.message : "GitHub indexing failed").replaceAll(token, "[redacted]") : e instanceof Error ? e.message : "GitHub indexing failed" });
    }
  });

  app.get("/corpus/wikipedia/status", async () => ({
    available: await countCorpus(),
    indexed: (await engine.collectBySource("wikipedia")).length,
  }));

  app.post("/corpus/wikipedia/index", async (reqIgnored, reply) => {
    void reqIgnored;
    const job = jobs.create({ kind: "wikipedia" });
    reply.header("content-type", "application/x-ndjson");
    reply.header("cache-control", "no-cache");
    const stream = new PassThrough();
    const timer = setInterval(async () => {
      const current = jobs.get(job.id)!;
      stream.write(JSON.stringify({ type: "progress", indexed: current.progress.indexed, total: current.progress.total }) + "\n");
      if (["completed", "failed", "cancelled", "interrupted"].includes(current.status)) {
        clearInterval(timer);
        stream.end(JSON.stringify(current.status === "completed"
          ? { type: "done", indexed: current.progress.indexed, documents: await engine.documentCount() }
          : { type: "error", error: current.error ?? "Import stopped" }) + "\n");
      }
    }, 100);
    stream.on("close", () => { clearInterval(timer); jobs.cancel(job.id); });

    return reply.send(stream);
  });

  app.post("/corpus/wikipedia/deindex", async () => {
    if (jobs.busy() || folders.busy()) throw new InputError("cancel active imports before removing the corpus");
    const targets = await engine.collectBySource("wikipedia");
    let removed = 0;
    for (const t of targets) if (await engine.deleteDocument(t.id)) removed++;
    await engine.snapshot();
    return { removed, documents: await engine.documentCount() };
  });

  app.post("/compact", async () => ({
    ...await engine.compact(),
    documents: await engine.documentCount(),
  }));

  app.post("/reset", async (req, reply) => {
    void req;
    if (folders.list().some(source => !source.paused)) return reply.code(400).send({ error: "pause folder sources before resetting the store" });
    if (jobs.busy() || folders.busy()) throw new InputError("cancel active imports before resetting the store");
    await engine.reset();
    return { ok: true, documents: 0 };
  });

  app.get<{ Querystring: ListQuery }>("/documents", async (req) => {
    const offset = integer(req.query.offset, "offset", 0, 0, 100_000);
    const limit = integer(req.query.limit, "limit", 50, 1, 200);
    const { total, items } = await engine.listDocuments(offset, limit);
    return {
      total,
      offset,
      limit,
      items: items.map((it) => ({ id: it.id, doc: previewDoc(it.doc) })),
    };
  });

  // O(1) lookup by id — returns the FULL document for the detail view.
  app.get<{ Params: IdParam }>("/documents/:id", async (req, reply) => {
    const revision = optionalText((req.query as Record<string, unknown>).revision, "revision", 128);
    const record = await engine.getDocumentRecord(req.params.id, revision);
    if (record === null) return reply.code(404).send({ error: "not found" });
    return revision === undefined ? { id: record.id, doc: record.doc } : record;
  });

  app.delete<{ Params: IdParam }>("/documents/:id", async (req, reply) => {
    const ok = await engine.deleteDocument(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });

  app.get<{ Querystring: SearchQuery }>("/search", async (req, reply) => {
    const q = queryText(req.query.q, "query parameter 'q'");
    const result = await engine.search(q, searchOptions(req.query));
    return {
      ...result,
      hits: result.hits.map((h) => ({ ...h, doc: previewDoc(h.doc) })),
    };
  });

  app.get<{ Querystring: SearchQuery }>("/suggest", async (req) => ({
    suggestions: await engine.suggest(text(req.query.q, "query parameter 'q'", 80), integer(req.query.limit, "limit", 8, 1, 20)),
  }));

  app.get<{ Querystring: { term?: string } }>("/diagnostics", async (req) => await engine.diagnostics(optionalText(req.query.term, "term", 80)));

  app.post("/search/compare", async (req) => {
    const body = object(req.body);
    const result = await engine.compare(queryText(body.query), searchOptions(body.options === undefined ? {} : object(body.options, "options")));
    return {
      ...result,
      baseline: { ...result.baseline, hits: result.baseline.hits.map((hit) => ({ ...hit, doc: previewDoc(hit.doc) })) },
      tuned: { ...result.tuned, hits: result.tuned.hits.map((hit) => ({ ...hit, doc: previewDoc(hit.doc) })) },
    };
  });

  app.post("/search/explain-missing", async (req) => {
    const body = object(req.body);
    return engine.explainMissing(queryText(body.query), text(body.id, "document id", 128), searchOptions(body.options === undefined ? {} : object(body.options, "options")));
  });
  app.get("/maintenance/rebuild", async () => engine.rebuildStatus());
  app.post("/maintenance/rebuild", async (req, reply) => {
    void req;
    const status = await engine.rebuildStatus();
    if (status.state !== "running") void Promise.resolve(engine.rebuildIndex()).catch(error => app.log.error(error));
    return reply.code(202).send(await engine.rebuildStatus());
  });
  app.delete("/maintenance/rebuild", async () => ({ cancelled: await engine.cancelRebuild() }));
  app.post("/maintenance/rebuild/cancel", async () => ({ cancelled: await engine.cancelRebuild() }));

  app.get("/backup", async (req, reply) => {
    void req;
    reply.header("content-disposition", 'attachment; filename="shardly-backup.json"');
    reply.header("cache-control", "no-store");
    return { ...await engine.exportBackup(), workspace: workspace.get() };
  });

  app.post("/backup", async (req) => {
    if (jobs.busy() || folders.busy()) throw new InputError("cancel active imports before restoring a backup");
    const body = object(req.body);
    const backup = object(body.backup, "backup");
    const restoredWorkspace = backup.workspace === undefined ? undefined : validateWorkspace(backup.workspace);
    if (backup.version !== 1 || !Array.isArray(backup.documents)) throw new InputError("unsupported backup format");
    if (backup.documents.length > 100_000) throw new InputError("backup exceeds 100000 documents");
    const ids = new Set<string>();
    for (const entry of backup.documents) {
      const record = object(entry, "backup entry");
      const id = text(record.id, "backup document id", 128);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new InputError("backup contains an invalid or duplicate document id");
      ids.add(id);
      documents([record.doc]);
    }
    const result = await engine.restoreBackup(backup);
    if (restoredWorkspace) workspace.save(restoredWorkspace);
    return result;
  });

  app.get("/jobs", async () => ({ jobs: jobs.list() }));
  app.post("/jobs", async (req, reply) => reply.code(202).send(jobs.create(req.body)));
  app.get<{ Params: IdParam }>("/jobs/:id", async (req, reply) => jobs.get(req.params.id) ?? reply.code(404).send({ error: "job not found" }));
  app.post<{ Params: IdParam }>("/jobs/:id/cancel", async (req, reply) => jobs.cancel(req.params.id) ?? reply.code(404).send({ error: "job not found" }));
  app.post<{ Params: IdParam }>("/jobs/:id/retry", async (req, reply) => {
    const body = req.body === undefined ? {} : object(req.body);
    const job = jobs.retry(req.params.id, optionalText(body.token, "GitHub token", 512));
    return job ? reply.code(202).send(job) : reply.code(404).send({ error: "job not found" });
  });

  app.post("/demo/seed", async () => demo.seed());
  app.post("/demo/import", async () => demo.import());
  app.post("/demo/durability", async () => demo.durability());
  app.get<{ Querystring: SearchQuery }>("/demo/search", async (req) => {
    const selected = await demo.ready();
    const result = await selected.search(queryText(req.query.q), { ...searchOptions(req.query), source: "demo" });
    return { ...result, hits: result.hits.map(hit => ({ ...hit, doc: previewDoc(hit.doc) })) };
  });
  const compareDemo = async (input: unknown) => {
    const body = object(input);
    const selected = await demo.ready();
    const result = await selected.compare(queryText(body.query), { ...searchOptions(body.options === undefined ? {} : object(body.options, "options")), source: "demo" });
    return {
      ...result,
      baseline: { ...result.baseline, hits: result.baseline.hits.map(hit => ({ ...hit, doc: previewDoc(hit.doc) })) },
      tuned: { ...result.tuned, hits: result.tuned.hits.map(hit => ({ ...hit, doc: previewDoc(hit.doc) })) },
    };
  };
  app.post("/demo/compare", async (req) => compareDemo(req.body));
  app.post("/demo/search/compare", async (req) => compareDemo(req.body));

  app.get("/sources/folders", async () => ({ sources: folders.list() }));
  app.post("/sources/folders", async (req, reply) => {
    const body = object(req.body);
    return reply.code(202).send(await folders.create(text(body.path, "folder path", 4096), { includeSensitive: flag(body.includeSensitive, "includeSensitive"), recordKey: optionalText(body.recordKey, "recordKey", 128) }));
  });
  app.get<{ Params: IdParam }>("/sources/folders/:id", async (req, reply) => folders.get(req.params.id) ?? reply.code(404).send({ error: "folder source not found" }));
  for (const action of ["pause", "resume", "rescan"] as const) {
    app.post<{ Params: IdParam }>(`/sources/folders/:id/${action}`, async (req, reply) => {
      const source = await folders.action(req.params.id, action);
      return source ? reply.code(action === "pause" ? 200 : 202).send(source) : reply.code(404).send({ error: "folder source not found" });
    });
  }
  app.delete<{ Params: IdParam }>("/sources/folders/:id", async (req, reply) => {
    const result = await folders.remove(req.params.id);
    return result ?? reply.code(404).send({ error: "folder source not found" });
  });

  // Indexed search vs naive linear scan, timed side by side.
  app.get<{ Querystring: SearchQuery }>("/benchmark", async (req, reply) => {
    const q = queryText(req.query.q, "query parameter 'q'");
    return await engine.benchmark(q, integer(req.query.limit, "limit", 10, 1, 100));
  });
}

export function searchOptions(input: Record<string, unknown>): SearchOptions {
  let docIds: unknown = input.docIds;
  if (typeof docIds === "string") docIds = docIds.length ? docIds.split(",") : [];
  if (docIds !== undefined && (!Array.isArray(docIds) || docIds.length > 1000 || docIds.some((id) => typeof id !== "string" || id.length > 128))) {
    throw new InputError("docIds must contain at most 1000 document ids");
  }
  return {
    contentLanguage: choice(input.contentLanguage, "contentLanguage", CONTENT_LANGUAGES),
    limit: integer(input.limit, "limit", 10, 1, 100),
    offset: integer(input.offset, "offset", 0, 0, 100_000),
    mode: choice(input.mode, "mode", ["all", "any"]),
    groupBy: choice(input.groupBy, "groupBy", ["none", "repo", "source"]),
    match: choice(input.match, "match", ["text", "literal", "substring"]),
    profile: choice(input.profile, "profile", ["baseline", "tuned"]),
    source: optionalText(input.source, "source"), repo: optionalText(input.repo, "repo"),
    type: optionalText(input.type, "type"), language: optionalText(input.language, "language"),
    docIds: docIds as string[] | undefined,
    prefix: flag(input.prefix, "prefix"), typos: flag(input.typos, "typos"), inspect: flag(input.inspect, "inspect"),
    synonyms: synonyms(input.synonyms),
  };
}
