import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Engine } from "../engine.js";
import { registerRoutes } from "./routes.js";


export async function buildServer(dataDir?: string) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  // File uploads (PDFs, text, code) stream through here; 64 MB per file.
  await app.register(multipart, {
    limits: { fileSize: 64 * 1024 * 1024, files: 200 },
  });

  const engine = new Engine(dataDir);
  registerRoutes(app, engine);

  // Flush snapshots and close fds cleanly on shutdown.
  app.addHook("onClose", async () => {
    engine.close();
  });

  return { app, engine };
}

/** Entry point when run directly (npm run dev / start). */
async function main() {
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const { app, engine } = await buildServer();

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port, host });
  // eslint-disable-next-line no-console
  console.log(
    `Shardly API listening on http://${host}:${port}  (${engine.documentCount()} docs indexed)`,
  );
}

// Run only when invoked as the entry module, not when imported by tests.
const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}







