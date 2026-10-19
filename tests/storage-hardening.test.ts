import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Storage } from "../src/storage/storage.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-hardening-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("storage hardening", () => {
  it("recovers original records after SIGKILL at an async compaction yield", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const ids = storage.writeBatch(Array.from({ length: 40 }, (_, n) => ({ n })));
    storage.delete(ids[0]!);
    storage.close();
    const module = new URL("../src/storage/storage.js", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { Storage } from ${JSON.stringify(module)};
      const storage = new Storage(process.argv[1]);
      void storage.compactAsync();
      process.kill(process.pid, "SIGKILL");
    `, dir], { timeout: 10000, encoding: "utf8" });
    expect(child.error).toBeUndefined();
    expect(child.signal, child.stderr).toBe("SIGKILL");
    const recovered = new Storage(dir);
    try {
      expect(recovered.read(ids[0]!)).toBeNull();
      for (let n = 1; n < ids.length; n++) expect(recovered.read(ids[n]!)).toEqual({ n });
      expect(recovered.write({ after: true })).toBeTruthy();
    } finally { recovered.close(); }
  });
  it("reconciles a partial append before allowing another acknowledged write", () => {
    const dir = tempDir();
    const realWrite = fs.writeSync;
    let injected = false;
    const writeSpy = vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, buffer: NodeJS.TypedArray, offset: number, length: number, position?: number | null) => {
      if (!injected && Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString("utf8").includes('"doc"')) {
        injected = true;
        realWrite(fd, buffer, offset, Math.max(1, Math.floor(length / 2)), position);
        throw new Error("injected short write");
      }
      return realWrite(fd, buffer, offset, length, position);
    }) as typeof fs.writeSync);
    const storage = new Storage(dir);
    expect(() => storage.write({ first: true })).toThrow(/short write/);
    const id = storage.write({ second: true });
    expect(storage.read(id)).toEqual({ second: true });
    storage.close();
    writeSpy.mockRestore();
    const reopened = new Storage(dir);
    expect(reopened.read(id)).toEqual({ second: true });
    reopened.close();
  });

  it.each(["pending", "committed"])("blocks later writes after a partial %s WAL append", (status) => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const prior = storage.write({ acknowledged: true });
    const realWrite = fs.writeSync;
    let injected = false;
    vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, buffer: NodeJS.TypedArray, offset: number, length: number, position?: number | null) => {
      if (!injected && Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString().includes(`"status":"${status}"`)) {
        injected = true;
        realWrite(fd, buffer, offset, Math.floor(length / 2), position);
        throw new Error("partial WAL append");
      }
      return realWrite(fd, buffer, offset, length, position);
    }) as typeof fs.writeSync);
    expect(() => storage.write({ failed: true })).toThrow(/partial WAL/);
    expect(() => storage.write({ later: true })).toThrow(/WAL writer is broken/);
    expect(() => storage.writeBatch([{ laterBatch: true }])).toThrow(/WAL writer is broken/);
    expect(() => storage.delete(prior)).toThrow(/WAL writer is broken/);
    storage.close();
    vi.restoreAllMocks();
    const reopened = new Storage(dir);
    expect(reopened.read(prior)).toEqual({ acknowledged: true });
    const later = reopened.write({ afterReopen: true });
    reopened.close();
    const again = new Storage(dir);
    expect(again.read(later)).toEqual({ afterReopen: true });
    again.close();
  });

  it("resumes a poisoned WAL only after a successful checkpoint", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const prior = storage.write({ prior: true });
    const realWrite = fs.writeSync;
    vi.spyOn(fs, "writeSync").mockImplementationOnce(((fd: number, buffer: NodeJS.TypedArray, offset: number, length: number): number => {
      realWrite(fd, buffer, offset, 1);
      throw new Error("partial WAL append");
    }) as typeof fs.writeSync);
    expect(() => storage.write({ failed: true })).toThrow(/partial WAL/);
    vi.restoreAllMocks();
    storage.snapshot();
    const later = storage.write({ later: true });
    storage.close();
    const reopened = new Storage(dir);
    expect(reopened.read(prior)).toEqual({ prior: true });
    expect(reopened.read(later)).toEqual({ later: true });
    reopened.close();
  });

  it("keeps the WAL poisoned after append fsync and checkpoint failures", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const prior = storage.write({ prior: true });
    const realSync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("wal.log")) throw new Error("WAL fsync failure");
      realSync(fd);
    });
    expect(() => storage.write({ failed: true })).toThrow(/WAL fsync/);
    expect(() => storage.write({ blocked: true })).toThrow(/WAL writer is broken/);
    expect(() => storage.snapshot()).toThrow(/WAL fsync/);
    expect(() => storage.write({ stillBlocked: true })).toThrow(/WAL writer is broken/);
    vi.restoreAllMocks();
    storage.snapshot();
    const later = storage.write({ later: true });
    storage.close();
    const reopened = new Storage(dir);
    expect(reopened.read(prior)).toEqual({ prior: true });
    expect(reopened.read(later)).toEqual({ later: true });
    reopened.close();
  });

  it("keeps both reset generations after a post-rename directory fsync failure", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const prior = storage.write({ prior: true });
    const realSync = fs.fsyncSync;
    const realRename = fs.renameSync;
    let renames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, target: fs.PathLike) => {
      realRename(source, target);
      renames++;
    }) as typeof fs.renameSync);
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (renames === 2 && fs.fstatSync(fd).isDirectory() && fs.readlinkSync(`/proc/self/fd/${fd}`) === path.join(dir, "index")) throw new Error("reset directory fsync failure");
      realSync(fd);
    });
    expect(() => storage.reset()).toThrow(/directory fsync failure/);
    expect(storage.size()).toBe(0);
    expect(fs.existsSync(path.join(dir, "segments", "segment-0000.log"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "segments", "segment-0001.log"))).toBe(true);
    storage.close();
    vi.restoreAllMocks();
    const reopened = new Storage(dir);
    expect(reopened.read(prior)).toBeNull();
    const later = reopened.write({ later: true });
    reopened.close();
    const again = new Storage(dir);
    expect(again.read(later)).toEqual({ later: true });
    again.close();
  });

  it("loops over successful short writes in WAL, segments, and snapshots", () => {
    const dir = tempDir();
    const realWrite = fs.writeSync;
    let shortWrites = 0;
    vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, buffer: NodeJS.TypedArray, offset: number, length: number, position?: number | null) => {
      if (length > 7) shortWrites++;
      return realWrite(fd, buffer, offset, Math.min(length, 7), position);
    }) as typeof fs.writeSync);
    const storage = new Storage(dir);
    const ids = storage.writeBatch([{ first: true }, { second: true }]);
    storage.snapshot();
    storage.close();
    expect(shortWrites).toBeGreaterThan(10);
    vi.restoreAllMocks();
    const reopened = new Storage(dir);
    expect(reopened.read(ids[0]!)).toEqual({ first: true });
    expect(reopened.read(ids[1]!)).toEqual({ second: true });
    reopened.close();
  });

  it.each(["compact", "compactAsync"] as const)("rolls back %s when the new snapshot rename actually fails", async (method) => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const ids = storage.writeBatch(Array.from({ length: 40 }, (_, i) => ({ n: i + 1 })));
    storage.delete(ids[0]!);
    const realRename = fs.renameSync;
    let renames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, target: fs.PathLike) => {
      if (++renames === 2) throw new Error("pre-rename failure");
      realRename(source, target);
    }) as typeof fs.renameSync);
    await expect(Promise.resolve().then(() => storage[method]())).rejects.toThrow(/pre-rename/);
    expect(storage.read(ids[1]!)).toEqual({ n: 2 });
    vi.restoreAllMocks();
    const later = storage.write({ later: true });
    storage.close();
    const reopened = new Storage(dir);
    expect(reopened.read(ids[1]!)).toEqual({ n: 2 });
    expect(reopened.read(ids[0]!)).toBeNull();
    expect(reopened.read(later)).toEqual({ later: true });
    reopened.close();
  });

  it.each(["compact", "reset"] as const)("fsyncs the new segment directory before the %s snapshot rename", (operation) => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const ids = storage.writeBatch([{ n: 1 }, { n: 2 }]);
    storage.delete(ids[0]!);
    const realSync = fs.fsyncSync;
    const realRename = fs.renameSync;
    let syncedNewDirectory = false;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (fs.fstatSync(fd).isDirectory() && fs.readlinkSync(`/proc/self/fd/${fd}`) === path.join(dir, "segments") && fs.existsSync(path.join(dir, "segments", "segment-0001.log"))) syncedNewDirectory = true;
      realSync(fd);
    });
    let renames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, target: fs.PathLike) => {
      if (++renames === 2) expect(syncedNewDirectory).toBe(true);
      realRename(source, target);
    }) as typeof fs.renameSync);
    storage[operation]();
    expect(renames).toBe(2);
    storage.close();
  });

  it.each([false, true])("keeps reset recoverable when snapshot rename fails after commit=%s", (afterRename) => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const prior = storage.write({ prior: true });
    const realRename = fs.renameSync;
    let renames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, target: fs.PathLike) => {
      if (++renames === 2) {
        if (afterRename) realRename(source, target);
        throw new Error("reset rename failure");
      }
      realRename(source, target);
    }) as typeof fs.renameSync);
    expect(() => storage.reset()).toThrow(/reset rename/);
    expect(storage.read(prior)).toEqual(afterRename ? null : { prior: true });
    expect(fs.existsSync(path.join(dir, "segments", "segment-0000.log"))).toBe(true);
    vi.restoreAllMocks();
    const later = storage.write({ later: true });
    storage.close();
    const reopened = new Storage(dir);
    expect(reopened.read(prior)).toEqual(afterRename ? null : { prior: true });
    expect(reopened.read(later)).toEqual({ later: true });
    reopened.close();
  });

  it("keeps the committed empty reset when old segment deletion fails", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const prior = storage.write({ prior: true });
    const realRemove = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
      if (String(target).endsWith("segment-0000.log")) throw new Error("reset cleanup failure");
      realRemove(target, options);
    }) as typeof fs.rmSync);
    expect(() => storage.reset()).toThrow(/cleanup failure/);
    expect(storage.size()).toBe(0);
    vi.restoreAllMocks();
    storage.close();
    const reopened = new Storage(dir);
    expect(reopened.read(prior)).toBeNull();
    expect(reopened.size()).toBe(0);
    reopened.close();
  });

  it("preserves the old reset state when new segment fsync fails", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const prior = storage.write({ prior: true });
    const realSync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("segment-0001.log")) throw new Error("reset segment fsync failure");
      realSync(fd);
    });
    expect(() => storage.reset()).toThrow(/segment fsync failure/);
    expect(storage.read(prior)).toEqual({ prior: true });
    storage.close();
    vi.restoreAllMocks();
    const reopened = new Storage(dir);
    expect(reopened.read(prior)).toEqual({ prior: true });
    reopened.close();
  });

  it("handles short reads by looping until the record is complete", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const id = storage.write({ read: "in chunks" });
    storage.close();
    const realRead = fs.readSync;
    const readSpy = vi.spyOn(fs, "readSync").mockImplementation(((fd: number, buffer: NodeJS.TypedArray, offset: number, length: number, position?: number | null) => realRead(fd, buffer, offset, Math.min(length, 1), position ?? null)) as typeof fs.readSync);
    const reopened = new Storage(dir);
    expect(reopened.read(id)).toEqual({ read: "in chunks" });
    reopened.close();
    readSpy.mockRestore();
  });

  it.each(["compact", "compactAsync"] as const)("keeps the post-rename %s state when directory fsync reports failure", async (method) => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const ids = storage.writeBatch(Array.from({ length: 40 }, (_, i) => ({ n: i + 1 })));
    storage.delete(ids[0]!);
    const realRename = fs.renameSync;
    let snapshotRenames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      realRename(oldPath, newPath);
      if (String(newPath).endsWith("offset-index.snapshot.json") && ++snapshotRenames === 2) throw new Error("injected post-rename failure");
    }) as typeof fs.renameSync);
    await expect(Promise.resolve().then(() => storage[method]())).rejects.toThrow(/post-rename/);
    expect(storage.read(ids[1]!)).toEqual({ n: 2 });
    storage.close();
    vi.restoreAllMocks();
    const reopened = new Storage(dir);
    expect(reopened.read(ids[1]!)).toEqual({ n: 2 });
    expect(reopened.read(ids[0]!)).toBeNull();
    reopened.close();
  });

  it("replaces by ID and preserves replacement/delete WAL order across reopen", () => {
    const dir = tempDir();
    let storage = new Storage(dir);
    const id = storage.writeWithId("portable-id", { version: 1 });
    storage.writeWithId(id, { version: 2 });
    expect(storage.read(id)).toEqual({ version: 2 });
    storage.delete(id);
    storage.close();

    storage = new Storage(dir);
    expect(storage.read(id)).toBeNull();
    expect(storage.size()).toBe(0);
    storage.close();
  });

  it("writes a batch that crosses a segment boundary with WAL intents first", () => {
    const dir = tempDir();
    let storage = new Storage(dir);
    const pad = "x".repeat(33 * 1024 * 1024);
    const ids = storage.writeBatch([{ n: 1, pad }, { n: 2, pad }]);
    expect(ids).toHaveLength(2);
    expect(storage.diagnostics().segments).toBeGreaterThan(1);
    storage.close();

    storage = new Storage(dir);
    expect(storage.read(ids[0]!)).toEqual({ n: 1, pad });
    expect(storage.read(ids[1]!)).toEqual({ n: 2, pad });
    storage.close();
  }, 20_000);

  it("rejects a tampered checksummed WAL record", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    storage.write({ safe: true });
    storage.close();
    const wal = path.join(dir, "wal.log");
    const raw = fs.readFileSync(wal, "utf8");
    fs.writeFileSync(wal, raw.replace(/("checksum":")([a-f0-9])/, (_, prefix, digit) => prefix + (digit === "0" ? "1" : "0")));
    expect(() => new Storage(dir)).toThrow(/checksum/);
  });

  it("retains record checksums after checkpoint and detects segment corruption on read", () => {
    const dir = tempDir();
    let storage = new Storage(dir);
    const id = storage.write({ protected: true });
    storage.snapshot();
    storage.close();
    const segment = path.join(dir, "segments", "segment-0000.log");
    const bytes = fs.readFileSync(segment);
    bytes[bytes.length - 3] = bytes[bytes.length - 3]! === 49 ? 50 : 49;
    fs.writeFileSync(segment, bytes);
    storage = new Storage(dir);
    expect(() => storage.read(id)).toThrow(/checksum/);
    storage.close();
  });

  it("fails recovery loudly when a committed WAL record is corrupt", () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    storage.write({ acknowledged: true });
    storage.close();
    const segment = path.join(dir, "segments", "segment-0000.log");
    const bytes = fs.readFileSync(segment);
    bytes[0] = 91; // valid bytes are present, but the committed record is no longer JSON.
    fs.writeFileSync(segment, bytes);
    expect(() => new Storage(dir)).toThrow(/committed WAL record is corrupt/);
  });

  it("ignores an incomplete final WAL append", () => {
    const dir = tempDir();
    let storage = new Storage(dir);
    const id = storage.write({ durable: true });
    storage.close();
    fs.appendFileSync(path.join(dir, "wal.log"), '{"op":"write"');
    storage = new Storage(dir);
    expect(storage.read(id)).toEqual({ durable: true });
    storage.close();
  });

  it("rejects a second writer and reclaims a dead writer lock", () => {
    const dir = tempDir();
    const first = new Storage(dir);
    expect(() => new Storage(dir)).toThrow(/locked/);
    first.close();
    fs.mkdirSync(path.join(dir, ".lock"));
    fs.writeFileSync(path.join(dir, ".lock", "pid"), "2147483647");
    const recovered = new Storage(dir);
    expect(recovered.diagnostics().documents).toBe(0);
    recovered.close();
  });
  it.each(["checksum", "dataChecksum"])("rejects malformed %s values", (field) => {
    for (const value of ["short", "g".repeat(64), 12, null]) {
      const dir = tempDir();
      const storage = new Storage(dir);
      storage.write({ safe: true });
      storage.close();
      const wal = path.join(dir, "wal.log");
      const lines = fs.readFileSync(wal, "utf8").trim().split("\n");
      const record = JSON.parse(lines[0]!);
      record[field] = value;
      lines[0] = JSON.stringify(record);
      fs.writeFileSync(wal, lines.join("\n") + "\n");
      expect(() => new Storage(dir)).toThrow(/invalid record/);
    }
  });

  it("serializes competing stale lock reclamations", () => {
    const dir = tempDir();
    const lock = path.join(dir, ".lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "pid"), "2147483647");
    const realRemove = fs.rmSync;
    let contested = false;
    vi.spyOn(fs, "rmSync").mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
      if (String(target) === lock && !contested) {
        contested = true;
        expect(() => new Storage(dir)).toThrow(/reclamation is guarded/);
        expect(fs.readFileSync(path.join(lock, "pid"), "utf8")).toBe("2147483647");
      }
      realRemove(target, options);
    }) as typeof fs.rmSync);
    const owner = new Storage(dir);
    expect(contested).toBe(true);
    expect(() => new Storage(dir)).toThrow(/locked/);
    expect(fs.readFileSync(path.join(lock, "pid"), "utf8")).toBe(String(process.pid));
    owner.close();
  });

  it("rereads lock ownership after acquiring the reclamation guard", () => {
    const dir = tempDir();
    const lock = path.join(dir, ".lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "pid"), "2147483647");
    const realMkdir = fs.mkdirSync;
    vi.spyOn(fs, "mkdirSync").mockImplementation(((target: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
      const result = realMkdir(target, options);
      if (String(target) === path.join(dir, ".lock-reclaim")) fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
      return result;
    }) as typeof fs.mkdirSync);
    expect(() => new Storage(dir)).toThrow(/locked/);
    expect(fs.readFileSync(path.join(lock, "pid"), "utf8")).toBe(String(process.pid));
  });

  it.each(["", "invalid", "0", "-1"])("fails closed for invalid lock PID %j", (pid) => {
    const dir = tempDir();
    const lock = path.join(dir, ".lock");
    fs.mkdirSync(lock);
    if (pid) fs.writeFileSync(path.join(lock, "pid"), pid);
    expect(() => new Storage(dir)).toThrow(/locked/);
    expect(fs.existsSync(lock)).toBe(true);
  });

  it("leaves a crashed reclamation guard for explicit manual recovery", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, ".lock"));
    fs.writeFileSync(path.join(dir, ".lock", "pid"), "2147483647");
    fs.mkdirSync(path.join(dir, ".lock-reclaim"));
    expect(() => new Storage(dir)).toThrow(/remove .lock-reclaim manually/);
    expect(fs.existsSync(path.join(dir, ".lock-reclaim"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".lock", "pid"), "utf8")).toBe("2147483647");
  });

});
