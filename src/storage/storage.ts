import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { dataPaths, SEGMENT_MAX_BYTES, type DataPaths } from "../config.js";
import type { Document, OffsetEntry, OffsetIndex, StoredDocument, WalRecord } from "../types.js";
import { WriteAheadLog } from "./wal.js";

const SEGMENT_PREFIX = "segment-";
const SEGMENT_SUFFIX = ".log";
const LOCK_NAME = ".lock";

export interface StorageDiagnostics {
  documents: number;
  tombstones: number;
  segments: number;
  segmentBytes: number;
  walBytes: number;
  version: number;
}

function segmentName(index: number): string { return `${SEGMENT_PREFIX}${String(index).padStart(4, "0")}${SEGMENT_SUFFIX}`; }

export class Storage {
  private readonly offsetIndex: OffsetIndex = new Map();
  private readonly wal: WriteAheadLog;
  private readonly paths: DataPaths;
  private writeFd = -1;
  private currentSegmentIndex = 0;
  private currentSegmentSize = 0;
  private readonly readFds = new Map<string, number>();
  private version = 0;
  private closed = false;
  private writeBroken = false;
  private compacting = false;
  private readonly plannedDocs = new Map<string, Document>();

  constructor(dataDir?: string) {
    this.paths = dataPaths(dataDir);
    ensureDirs(this.paths);
    acquireLock(this.paths.dataDir);
    let openedWal: WriteAheadLog | undefined;
    try {
      openedWal = new WriteAheadLog(this.paths.walPath);
      this.wal = openedWal;
      this.loadOffsetSnapshot();
      this.replayWal();
      this.closeReadFds();
      this.cleanupOrphans();
      this.openCurrentSegment();
    } catch (error) {
      openedWal?.close();
      for (const fd of this.readFds.values()) fs.closeSync(fd);
      this.readFds.clear();
      releaseLock(this.paths.dataDir);
      throw error;
    }
  }

  private segmentPath(name: string): string { return path.join(this.paths.segmentsDir, name); }

  write(doc: Document): string { return this.writeWithId(randomUUID(), doc); }

  writeWithId(docId: string, doc: Document): string {
    this.assertWritable();
    validateId(docId);
    const plan = this.planRecords([{ id: docId, doc }])[0]!;
    this.plannedDocs.set(docId, doc);
    try {
      this.wal.logPending(plan);
      this.writePlanned([plan]);
      this.wal.logCommitted(plan);
      this.applyWrite(plan);
      this.version++;
    } finally { this.plannedDocs.delete(docId); }
    return docId;
  }

  writeBatch(docs: Document[]): string[] {
    this.assertWritable();
    if (docs.length === 0) return [];
    const inputs = docs.map((doc) => ({ id: randomUUID(), doc }));
    const plans = this.planRecords(inputs);
    for (const input of inputs) this.plannedDocs.set(input.id, input.doc);
    try {
      this.wal.logManyPending(plans);
      this.writePlanned(plans);
      this.wal.logManyCommitted(plans);
      for (const plan of plans) this.applyWrite(plan);
      this.version += plans.length;
      return plans.map((p) => p.docId);
    } finally { for (const input of inputs) this.plannedDocs.delete(input.id); }
  }

  read(docId: string): Document | null {
    const entry = this.offsetIndex.get(docId);
    if (!entry || entry.deleted) return null;
    return this.readAt(entry, docId).doc;
  }

  delete(docId: string): boolean {
    this.assertWritable();
    const entry = this.offsetIndex.get(docId);
    if (!entry || entry.deleted) return false;
    this.wal.logDelete(docId);
    entry.deleted = true;
    this.version++;
    return true;
  }

  liveDocIds(): string[] {
    return [...this.offsetIndex].filter(([, entry]) => !entry.deleted).map(([id]) => id);
  }

  stateVersion(): number { return this.version; }

  size(): number { return this.liveDocIds().length; }

  diagnostics(): StorageDiagnostics {
    let tombstones = 0;
    for (const entry of this.offsetIndex.values()) if (entry.deleted) tombstones++;
    let segmentBytes = 0;
    let segments = 0;
    for (const name of this.segmentNames()) { segments++; segmentBytes += fs.statSync(this.segmentPath(name)).size; }
    return { documents: this.size(), tombstones, segments, segmentBytes, walBytes: fs.statSync(this.paths.walPath).size, version: this.version };
  }

