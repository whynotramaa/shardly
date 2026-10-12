import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countCorpus, streamCorpus } from "../src/ingest/corpus.js";

describe("offline corpus", () => {
  it("counts only importable records, retains stable identities and awaits batches", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-corpus-"));
    const file = path.join(dir, "wiki.ndjson");
    fs.writeFileSync(file, 'null\ninvalid\n[]\n{"source":"wikipedia","pageid":17,"content":"first"}\n{"source":"wikipedia","pageid":18,"content":"second"}\n');
    try {
      expect(await countCorpus(file)).toBe(2);
      const ids: unknown[] = [];
      let pending = false;
      await streamCorpus(async docs => {
        expect(pending).toBe(false);
        pending = true;
        await new Promise(resolve => setImmediate(resolve));
        ids.push(...docs.map(doc => doc.sourceId));
        pending = false;
      }, 1, file);
      expect(ids).toEqual(["wikipedia:17", "wikipedia:18"]);
      await expect(streamCorpus(() => { throw new Error("cancelled"); }, 1, file)).rejects.toThrow("cancelled");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
