import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Engine } from "../engine.js";
import { registerRoutes } from "./routes.js";
import { IngestJobs } from "../ingest/jobs.js";
import { DemoRuntime } from "../runtime/demo.js";
import { FolderSources } from "../ingest/folders.js";
import { startWorker, inlineExtraction, type AsyncEngine, type Extraction } from "../runtime/engine.js";
import type { FastifyInstance } from "fastify";
import { dataPaths } from "../config.js";

export function buildServer(dataDir: string | undefined, options: { worker: true }): Promise<{ app: FastifyInstance; engine: AsyncEngine & Extraction }>;
export function buildServer(dataDir?: string, options?: { worker?: false }): Promise<{ app: FastifyInstance; engine: Engine }>;
export async function buildServer(dataDir?: string, options: { worker?: boolean } = {}): Promise<{ app: FastifyInstance; engine: Engine | (AsyncEngine & Extraction) }> {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
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
  const extraction = options.worker ? engine as AsyncEngine & Extraction : inlineExtraction;
  let jobs: IngestJobs;
  let folders: FolderSources;
  try {
    jobs = new IngestJobs(engine, dataPaths(dataDir).dataDir);
    folders = new FolderSources(engine, extraction, dataPaths(dataDir).dataDir);
  } catch (error) { await engine.close(); throw error; }
  const demo = new DemoRuntime();
  registerRoutes(app, engine, jobs, folders, extraction, demo);

  // Flush snapshots and close fds cleanly on shutdown.
  app.addHook("onClose", async () => {
    try { await Promise.all([jobs.close(), folders.close(), demo.close()]); } finally { await engine.close(); }
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