  snapshot(): void {
    const entries: Record<string, OffsetEntry> = {};
    for (const [id, entry] of this.offsetIndex) entries[id] = entry;
    fsyncDir(this.paths.segmentsDir);
    writeJsonAtomic(this.paths.offsetSnapshot, {
      segmentIndex: this.currentSegmentIndex,
      segmentSize: this.currentSegmentSize,
      version: this.version,
      entries,
    });
    this.wal.checkpoint();
    fsyncDir(this.paths.dataDir);
  }

  close(): void {
    if (this.closed) return;
    if (this.compacting) throw Object.assign(new Error("compaction is running; retry after it completes"), { statusCode: 503 });
    this.closed = true;
    if (this.writeFd >= 0) fs.closeSync(this.writeFd);
    for (const fd of this.readFds.values()) fs.closeSync(fd);
    this.readFds.clear();
    this.wal.close();
    releaseLock(this.paths.dataDir);
  }

  reset(): void {
    this.assertWritable();
    // Clear the old WAL against the old snapshot before committing an empty store.
    this.snapshot();
    const index = Math.max(this.currentSegmentIndex, ...this.segmentNames().map(segmentIndexOf)) + 1;
    const fd = fs.openSync(this.segmentPath(segmentName(index)), "wx");
    const version = this.version + 1;
    let committed = false;
    try {
      fs.fsyncSync(fd);
      fsyncDir(this.paths.segmentsDir);
      writeSnapshotAtomic(this.paths.offsetSnapshot, index, 0, version, new Map(), () => { committed = true; });
    } finally {
      if (committed) {
        const oldFd = this.writeFd;
        this.writeFd = fd;
        this.offsetIndex.clear();
        this.currentSegmentIndex = index;
        this.currentSegmentSize = 0;
        this.version = version;
        if (oldFd >= 0) fs.closeSync(oldFd);
        this.closeReadFds();
      } else { fs.closeSync(fd); }
    }
    this.cleanupOrphans();
    fsyncDir(this.paths.segmentsDir);
  }

