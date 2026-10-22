import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { Engine } from "../engine.js";
import { registerRoutes } from "./routes.js";
import { IngestJobs } from "../ingest/jobs.js";
import { DemoRuntime } from "../runtime/demo.js";
import { FolderSources } from "../ingest/folders.js";
import { startWorker, inlineExtraction, type AsyncEngine, type Extraction } from "../runtime/engine.js";
import type { FastifyInstance } from "fastify";
import { dataPaths } from "../config.js";
import { registerAuth } from "./auth.js";
import { registerRetrieval, Retrieval } from "./retrieval.js";
import { extractIsolated } from "../runtime/extraction.js";
import { SemanticIndex } from "../search/semantic.js";
import { WorkspaceStore, registerWorkspace } from "./workspace.js";
import { registerStreamBackup } from "./stream-backup.js";

export function buildServer(dataDir: string | undefined, options: { worker: true }): Promise<{ app: FastifyInstance; engine: AsyncEngine & Extraction }>;
export function buildServer(dataDir?: string, options?: { worker?: false }): Promise<{ app: FastifyInstance; engine: Engine }>;
export async function buildServer(dataDir?: string, options: { worker?: boolean } = {}): Promise<{ app: FastifyInstance; engine: Engine | (AsyncEngine & Extraction) }> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024, genReqId: () => randomUUID() });
  registerAuth(app);
  const timings: Array<{ route: string; status: number; ms: number }> = [];
  app.addHook("onRequest", async (request, reply) => { reply.header("x-request-id", request.id); });
  app.addHook("onResponse", async (request, reply) => {
    timings.push({ route: request.routeOptions.url ?? "unmatched", status: reply.statusCode, ms: reply.elapsedTime });
    if (timings.length > 1024) timings.shift();
  });
  app.get("/operations", async () => {
    const sorted = timings.map(sample => sample.ms).sort((a, b) => a - b);
    return { samples: timings.length, p50Ms: sorted[Math.floor(sorted.length * .5)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, p99Ms: sorted[Math.floor(sorted.length * .99)] ?? 0, errors: timings.filter(sample => sample.status >= 500).length, memory: process.memoryUsage(), recent: timings.slice(-20) };
  });
  await app.register(cors, { origin: (origin, callback) => callback(null, !origin || allowedOrigin(origin)) });
  app.addHook("onRequest", async (request, reply) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin && !allowedOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: "origin is not allowed" });
    }
  });
  // File uploads (PDFs, text, code) stream through here; 64 MB per file.
  await app.register(multipart, {
    limits: { fileSize: 64 * 1024 * 1024, files: 200 },
  });

  const engine = options.worker ? await startWorker(dataPaths(dataDir).dataDir) : new Engine(dataDir);
  const extraction: Extraction = options.worker ? { ...inlineExtraction, extract: extractIsolated, available: () => (engine as AsyncEngine & Extraction).available() } : inlineExtraction;
  let jobs: IngestJobs;
  let folders: FolderSources;
  let workspace: WorkspaceStore;
  let semantic: SemanticIndex;
  try {
    workspace = new WorkspaceStore(dataPaths(dataDir).dataDir);
    semantic = new SemanticIndex(engine, dataPaths(dataDir).dataDir);
    jobs = new IngestJobs(engine, dataPaths(dataDir).dataDir);
    folders = new FolderSources(engine, extraction, dataPaths(dataDir).dataDir);
  } catch (error) {
    await Promise.allSettled([jobs!?.close(), folders!?.close()]);
    await engine.close(); throw error;
  }
  const demo = new DemoRuntime();
  let semanticClosing = false, checkingSemantic = false;
  const refreshSemantic = async () => {
    if (semanticClosing || checkingSemantic || !semantic.status().enabled) return;
    checkingSemantic = true;
    try {
      const state = await engine.retrievalStatus();
      if (!semanticClosing && state.indexGeneration !== semantic.status().indexedGeneration) semantic.start();
    } catch { /* Availability is reported by /index/health; retry the next bounded pass. */ }
    finally { checkingSemantic = false; }
  };
  const semanticTimer = setInterval(() => { void refreshSemantic(); }, 30000);
  semanticTimer.unref();
  void refreshSemantic();
  registerRoutes(app, engine, jobs, folders, extraction, demo, workspace);
  registerWorkspace(app, workspace);
  registerStreamBackup(app, engine, workspace, () => jobs.busy() || folders.busy());
  registerRetrieval(app, new Retrieval(engine, semantic, id => workspace.collection(id), () => jobs.busy() || folders.busy()), request => ({
    strategies: ["lexical", "literal", "substring", ...(semantic.status().enabled ? ["dense", "hybrid"] : [])],
    semantic: request.readScope ? { enabled: semantic.status().enabled } : semantic.status(),
    sources: request.readScope ? undefined : folders.list().map(({ id, status, lastSyncedAt, error }) => ({ id, status, lastSyncedAt, error })),
    pendingImports: request.readScope ? undefined : jobs.list().filter(job => ["queued", "running"].includes(job.status)).length,
  }));
  app.get("/ready", async (request, reply) => extraction.available() ? { status: "ready", ...await engine.retrievalStatus(request.readScope) } : reply.code(503).send({ status: "unavailable" }));
  app.get("/index/health", async () => {
    const document = await engine.retrievalStatus(), dense = semantic.status();
    return { status: extraction.available() ? dense.state === "failed" || dense.checkpointError ? "degraded" : "ready" : "unavailable", documentGeneration: document.indexGeneration, semanticComplete: dense.indexedGeneration === document.indexGeneration, indexingLag: Math.max(0, document.indexGeneration - dense.indexedGeneration), semantic: dense };
  });
  app.get("/index/stats", async () => ({ lexical: await engine.diagnostics(), semantic: semantic.status(), memory: process.memoryUsage() }));

  // Flush snapshots and close fds cleanly on shutdown.
  app.addHook("onClose", async () => {
    semanticClosing = true; clearInterval(semanticTimer);
    const results = await Promise.allSettled([semantic.close(), jobs.close(), folders.close(), demo.close()]);
    await engine.close();
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  });

  return { app, engine };
}

function allowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || origin === process.env.SHARDLY_ALLOWED_ORIGIN);
  } catch { return false; }
}

/** Entry point when run directly (npm run dev / start). */
async function main() {
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.env.SHARDLY_ADMIN_TOKEN) throw new Error("Network exposure requires SHARDLY_ADMIN_TOKEN");
  const { app, engine } = await buildServer(undefined, { worker: true });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host });
  console.log(
    `Shardly API listening on http://${host}:${port}  (${await engine.documentCount()} docs indexed)`,
  );
}

// Run only when invoked as the entry module, not when imported by tests.
const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
