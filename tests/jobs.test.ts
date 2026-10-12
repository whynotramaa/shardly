import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "../src/engine.js";
import { IngestJobs } from "../src/ingest/jobs.js";
import { fetchGithubDocuments } from "../src/ingest/github.js";

vi.mock("../src/ingest/github.js", () => ({ fetchGithubDocuments: vi.fn() }));
let dir: string;
let jobs: IngestJobs;
const ingest = vi.fn(() => ({ ids: [], added: 0, updated: 0, duplicates: 0 }));
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-jobs-"));
  jobs = new IngestJobs({ ingestDocuments: ingest, snapshot: vi.fn(), documentCount: () => 0 } as unknown as Engine, dir);
  vi.mocked(fetchGithubDocuments).mockReset();
  ingest.mockClear();
});
afterEach(async () => { vi.restoreAllMocks(); await jobs.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("bounded import jobs", () => {
  it("stops the queue safely when saving job history fails", async () => {
    const job = jobs.create({ kind: "github", user: "demo/core", token: "secret" });
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      if (String(args[0]).endsWith("jobs.json.tmp")) throw new Error("disk full");
      return open(...args);
    }) as typeof fs.openSync);
    await nextTurn();
    await nextTurn();
    expect(job.status).toBe("failed");
    expect(job.error).toContain("Cannot save");
    expect(fetchGithubDocuments).not.toHaveBeenCalled();
    expect(() => jobs.create({ kind: "github", user: "demo/other" })).toThrow("Cannot save");
  });
  it("cancels queued work without fetching and never persists the token", async () => {
    const job = jobs.create({ kind: "github", user: "demo/core", token: "private-token" });
    expect(fs.readFileSync(path.join(dir, "jobs.json"), "utf8")).not.toContain("private-token");
    jobs.cancel(job.id);
    await nextTurn();
    expect(job.status).toBe("cancelled");
    expect(fetchGithubDocuments).not.toHaveBeenCalled();
  });

  it("cancels an in-flight fetch and does not ingest its result", async () => {
    vi.mocked(fetchGithubDocuments).mockImplementation(({ signal }) => new Promise((resolve, reject) => {
      void resolve;
      signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const job = jobs.create({ kind: "github", user: "demo/core" });
    await nextTurn();
    expect(job.status).toBe("running");
    jobs.cancel(job.id);
    await nextTurn();
    expect(job.status).toBe("cancelled");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("records failures and retries them as a separate job", async () => {
    vi.mocked(fetchGithubDocuments).mockRejectedValue(new Error("network unavailable private-token"));
    const job = jobs.create({ kind: "github", user: "demo/core", token: "private-token" });
    await nextTurn();
    await nextTurn();
    expect(job.status).toBe("failed");
    expect(job.error).not.toContain("private-token");
    const retry = jobs.retry(job.id)!;
    expect(retry.id).not.toBe(job.id);
    expect(retry.status).toBe("queued");
    jobs.cancel(retry.id);
  });

  it("marks persisted unfinished jobs interrupted on restart", async () => {
    const job = jobs.create({ kind: "github", user: "demo/core" });
    const persisted = fs.readFileSync(path.join(dir, "jobs.json"), "utf8");
    jobs.cancel(job.id);
    await jobs.close();
    fs.writeFileSync(path.join(dir, "jobs.json"), persisted);
    jobs = new IngestJobs({ ingestDocuments: ingest, snapshot: vi.fn(), documentCount: () => 0 } as unknown as Engine, dir);
    expect(jobs.get(job.id)?.status).toBe("interrupted");
    expect(jobs.busy()).toBe(false);
  });
});