  compact(): { reclaimedBytes: number; removedDocuments: number } {
    const steps = this.compactSteps();
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  async compactAsync(): Promise<{ reclaimedBytes: number; removedDocuments: number }> {
    let processed = 0;
    const steps = this.compactSteps();
    let step = steps.next();
    while (!step.done) {
      if (++processed % 16 === 0) await yieldTurn();
      step = steps.next();
    }
    return step.value;
  }

  private *compactSteps(): Generator<void, { reclaimedBytes: number; removedDocuments: number }> {
    this.assertWritable();
    const removedDocuments = [...this.offsetIndex.values()].filter((e) => e.deleted).length;
    if (removedDocuments === 0) return { reclaimedBytes: 0, removedDocuments: 0 };
    const bytesBefore = this.segmentBytes();
    const oldIndex = this.currentSegmentIndex;
    const oldSize = this.currentSegmentSize;
    const oldVersion = this.version;
    const oldEntries = new Map(this.offsetIndex);
    if (this.writeFd >= 0) { fs.fsyncSync(this.writeFd); fs.closeSync(this.writeFd); this.writeFd = -1; }
    this.cleanupOrphans();
    let committed = false;
    let index = oldIndex + 1;
    let fd = -1;
    let size = 0;
    const next: OffsetIndex = new Map();
    this.compacting = true;
    try {
      // This checkpoint is the rollback point if the new snapshot never renames.
      this.snapshot();
      fd = fs.openSync(this.segmentPath(segmentName(index)), "wx");
      for (const [docId, entry] of this.offsetIndex) {
        if (entry.deleted) continue;
        const buf = Buffer.from(JSON.stringify(this.readAt(entry, docId)) + "\n", "utf8");
        if (size > 0 && size + buf.length > SEGMENT_MAX_BYTES) {
          fs.fsyncSync(fd); fs.closeSync(fd); index++; size = 0;
          fd = fs.openSync(this.segmentPath(segmentName(index)), "wx");
        }
        writeAll(fd, buf);
        next.set(docId, { segment: segmentName(index), byteOffset: size, length: buf.length - 1, deleted: false, checksum: hash(buf.subarray(0, -1)) });
        size += buf.length;
        yield;
      }
      fs.fsyncSync(fd); fs.closeSync(fd); fd = -1;
      fsyncDir(this.paths.segmentsDir);
      this.offsetIndex.clear();
      for (const [id, entry] of next) this.offsetIndex.set(id, entry);
      this.currentSegmentIndex = index;
      this.currentSegmentSize = size;
      this.version = oldVersion + 1;
      writeSnapshotAtomic(this.paths.offsetSnapshot, this.currentSegmentIndex, this.currentSegmentSize, this.version, this.offsetIndex, () => { committed = true; });
      this.closeReadFds();
      try { this.cleanupOrphans(); } catch { /* Orphans are safe to reclaim on a later open. */ }
      this.openCurrentSegment();
      return { reclaimedBytes: bytesBefore - this.segmentBytes(), removedDocuments };
    } catch (error) {
      if (fd >= 0) fs.closeSync(fd);
      if (!committed) {
        this.offsetIndex.clear();
        for (const [id, entry] of oldEntries) this.offsetIndex.set(id, entry);
        this.currentSegmentIndex = oldIndex;
        this.currentSegmentSize = oldSize;
        this.version = oldVersion;
        this.closeReadFds();
        fs.truncateSync(this.segmentPath(segmentName(oldIndex)), oldSize);
        this.cleanupOrphans();
        this.openCurrentSegment(false);
      } else if (this.writeFd < 0) {
        this.closeReadFds();
        this.openCurrentSegment(false);
      }
      throw error;
    } finally { this.compacting = false; }
  }

  private planRecords(inputs: Array<{ id: string; doc: Document }>): Array<Omit<WalRecord, "status" | "op">> {
    let index = this.currentSegmentIndex;
    let size = this.currentSegmentSize;
    return inputs.map(({ id, doc }) => {
      const bytes = Buffer.from(JSON.stringify({ id, doc }) + "\n", "utf8");
      if (size > 0 && size + bytes.length > SEGMENT_MAX_BYTES) { index++; size = 0; }
      const plan = { docId: id, segment: segmentName(index), byteOffset: size, length: bytes.length - 1, dataChecksum: hash(bytes.subarray(0, -1)) };
      size += bytes.length;
      return plan;
    });
  }

  private writePlanned(plans: Array<Omit<WalRecord, "status" | "op">>): void {
    const initialIndex = this.currentSegmentIndex;
    const initialSize = this.currentSegmentSize;
    let segment = "";
    let fd = -1;
    try {
      for (const plan of plans) {
        if (plan.segment !== segment) {
          while (this.currentSegmentIndex < segmentIndexOf(plan.segment)) this.rotateSegment();
          fd = this.writeFd; segment = plan.segment;
        }
        const stored = Buffer.from(JSON.stringify({ id: plan.docId, doc: this.readPlannedDoc(plan) }) + "\n", "utf8");
        writeAll(fd, stored);
        this.currentSegmentSize += stored.length;
      }
      if (fd >= 0) fs.fsyncSync(fd);
    } catch (error) {
      if (fd >= 0 && fd !== this.writeFd) {
        try { fs.closeSync(fd); } catch { /* rotateSegment may already have closed it */ }
      }
      try { this.rollbackWrite(initialIndex, initialSize); } catch { this.writeBroken = true; }
      throw error;
    }
  }

  private rollbackWrite(index: number, size: number): void {
    if (this.writeFd >= 0) { fs.closeSync(this.writeFd); this.writeFd = -1; }
    for (const name of this.segmentNames()) if (segmentIndexOf(name) > index) fs.rmSync(this.segmentPath(name), { force: true });
    fs.truncateSync(this.segmentPath(segmentName(index)), size);
    this.currentSegmentIndex = index;
    this.currentSegmentSize = size;
    this.openCurrentSegment(false);
  }

  private assertWritable(): void {
    if (this.compacting) throw Object.assign(new Error("compaction is running; retry after it completes"), { statusCode: 503 });
    if (this.closed) throw new Error("storage is closed");
    if (this.writeBroken) throw new Error("storage writer is broken; reopen the store");
  }

  // Plans carry offsets/checksums; the document bytes are kept by the pending write path below.
  private readPlannedDoc(plan: Omit<WalRecord, "status" | "op">): Document {
    const doc = this.plannedDocs.get(plan.docId);
    if (!doc) throw new Error("storage write plan missing document");
    return doc;
  }

  private rotateSegment(): void {
    this.closeReadFds();
    fs.fsyncSync(this.writeFd); fs.closeSync(this.writeFd);
    this.currentSegmentIndex++; this.currentSegmentSize = 0; this.openCurrentSegment();
  }

  private openCurrentSegment(selectHighest = true): void {
    if (selectHighest) {
      const indexes = this.segmentNames().map(segmentIndexOf);
      if (indexes.length > 0) this.currentSegmentIndex = Math.max(this.currentSegmentIndex, ...indexes);
    }
    const p = this.segmentPath(segmentName(this.currentSegmentIndex));
    this.writeFd = fs.openSync(p, "a");
    this.currentSegmentSize = fs.statSync(p).size;
  }

  private applyWrite(r: Omit<WalRecord, "status" | "op">): void {
    this.offsetIndex.set(r.docId, { segment: r.segment, byteOffset: r.byteOffset, length: r.length, deleted: false, checksum: r.dataChecksum });
  }

  private readAt(entry: OffsetEntry, expectedId?: string): StoredDocument {
    const fd = this.getReadFd(entry.segment);
    const buf = readExact(fd, entry.byteOffset, entry.length);
    if (buf.length === 0) throw new Error("storage record is empty");
    if (entry.checksum && hash(buf) !== entry.checksum) throw new Error("storage record checksum mismatch");
    const parsed = JSON.parse(buf.toString("utf8")) as StoredDocument;
    if (parsed.id === undefined || typeof parsed.id !== "string" || typeof parsed.doc !== "object" || parsed.doc === null) throw new Error("storage record is invalid");
    if (expectedId !== undefined && parsed.id !== expectedId) throw new Error("storage record id mismatch");
    return parsed;
  }

  private getReadFd(segment: string): number {
    let fd = this.readFds.get(segment);
    if (fd === undefined) { fd = fs.openSync(this.segmentPath(segment), "r"); this.readFds.set(segment, fd); }
    return fd;
  }

  private loadOffsetSnapshot(): void {
    if (!fs.existsSync(this.paths.offsetSnapshot)) return;
    const raw = fs.readFileSync(this.paths.offsetSnapshot, "utf8");
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as { segmentIndex: number; segmentSize: number; version?: number; entries: Record<string, OffsetEntry> };
      if (!Number.isSafeInteger(parsed.segmentIndex) || !Number.isSafeInteger(parsed.segmentSize) || typeof parsed.entries !== "object" || parsed.entries === null) throw new Error();
      for (const [id, entry] of Object.entries(parsed.entries)) {
        validateEntry(id, entry);
        this.offsetIndex.set(id, entry);
      }
      this.currentSegmentIndex = parsed.segmentIndex; this.currentSegmentSize = parsed.segmentSize; this.version = parsed.version ?? 0;
    } catch { throw new Error("offset snapshot is invalid"); }
  }

