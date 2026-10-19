import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import type { FastifyInstance } from "fastify";
import type { RuntimeEngine } from "../runtime/engine.js";
import { WorkspaceStore, validateWorkspace, type WorkspaceState } from "./workspace.js";
import { object, documents, text } from "./validation.js";

export function registerStreamBackup(app: FastifyInstance, engine: RuntimeEngine, workspace: WorkspaceStore, busy: () => boolean) {
  app.addContentTypeParser("application/x-ndjson", (request, payload, done) => { void request; done(null, payload); });
  app.get("/backup/stream", async (request, reply) => {
    void request;
    const generation = (await engine.retrievalStatus()).indexGeneration;
    async function* lines() {
      const hash = createHash("sha256"); let count = 0;
      const header = JSON.stringify({ type: "header", version: 2, generation, workspace: workspace.get() }) + "\n";
      hash.update(header); yield header;
      for (let offset = 0; ;) {
        const batch = await engine.backupPage(offset);
        if (batch.indexGeneration !== generation) throw new Error("Index changed during export; repeat the backup");
        if (!batch.items.length) break;
        for (const item of batch.items) {
          const line = JSON.stringify({ type: "document", id: item.id, doc: item.doc }) + "\n";
          hash.update(line); count++; yield line;
        }
        offset += batch.items.length;
      }
      if ((await engine.retrievalStatus()).indexGeneration !== generation) throw new Error("Index changed during export; repeat the backup");
      yield JSON.stringify({ type: "footer", count, sha256: hash.digest("hex") }) + "\n";
    }
    reply.header("content-type", "application/x-ndjson").header("cache-control", "no-store").header("content-disposition", 'attachment; filename="shardly-backup.ndjson"');
    return reply.send(Readable.from(lines()));
  });
  app.post("/backup/stream", async request => {
    if (busy()) throw Object.assign(new Error("cancel active ingestion before restoring"), { statusCode: 400 });
    if (!request.body || !(Symbol.asyncIterator in Object(request.body))) throw Object.assign(new Error("send an application/x-ndjson stream"), { statusCode: 400 });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "shardly-restore-"));
    const file = path.join(directory, "validated.ndjson");
    const handle = await fs.open(file, "wx", 0o600);
    let savedWorkspace: WorkspaceState | undefined;
    let count = 0, added = 0, duplicates = 0;
    try {
      const hash = createHash("sha256"), ids = new Set<string>();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let pending = "", bytes = 0, header = false, footer = false;
      for await (const chunk of request.body as Readable) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 256 * 1024 * 1024) throw new Error("stream restore exceeds 256 MiB budget");
        pending += decoder.decode(chunk as Uint8Array, { stream: true });
        let at: number;
        while ((at = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, at); pending = pending.slice(at + 1);
          if (Buffer.byteLength(line) > 16 * 1024 * 1024 || footer) throw new Error("invalid trailing or oversized backup record");
          const row = object(JSON.parse(line), "backup record");
          if (!header) {
            if (row.type !== "header" || row.version !== 2) throw new Error("invalid backup header");
            savedWorkspace = validateWorkspace(row.workspace); header = true; hash.update(line + "\n");
          } else if (row.type === "footer") {
            if (row.count !== count || row.sha256 !== hash.digest("hex")) throw new Error("backup checksum or count mismatch");
            footer = true;
          } else {
            if (row.type !== "document" || ++count > 100000) throw new Error("invalid backup record or document budget exceeded");
            const id = text(row.id, "document id", 128);
            if (id !== row.id || !/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error("invalid or duplicate backup id");
            ids.add(id); documents([row.doc]);
            const existing = await engine.getDocument(id);
            if (existing !== null) {
              // The engine owns canonical equality and validates a one-record merge without overwrites.
              const before = await engine.documentCount();
              const checked = await engine.restoreBackup({ version: 1, documents: [{ id, doc: row.doc }] });
              if (checked.added || await engine.documentCount() !== before) throw new Error("restore preflight invariant failed");
            }
            hash.update(line + "\n"); await handle.writeFile(line + "\n");
          }
        }
        if (pending.length > 16 * 1024 * 1024) throw new Error("backup record exceeds line budget");
      }
      pending += decoder.decode();
      if (pending.length || !footer) throw new Error("backup is incomplete; no documents were restored");
      await handle.close();
      const stream = await fs.open(file, "r");
      const reader = stream.createReadStream();
      try {
        for await (const line of readline.createInterface({ input: reader, crlfDelay: Infinity })) {
          const row = JSON.parse(line) as { id: string; doc: Record<string, unknown> };
          const result = await engine.restoreBackup({ version: 1, documents: [{ id: row.id, doc: row.doc }] });
          added += result.added; duplicates += result.duplicates;
        }
      } finally { reader.destroy(); }
      if (savedWorkspace) workspace.save(savedWorkspace);
      await engine.snapshot();
      return { added, duplicates, count };
    } catch (error) { throw Object.assign(error as Error, { statusCode: 400 }); }
    finally { await handle.close().catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); }
  });
}
