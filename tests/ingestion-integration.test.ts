import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/api/server.js";
import { countCorpus } from "../src/ingest/corpus.js";

describe("offline import lifecycle", () => {
  it("completes and safely retries the real bundled corpus without duplicating it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-import-"));
    const { app, engine } = await buildServer(dir);
    try {
      const available = await countCorpus();
      expect(available).toBeGreaterThan(0);
      const first = (await app.inject({ method: "POST", url: "/jobs", payload: { kind: "wikipedia" } })).json();
      async function complete(id: string) {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const state = (await app.inject({ method: "GET", url: `/jobs/${id}` })).json();
          if (state.status === "completed") return state;
          if (["failed", "cancelled", "interrupted"].includes(state.status)) throw new Error(state.error);
          await nextTurn();
        }
        throw new Error("offline import timed out");
      }
      expect((await complete(first.id)).progress.indexed).toBe(available);
      const originalCount = engine.documentCount();
      const retry = (await app.inject({ method: "POST", url: `/jobs/${first.id}/retry`, payload: {} })).json();
      expect(retry.id).not.toBe(first.id);
      await complete(retry.id);
      expect(engine.documentCount()).toBe(originalCount);
      expect(engine.search("source:wikipedia", { limit: 1 }).total).toBe(originalCount);
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