  private replayWal(): void {
    const records = this.wal.readAll();
    const committed = new Set(records.filter((r) => r.op === "write" && r.status === "committed").map(walKey));
    for (const record of records) {
      if (record.op === "delete" && record.status === "committed") {
        const entry = this.offsetIndex.get(record.docId); if (entry) { entry.deleted = true; this.version++; }
      } else if (record.op === "write") {
        const valid = this.verifySegmentRecord(record);
        if (record.status === "committed") {
          if (!valid) throw new Error("committed WAL record is corrupt");
          this.applyWrite(record); this.version++;
        } else if (!committed.has(walKey(record)) && valid) {
          this.applyWrite(record); this.version++;
        }
      }
    }
    this.snapshot();
  }

  private verifySegmentRecord(r: WalRecord): boolean {
    if (!/^segment-\d+\.log$/.test(r.segment)) return false;
    const p = this.segmentPath(r.segment);
    if (!fs.existsSync(p) || fs.statSync(p).size < r.byteOffset + r.length + 1) return false;
    try {
      const buf = readExact(this.getReadFd(r.segment), r.byteOffset, r.length);
      if (r.dataChecksum && hash(buf) !== r.dataChecksum) return false;
      const parsed = JSON.parse(buf.toString("utf8")) as StoredDocument;
      return parsed.id === r.docId && readExact(this.getReadFd(r.segment), r.byteOffset + r.length, 1)[0] === 10;
    } catch { return false; }
  }

  private segmentNames(): string[] { return fs.readdirSync(this.paths.segmentsDir).filter((n) => /^segment-\d+\.log$/.test(n)); }
  private segmentBytes(): number { return this.segmentNames().reduce((n, name) => n + fs.statSync(this.segmentPath(name)).size, 0); }

