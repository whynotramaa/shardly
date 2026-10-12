import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startWorker, WorkerUnavailable, type AsyncEngine, type Extraction } from "./engine.js";
import { DEMO_DOCUMENTS, DEMO_IMPORT } from "../ingest/demo.js";
import { InputError } from "../api/validation.js";
import type { StoredDocument } from "../types.js";

export class DemoRuntime {
  private root?: string;
  private engine?: Promise<AsyncEngine & Extraction>;
  private child?: ChildProcess;
  private recovery?: Promise<{ verified: boolean; before: number; after: number; detail: string }>;
  private closed = false;

  private async initialize(): Promise<AsyncEngine & Extraction> {
    if (this.closed) throw new WorkerUnavailable("Demo is shutting down");
    return this.engine ??= (async () => {
      this.root = await fs.mkdtemp(path.join(os.tmpdir(), "shardly-demo-"));
      try { return await startWorker(this.root); }
      catch (error) { await fs.rm(this.root, { recursive: true, force: true }); throw error; }
    })();
  }

  ready(): Promise<AsyncEngine & Extraction> {
    if (this.closed) return Promise.reject(new WorkerUnavailable("Demo is shutting down"));
    if (!this.engine) return Promise.reject(new InputError("Start the demo first"));
    return this.engine;
  }

  async seed() {
    const engine = await this.initialize();
    const result = await engine.ingestDocuments(DEMO_DOCUMENTS);
    return { documents: await engine.documentCount(), ids: result.ids };
  }

  async import() {
    const engine = await this.ready();
    const result = await engine.ingestDocuments(DEMO_IMPORT);
    return { added: result.added, updated: result.updated, duplicates: result.duplicates, documents: await engine.documentCount() };
  }

  async durability() {
    if (this.recovery) throw new InputError("Demo recovery check is already running");
    const engine = await this.ready();
    if (this.recovery) throw new InputError("Demo recovery check is already running");
    // Reserve before awaiting exports so concurrent clicks cannot create extra child writers.
    const operation = (async () => {
      const records = (await engine.exportBackup()).documents;
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "shardly-demo-recovery-"));
      let recovered: AsyncEngine | undefined;
      try {
        const acknowledged = await this.killWriter(root, records);
        recovered = await startWorker(root);
        let verified = acknowledged.length === records.length;
        for (const record of records) {
          const doc = await recovered.getDocument(record.id);
          if (!acknowledged.includes(record.id) || JSON.stringify(doc) !== JSON.stringify(record.doc)) verified = false;
        }
        const after = await recovered.documentCount();
        return { verified: verified && after === records.length, before: acknowledged.length, after, detail: verified && after === records.length ? "Acknowledged demo records verified after SIGKILL and WAL replay in a separate temporary store." : "Recovered demo records did not match the acknowledged records after SIGKILL." };
      } finally {
        this.child?.kill("SIGKILL");
        this.child = undefined;
        try { await recovered?.close(); } finally { await fs.rm(root, { recursive: true, force: true }); }
      }
    })();
    this.recovery = operation;
    try { return await operation; } finally { this.recovery = undefined; }
  }

  private killWriter(root: string, records: StoredDocument[]): Promise<string[]> {
    const source = import.meta.url.endsWith(".ts");
    const module = new URL(source ? "./demo-writer.ts" : "./demo-writer.js", import.meta.url);
    return new Promise((resolve, reject) => {
      const child = fork(fileURLToPath(module), [root], { execArgv: source ? ["--import", "tsx"] : [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
      this.child = child;
      let acknowledged: string[] | undefined;
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 10000);
      child.once("error", reject);
      child.once("message", (message: { acknowledged?: string[] }) => {
        acknowledged = message.acknowledged;
        child.kill("SIGKILL");
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (signal !== "SIGKILL" || !acknowledged?.length) reject(new Error(`Demo writer failed before acknowledgement (${signal ?? code})`));
        else resolve(acknowledged);
      });
      child.send(records, error => { if (error) { child.kill("SIGKILL"); reject(error); } });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.child?.kill("SIGKILL");
    await this.recovery?.catch(() => {});
    try { if (this.engine) await (await this.engine).close(); }
    finally { if (this.root) await fs.rm(this.root, { recursive: true, force: true }); }
  }
}
