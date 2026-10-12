import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { RuntimeEngine } from "../runtime/engine.js";
import { fetchGithubDocuments } from "./github.js";
import { countCorpus, streamCorpus } from "./corpus.js";
import { InputError, object, text, flag, optionalText } from "../api/validation.js";

export interface JobRequest {
  kind: "github" | "wikipedia";
  user?: string;
  deep?: boolean;
}
export interface IngestJob {
  id: string;
  request: JobRequest;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: string;
  updatedAt: string;
  progress: { completed: number; total: number; indexed: number };
  error?: string;
  result?: unknown;
}

export function jobRequest(input: unknown): { request: JobRequest; token?: string } {
  const body = object(input);
  if (body.kind !== "github" && body.kind !== "wikipedia") throw new InputError("job kind must be github or wikipedia");
  return {
    request: body.kind === "github"
      ? { kind: "github", user: text(body.user, "GitHub target", 256), deep: flag(body.deep, "deep") ?? false }
      : { kind: "wikipedia" },
    token: optionalText(body.token, "GitHub token", 512),
  };
}

export class IngestJobs {
  private readonly jobs = new Map<string, IngestJob>();
  private readonly tokens = new Map<string, string>();
  private readonly file: string;
  private active: { id: string; controller: AbortController; promise: Promise<void> } | undefined;
  private closed = false;
  private persistenceError: string | undefined;

  constructor(private readonly engine: RuntimeEngine, dataDir: string) {
    this.file = path.join(dataDir, "jobs.json");
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8")) as IngestJob[];
      if (!Array.isArray(saved) || saved.length > 100) throw new Error("Invalid ingestion job history");
      for (const job of saved) {
        if (!validSavedJob(job)) throw new Error("Invalid ingestion job history");
        // Credentials stay in memory; interrupted imports require an explicit retry.
        if (job.status === "running" || job.status === "queued") {
          job.status = "interrupted";
          job.error = "Server stopped before completion. Retry to resume; imported batches are retained.";
        }
        this.jobs.set(job.id, job);
      }
      this.persist();
    }
  }

  list(): IngestJob[] { return [...this.jobs.values()].reverse(); }
  get(id: string): IngestJob | undefined { return this.jobs.get(id); }
  busy(): boolean { return this.active !== undefined || [...this.jobs.values()].some((j) => j.status === "queued"); }

  create(input: unknown): IngestJob {
    if (this.closed) throw new InputError("ingestion is shutting down");
    if (this.persistenceError) throw new Error(this.persistenceError);
    if ([...this.jobs.values()].filter((job) => job.status === "queued" || job.status === "running").length >= 20) {
      throw new InputError("ingestion queue is full");
    }
    const { request, token } = jobRequest(input);
    const now = new Date().toISOString();
    const job: IngestJob = { id: randomUUID(), request, status: "queued", createdAt: now, updatedAt: now, progress: { completed: 0, total: 0, indexed: 0 } };
    this.jobs.set(job.id, job);
    if (token) this.tokens.set(job.id, token);
    for (const old of this.jobs.values()) {
      if (this.jobs.size <= 100) break;
      if (old.status !== "queued" && old.status !== "running") this.jobs.delete(old.id);
    }
    try { this.persist(); }
    catch (error) { this.jobs.delete(job.id); this.tokens.delete(job.id); throw error; }
    setImmediate(() => this.pump());
    return job;
  }

  cancel(id: string): IngestJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status === "queued") {
      job.status = "cancelled";
      this.tokens.delete(id);
      this.persist();
    } else if (job.status === "running") {
      this.active?.controller.abort();
    }
    return job;
  }

  retry(id: string, token?: string): IngestJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status === "queued" || job.status === "running") throw new InputError("cancel the active job before retrying");
    return this.create({ ...job.request, token });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.active?.controller.abort();
    await this.active?.promise;
    for (const job of this.jobs.values()) {
      if (job.status === "queued") job.status = "interrupted";
    }
    this.tokens.clear();
    this.persist();
  }

  private pump(): void {
    if (this.closed || this.active || this.persistenceError) return;
    const job = [...this.jobs.values()].find((j) => j.status === "queued");
    if (!job) return;
    const controller = new AbortController();
    const promise = this.run(job, controller.signal).catch(() => {
      // Stop the queue if job history cannot be saved; preserve the failure in memory.
      this.persistenceError = "Cannot save ingestion job history. Check disk space and permissions, then restart the server.";
      job.status = "failed";
      job.error = this.persistenceError;
      this.tokens.delete(job.id);
    }).finally(() => {
      this.active = undefined;
      setImmediate(() => this.pump());
    });
    this.active = { id: job.id, controller, promise };
  }

  private async run(job: IngestJob, signal: AbortSignal): Promise<void> {
    job.status = "running";
    try {
      this.persist();
      if (job.request.kind === "github") {
        const { docs, summary } = await fetchGithubDocuments({
          user: job.request.user!, deep: job.request.deep, token: this.tokens.get(job.id), signal,
          onProgress: (completed, total) => {
            job.progress = { ...job.progress, completed, total };
            this.persist();
          },
        });
        signal.throwIfAborted();
        const ingestion = await this.engine.ingestDocuments(docs);
        job.progress.indexed = docs.length;
        job.result = { ...summary, ingestion, documents: await this.engine.documentCount() };
      } else {
        job.progress.total = await countCorpus();
        await streamCorpus(async (docs) => {
          signal.throwIfAborted();
          await this.engine.ingestDocuments(docs);
          job.progress.completed += docs.length;
          job.progress.indexed += docs.length;
          this.persist();
          await yieldTurn();
        });
        job.result = { documents: await this.engine.documentCount() };
      }
      await this.engine.snapshot();
      job.status = "completed";
    } catch (error) {
      job.status = signal.aborted ? "cancelled" : "failed";
      job.error = signal.aborted ? "Import cancelled. Completed batches are retained." : error instanceof Error ? error.message : "Import failed";
      const token = this.tokens.get(job.id);
      if (token) job.error = job.error.replaceAll(token, "[redacted]");
    } finally {
      this.tokens.delete(job.id);
      job.updatedAt = new Date().toISOString();
      this.persist();
    }
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify([...this.jobs.values()])); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    const dir = fs.openSync(path.dirname(this.file), "r");
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}

function validSavedJob(job: IngestJob): boolean {
  return !!job && typeof job.id === "string" && job.id.length <= 128 &&
    !!job.request && (job.request.kind === "wikipedia" ||
      (job.request.kind === "github" && typeof job.request.user === "string" && job.request.user.length <= 256 &&
        (job.request.deep === undefined || typeof job.request.deep === "boolean"))) &&
    ["queued", "running", "completed", "failed", "cancelled", "interrupted"].includes(job.status) &&
    typeof job.createdAt === "string" && Number.isFinite(Date.parse(job.createdAt)) &&
    typeof job.updatedAt === "string" && Number.isFinite(Date.parse(job.updatedAt)) &&
    !!job.progress && [job.progress.completed, job.progress.total, job.progress.indexed].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    (job.error === undefined || typeof job.error === "string");
}