  private cleanupOrphans(): void {
    const keep = new Set([...this.offsetIndex.values()].map((e) => e.segment));
    keep.add(segmentName(this.currentSegmentIndex));
    for (const name of this.segmentNames()) if (!keep.has(name)) fs.rmSync(this.segmentPath(name), { force: true });
  }

  private closeReadFds(): void {
    for (const fd of this.readFds.values()) fs.closeSync(fd);
    this.readFds.clear();
  }
}

function ensureDirs(paths: DataPaths): void { for (const dir of [paths.dataDir, paths.segmentsDir, paths.indexDir]) fs.mkdirSync(dir, { recursive: true }); }

function acquireLock(dataDir: string): void {
  const lock = path.join(dataDir, LOCK_NAME);
  const claim = (): void => { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, "pid"), String(process.pid)); fsyncDir(dataDir); };
  try { claim(); return; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("unable to acquire storage lock");
  }
  const guard = path.join(dataDir, ".lock-reclaim");
  try { fs.mkdirSync(guard); } catch {
    throw new Error("storage lock reclamation is guarded; if no writer is active, remove .lock-reclaim manually");
  }
  try {
    // Read the current owner only while reclamation is serialized.
    let pidText: string;
    try { pidText = fs.readFileSync(path.join(lock, "pid"), "utf8").trim(); } catch { throw new Error("storage data directory is already locked"); }
    const pid = Number(pidText);
    if (!/^\d+$/.test(pidText) || !Number.isSafeInteger(pid) || pid <= 0) throw new Error("storage data directory is already locked");
    try { process.kill(pid, 0); } catch (stale) {
      if ((stale as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("storage data directory is already locked");
      fs.rmSync(lock, { recursive: true });
      try { claim(); return; } catch { throw new Error("storage data directory is already locked"); }
    }
    throw new Error("storage data directory is already locked");
  } finally { fs.rmSync(guard, { recursive: true }); }
}

function releaseLock(dataDir: string): void { fs.rmSync(path.join(dataDir, LOCK_NAME), { recursive: true, force: true }); }
function validateId(id: string): void { if (!id || id.includes("\n") || id.length > 1024) throw new Error("invalid document id"); }
function validateEntry(id: string, e: OffsetEntry): void { validateId(id); if (!/^segment-\d+\.log$/.test(e.segment) || !Number.isSafeInteger(e.byteOffset) || e.byteOffset < 0 || !Number.isSafeInteger(e.length) || e.length < 0 || typeof e.deleted !== "boolean" || (e.checksum !== undefined && !/^[a-f0-9]{64}$/.test(e.checksum))) throw new Error("invalid offset entry"); }
function segmentIndexOf(segment: string): number { return Number.parseInt(/^segment-(\d+)\.log$/.exec(segment)?.[1] ?? "-1", 10); }
function hash(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function readExact(fd: number, offset: number, length: number): Buffer { const out = Buffer.alloc(length); let at = 0; while (at < length) { const n = fs.readSync(fd, out, at, length - at, offset + at); if (n === 0) throw new Error("short storage read"); at += n; } return out; }
function writeAll(fd: number, buffer: Buffer): void { let at = 0; while (at < buffer.length) { const n = fs.writeSync(fd, buffer, at, buffer.length - at); if (n <= 0) throw new Error("storage write made no progress"); at += n; } }
function walKey(r: WalRecord): string { return `${r.docId}:${r.segment}:${r.byteOffset}`; }
function writeSnapshotAtomic(target: string, segmentIndex: number, segmentSize: number, version: number, entries: OffsetIndex, onRename: () => void): void {
  const serialized: Record<string, OffsetEntry> = {};
  for (const [id, entry] of entries) serialized[id] = entry;
  const tmp = target + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try { writeAll(fd, Buffer.from(JSON.stringify({ segmentIndex, segmentSize, version, entries: serialized }), "utf8")); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, target); }
  catch (error) {
    // A wrapper or filesystem can report failure after rename completed.
    if (!fs.existsSync(tmp) && fs.existsSync(target)) onRename();
    throw error;
  }
  onRename();
  fsyncDir(path.dirname(target));
}
function fsyncDir(dir: string): void { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeJsonAtomic(target: string, value: unknown): void { const tmp = `${target}.tmp`; const fd = fs.openSync(tmp, "w"); try { writeAll(fd, Buffer.from(JSON.stringify(value), "utf8")); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, target); fsyncDir(path.dirname(target)); }
