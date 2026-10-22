import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { Storage } from "../src/storage/storage.js";
import { Engine } from "../src/engine.js";
import { SemanticIndex } from "../src/search/semantic.js";
import { MockEmbeddings } from "../src/vector/providers.js";

const dirs: string[] = [];
function temporary() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-hybrid-recovery-")); dirs.push(dir); return dir; }
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
it("does not replay records already covered by a published offset checkpoint", () => {
  const directory = temporary(), storage = new Storage(directory);
  const id = storage.write({ version: 1 }); storage.writeWithId(id, { version: 2 }); storage.delete(id);
  const version = storage.stateVersion(), oldWal = fs.readFileSync(path.join(directory, "wal.log"));
  storage.snapshot(); storage.close();
  // A process can die after snapshot rename and before truncating the old WAL.
  fs.writeFileSync(path.join(directory, "wal.log"), oldWal);
  let recovered = new Storage(directory);
  expect(recovered.stateVersion()).toBe(version); expect(recovered.read(id)).toBeNull();
  const after = recovered.write({ after: true }); const position = recovered.diagnostics().walSequence;
  expect(position).toBeGreaterThan(5); recovered.close();
  recovered = new Storage(directory); expect(recovered.read(after)).toEqual({ after: true }); expect(recovered.read(id)).toBeNull(); recovered.close();
});
it.each(["wal-pending", "wal-committed", "acknowledged", "chunk", "embedding", "vector", "graph", "checkpoint-temp", "vector-published", "graph-published", "job-published", "replay"])("recovers documents and derived indexes after SIGKILL during %s", async stage => {
  const directory = temporary(); let engine = new Engine(directory);
  const replaceId = engine.addDocument({ content: "original storage record" }), deleteId = engine.addDocument({ content: "delete this record" });
  const config = { provider: new MockEmbeddings(32) };
  let semantic = new SemanticIndex(engine, directory, config);
  semantic.start(); await semantic.settled(); await semantic.close(); engine.close();
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/hybrid-crash-writer.ts", directory, stage, replaceId, deleteId], { encoding: "utf8", timeout: 15000 });
  expect(result.error).toBeUndefined(); expect(result.signal, result.stderr).toBe("SIGKILL");
  engine = new Engine(directory); semantic = new SemanticIndex(engine, directory, config);
  try {
    const acknowledgements = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : undefined;
    if (acknowledgements) {
      expect(engine.getDocument(acknowledgements.id)?.content).toBe("new durable storage record");
      expect(engine.getDocument(replaceId)?.content).toBe("updated durable storage record");
      expect(engine.getDocument(deleteId)).toBeNull();
      expect((await semantic.search("storage", {})).hits.some(hit => hit.documentId === deleteId)).toBe(false);
    }
    semantic.start(); await semantic.settled(); expect(semantic.status().state).toBe("completed");
    expect(semantic.status().passages).toBe(engine.documentCount());
    expect((await semantic.search("storage", {})).complete).toBe(true);
    const count = semantic.status().passages;
    semantic.start(); await semantic.settled(); expect(semantic.status().passages).toBe(count);
  } finally { await semantic.close(); engine.close(); }
});
