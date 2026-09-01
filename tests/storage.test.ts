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
      byteOffset: segSize + 10, // beyond real data — never fsync'd
      length: 42,
      status: "pending",
    };
    fs.appendFileSync(walPath, JSON.stringify(torn) + "\n");

    const s2 = await freshStorage();
    expect(s2.read("ghost")).toBeNull(); // torn write correctly discarded
    s2.close();
  });
});

describe("compaction", () => {
  it("reclaims tombstoned bytes and keeps live docs readable", async () => {
    let storage = freshStorage();
    const ids = storage.writeBatch(
      Array.from({ length: 200 }, (_, i) => ({ n: i, pad: "x".repeat(500) })),
    );
    storage.snapshot();
    const before = segmentBytes(tmpDir);

    for (let i = 0; i < 200; i += 2) storage.delete(ids[i]!);
    const { reclaimedBytes, removedDocuments } = storage.compact();

    expect(removedDocuments).toBe(100);
    expect(reclaimedBytes).toBeGreaterThan(0);
    expect(segmentBytes(tmpDir)).toBeLessThan(before);
    expect(storage.size()).toBe(100);
    expect(storage.read(ids[0]!)).toBeNull();
    expect(storage.read(ids[1]!)).toEqual({ n: 1, pad: "x".repeat(500) });
    storage.close();

    // Survives a reopen: the new offsets were committed, not just in memory.
    storage = freshStorage();
    expect(storage.size()).toBe(100);
    expect(storage.read(ids[199]!)).toEqual({ n: 199, pad: "x".repeat(500) });
    expect(storage.read(ids[0]!)).toBeNull();
    storage.close();
  });

  it("is a no-op with nothing tombstoned", async () => {
    const storage = freshStorage();
    storage.writeBatch([{ a: 1 }, { b: 2 }]);
    expect(storage.compact()).toEqual({ reclaimedBytes: 0, removedDocuments: 0 });
    expect(storage.size()).toBe(2);
    storage.close();
  });
});

function segmentBytes(dir: string): number {
  const segs = path.join(dir, "segments");
  return fs
    .readdirSync(segs)
    .filter((n) => n.startsWith("segment-"))
    .reduce((sum, n) => sum + fs.statSync(path.join(segs, n)).size, 0);
}
