import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage/storage.js";

/** Each test runs against a fresh temp data dir passed straight into Storage. */
let tmpDir: string;

function freshStorage() {
  return new Storage(tmpDir);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-store-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Storage", () => {
  it("writes and reads a document back exactly", async () => {
    const s = await freshStorage();
    const id = s.write({ title: "hello", body: "world" });
    expect(s.read(id)).toEqual({ title: "hello", body: "world" });
    s.close();
  });

  it("returns null for unknown ids", async () => {
    const s = await freshStorage();
    expect(s.read("nope")).toBeNull();
    s.close();
  });

  it("tombstones on delete", async () => {
    const s = await freshStorage();
    const id = s.write({ a: 1 });
    expect(s.delete(id)).toBe(true);
    expect(s.read(id)).toBeNull();
    expect(s.delete(id)).toBe(false); // already deleted
    expect(s.size()).toBe(0);
    s.close();
  });

  it("reads survive reopen via offset snapshot + WAL replay", async () => {
    let s = await freshStorage();
    const ids = [s.write({ n: 1 }), s.write({ n: 2 }), s.write({ n: 3 })];
    s.delete(ids[1]!);
    s.close();

    s = await freshStorage(); // simulates a clean restart
    expect(s.read(ids[0]!)).toEqual({ n: 1 });
    expect(s.read(ids[1]!)).toBeNull(); // tombstone survived
    expect(s.read(ids[2]!)).toEqual({ n: 3 });
    expect(s.size()).toBe(2);
    s.close();
  });

  it("recovers a committed write when the offset snapshot is stale", async () => {
    const s = await freshStorage();
    const id = s.write({ important: true });
    s.close();

    const snapshot = path.join(tmpDir, "index", "offset-index.snapshot.json");
    fs.writeFileSync(snapshot, ""); // pretend snapshot never captured this write

    const s2 = await freshStorage(); // must recover from the WAL
    expect(s2.read(id)).toEqual({ important: true });
    s2.close();
  });

  it("batch writes are readable and survive reopen", async () => {
    let s = freshStorage();
    const ids = s.writeBatch([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(ids).toHaveLength(3);
    expect(s.read(ids[0]!)).toEqual({ n: 1 });
    expect(s.read(ids[2]!)).toEqual({ n: 3 });
    s.close();

    s = freshStorage();
    expect(s.read(ids[1]!)).toEqual({ n: 2 });
    expect(s.size()).toBe(3);
    s.close();
  });

  it("discards a torn write: pending WAL entry with no matching segment bytes", async () => {
    const s = await freshStorage();
    s.write({ real: 1 });
    s.close();

    // Hand-craft a pending-only WAL entry pointing past the end of the segment.
    const walPath = path.join(tmpDir, "wal.log");
    const seg = "segment-0000.log";
    const segSize = fs.statSync(path.join(tmpDir, "segments", seg)).size;
    const torn = {
      op: "write",
      docId: "ghost",
      segment: seg,
      byteOffset: segSize + 10, // beyond real data ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â never fsync'd
      length: 42,
      status: "pending",
    };
    fs.appendFileSync(walPath, JSON.stringify(torn) + "\n");

    const s2 = await freshStorage();
    expect(s2.read("ghost")).toBeNull(); // torn write correctly discarded
    s2.close();
  });
});





