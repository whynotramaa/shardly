import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataPaths, SEGMENT_MAX_BYTES, type DataPaths } from "../config.js";
import type {
  Document,
  OffsetEntry,
  OffsetIndex,
  StoredDocument,
  WalRecord,
} from "../types.js";
import { WriteAheadLog } from "./wal.js";

const SEGMENT_PREFIX = "segment-";
const SEGMENT_SUFFIX = ".log";

function segmentName(index: number): string {
  return `${SEGMENT_PREFIX}${String(index).padStart(4, "0")}${SEGMENT_SUFFIX}`;
}

export class Storage {
  private readonly offsetIndex: OffsetIndex = new Map();
  private readonly wal: WriteAheadLog;
  private readonly paths: DataPaths;

  /** fd of the segment currently being appended to. */
  private writeFd = -1;
  private currentSegmentIndex = 0;
  private currentSegmentSize = 0;

  /** Read-only fd cache keyed by segment name, so hot reads never reopen. */
  private readonly readFds = new Map<string, number>();

  /** Bumped on every mutation. Lets the index tell "same count" from "same state". */
  private version = 0;

  constructor(dataDir?: string) {
    this.paths = dataPaths(dataDir);
    ensureDirs(this.paths);
    this.wal = new WriteAheadLog(this.paths.walPath);
    this.loadOffsetSnapshot();
    this.openCurrentSegment();
    this.replayWal();
  }

  private segmentPath(name: string): string {
    return path.join(this.paths.segmentsDir, name);
  }

  write(doc: Document): string {
    const docId = randomUUID();
    this.append(docId, doc);
    return docId;
  }

  writeBatch(docs: Document[]): string[] {
    if (docs.length === 0) return [];

    const ids: string[] = [];
    const pending: Array<Omit<WalRecord, "status" | "op">> = [];
    let chunk = ""; // accumulated NDJSON for the current segment

    const flushChunk = (): void => {
      if (chunk.length === 0) return;
      fs.writeSync(this.writeFd, chunk);
      fs.fsyncSync(this.writeFd);
      this.currentSegmentSize += Buffer.byteLength(chunk, "utf8");
      chunk = "";
    };

    for (const doc of docs) {
      const docId = randomUUID();
      const stored: StoredDocument = { id: docId, doc };
      const record = JSON.stringify(stored);
      const lineBytes = Buffer.byteLength(record, "utf8") + 1;      const length = lineBytes - 1;

      if (
        this.currentSegmentSize + Buffer.byteLength(chunk, "utf8") > 0 &&
        this.currentSegmentSize +
          Buffer.byteLength(chunk, "utf8") +
          lineBytes >
          SEGMENT_MAX_BYTES
      ) {
        flushChunk();
        this.rotateSegment();
      }

      const segment = segmentName(this.currentSegmentIndex);
      const byteOffset =
        this.currentSegmentSize + Buffer.byteLength(chunk, "utf8");

      pending.push({ docId, segment, byteOffset, length });
      chunk += record + "\n";
      ids.push(docId);
    }

    // 1. All intents durable in one WAL fsync.
    this.wal.logManyPending(pending);
    // 2. All data durable (one fsync per segment flush).
    flushChunk();
    // 3. Reflect in memory.
    for (const p of pending) {
      this.offsetIndex.set(p.docId, {
        segment: p.segment,
        byteOffset: p.byteOffset,
        length: p.length,
        deleted: false,
      });
    }
    // 4. Finalize the whole batch in one WAL fsync.
    this.wal.logManyCommitted(pending);
    this.version += pending.length;

    return ids;
  }

  /** Read a document by id via direct byte seek. null if missing or deleted. */
  read(docId: string): Document | null {
    const entry = this.offsetIndex.get(docId);
    if (!entry || entry.deleted) return null;
    return this.readAt(entry).doc;
  }

  /** Tombstone a document. Returns false if it did not exist / was deleted. */
  delete(docId: string): boolean {
    const entry = this.offsetIndex.get(docId);
    if (!entry || entry.deleted) return false;
    this.wal.logDelete(docId);
    entry.deleted = true;
    this.version++;
    return true;
  }

  liveDocIds(): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.offsetIndex) {
      if (!entry.deleted) ids.push(id);
    }
    return ids;
  }

  /** Monotonic mutation counter, for cache/index staleness checks. */
  stateVersion(): number {
    return this.version;
  }

  size(): number {
    let n = 0;
    for (const entry of this.offsetIndex.values()) if (!entry.deleted) n++;
    return n;
  }

  snapshot(): void {
    const obj: Record<string, OffsetEntry> = {};
    for (const [id, entry] of this.offsetIndex) obj[id] = entry;
    writeJsonAtomic(this.paths.offsetSnapshot, {
      segmentIndex: this.currentSegmentIndex,
      segmentSize: this.currentSegmentSize,
      version: this.version,
      entries: obj,
    });
    this.wal.checkpoint();
  }

  close(): void {
    if (this.writeFd >= 0) fs.closeSync(this.writeFd);
    for (const fd of this.readFds.values()) fs.closeSync(fd);
    this.readFds.clear();
    this.wal.close();
  }

  reset(): void {
    if (this.writeFd >= 0) fs.closeSync(this.writeFd);
    for (const fd of this.readFds.values()) fs.closeSync(fd);
    this.readFds.clear();

    for (const name of fs.readdirSync(this.paths.segmentsDir)) {
      if (name.startsWith(SEGMENT_PREFIX)) {
        fs.rmSync(this.segmentPath(name), { force: true });
      }
    }
    fs.rmSync(this.paths.offsetSnapshot, { force: true });

    this.offsetIndex.clear();
    this.version++;
    this.currentSegmentIndex = 0;
    this.currentSegmentSize = 0;
    this.wal.checkpoint();
    this.openCurrentSegment();
  }

  /**
   * Rewrite live records into fresh segments, dropping tombstones. New segments
   * are numbered past the current one so the old files stay readable until
   * `snapshot()` commits the new offsets.
   * ponytail: a crash mid-compaction orphans the half-written segment; the next
   * compaction reclaims it, because an over-eager startup sweep deletes real data.
   */
  compact(): { reclaimedBytes: number; removedDocuments: number } {
    const tombstoned = this.liveDocIds().length !== this.offsetIndex.size;
    if (!tombstoned) return { reclaimedBytes: 0, removedDocuments: 0 };

    const bytesBefore = this.segmentBytes();
    const removedDocuments = this.offsetIndex.size - this.liveDocIds().length;
    const oldSegments = new Set(
      [...this.offsetIndex.values()].map((e) => e.segment),
    );

    fs.fsyncSync(this.writeFd);
    fs.closeSync(this.writeFd);
    this.writeFd = -1;

    let index = this.currentSegmentIndex + 1;
    let fd = fs.openSync(this.segmentPath(segmentName(index)), "w");
    let size = 0;
    const next: OffsetIndex = new Map();

    for (const [docId, entry] of this.offsetIndex) {
      if (entry.deleted) continue;
      const buf = Buffer.from(JSON.stringify(this.readAt(entry)) + "\n", "utf8");

      if (size > 0 && size + buf.length > SEGMENT_MAX_BYTES) {
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        index += 1;
        fd = fs.openSync(this.segmentPath(segmentName(index)), "w");
        size = 0;
      }

      fs.writeSync(fd, buf);
      next.set(docId, {
        segment: segmentName(index),
        byteOffset: size,
        length: buf.length - 1,
        deleted: false,
      });
      size += buf.length;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    this.offsetIndex.clear();
    for (const [docId, entry] of next) this.offsetIndex.set(docId, entry);
    this.currentSegmentIndex = index;
    this.currentSegmentSize = size;
    this.version += 1;
    this.snapshot(); // commit point: new offsets durable, WAL truncated

    for (const openFd of this.readFds.values()) fs.closeSync(openFd);
    this.readFds.clear();
    const kept = new Set([...next.values()].map((e) => e.segment));
    for (const name of oldSegments) {
      if (!kept.has(name)) fs.rmSync(this.segmentPath(name), { force: true });
    }
    this.openCurrentSegment();

    return { reclaimedBytes: bytesBefore - this.segmentBytes(), removedDocuments };
  }

  private segmentBytes(): number {
    let total = 0;
    for (const name of fs.readdirSync(this.paths.segmentsDir)) {
      if (name.startsWith(SEGMENT_PREFIX)) {
        total += fs.statSync(this.segmentPath(name)).size;
      }
    }
    return total;
  }

  private append(docId: string, doc: Document): void {
    const stored: StoredDocument = { id: docId, doc };
    const record = JSON.stringify(stored);
    const buf = Buffer.from(record + "\n", "utf8");
    const length = Buffer.byteLength(record, "utf8"); // excludes newline

    // Rotate before writing if this record would overflow the segment.
    if (
      this.currentSegmentSize > 0 &&
      this.currentSegmentSize + buf.length > SEGMENT_MAX_BYTES
    ) {
      this.rotateSegment();
    }

    const segment = segmentName(this.currentSegmentIndex);
    const byteOffset = this.currentSegmentSize;

    // 1. Intent is durable before any data is written.
    this.wal.logPending({ docId, segment, byteOffset, length });

    // 2. Data is durable.
    fs.writeSync(this.writeFd, buf);
    fs.fsyncSync(this.writeFd);
    this.currentSegmentSize += buf.length;

    // 3. Reflect in memory and finalize.
    this.offsetIndex.set(docId, {
      segment,
      byteOffset,
      length,
      deleted: false,
    });
    this.wal.logCommitted({ docId, segment, byteOffset, length });
    this.version++;
  }

  private rotateSegment(): void {
    fs.fsyncSync(this.writeFd);
    fs.closeSync(this.writeFd);
    this.currentSegmentIndex += 1;
    this.currentSegmentSize = 0;
    this.openCurrentSegment();
  }

  private openCurrentSegment(): void {
    const name = segmentName(this.currentSegmentIndex);
    const p = this.segmentPath(name);
    this.writeFd = fs.openSync(p, "a");
    // Trust the actual file size on disk over any in-memory guess.
    this.currentSegmentSize = fs.existsSync(p) ? fs.statSync(p).size : 0;
  }

  private readAt(entry: OffsetEntry): StoredDocument {
    const fd = this.getReadFd(entry.segment);
    const buf = Buffer.allocUnsafe(entry.length);
    fs.readSync(fd, buf, 0, entry.length, entry.byteOffset);
    return JSON.parse(buf.toString("utf8")) as StoredDocument;
  }

  private getReadFd(segment: string): number {
    let fd = this.readFds.get(segment);
    if (fd === undefined) {
      fd = fs.openSync(this.segmentPath(segment), "r");
      this.readFds.set(segment, fd);
    }
    return fd;
  }

  private loadOffsetSnapshot(): void {
    if (!fs.existsSync(this.paths.offsetSnapshot)) return;
    const raw = fs.readFileSync(this.paths.offsetSnapshot, "utf8");
    if (raw.trim().length === 0) return;
    const parsed = JSON.parse(raw) as {
      segmentIndex: number;
      segmentSize: number;
      version?: number;
      entries: Record<string, OffsetEntry>;
    };
    for (const [id, entry] of Object.entries(parsed.entries)) {
      this.offsetIndex.set(id, entry);
    }
    this.currentSegmentIndex = parsed.segmentIndex;
    this.currentSegmentSize = parsed.segmentSize;
    this.version = parsed.version ?? 0;
  }

  replayWal(): void {
    const records = this.wal.readAll();
    const committed = new Set<string>();

    // First pass: apply everything explicitly finalized.
    for (const r of records) {
      if (r.status !== "committed") continue;
      if (r.op === "delete") {
        const entry = this.offsetIndex.get(r.docId);
        if (entry) {
          entry.deleted = true;
          this.version++;
        }
      } else {
        committed.add(walKey(r));
        this.applyWrite(r);
      }
    }

    // Second pass: pending writes with no matching commit — the crash window.
    for (const r of records) {
      if (r.op !== "write" || r.status !== "pending") continue;
      if (committed.has(walKey(r))) continue;
      if (this.verifySegmentRecord(r)) this.applyWrite(r);
    }

    // Snapshot the recovered state and truncate the now-redundant WAL.
    this.snapshot();
  }

  private applyWrite(r: WalRecord): void {
    this.version++;
    this.offsetIndex.set(r.docId, {
      segment: r.segment,
      byteOffset: r.byteOffset,
      length: r.length,
      deleted: false,
    });
    // Keep the live segment cursor ahead of any recovered write.
    const idx = segmentIndexOf(r.segment);
    if (idx > this.currentSegmentIndex) {
      this.currentSegmentIndex = idx;
    }
    if (idx === this.currentSegmentIndex) {
      const end = r.byteOffset + r.length + 1; // + newline
      if (end > this.currentSegmentSize) this.currentSegmentSize = end;
    }
  }

  private verifySegmentRecord(r: WalRecord): boolean {
    const p = this.segmentPath(r.segment);
    if (!fs.existsSync(p)) return false;
    if (fs.statSync(p).size < r.byteOffset + r.length) return false;
    try {
      const fd = this.getReadFd(r.segment);
      const buf = Buffer.allocUnsafe(r.length);
      fs.readSync(fd, buf, 0, r.length, r.byteOffset);
      const parsed = JSON.parse(buf.toString("utf8")) as StoredDocument;
      return parsed.id === r.docId;
    } catch {
      return false;
    }
  }
}

function ensureDirs(paths: DataPaths): void {
  for (const dir of [paths.dataDir, paths.segmentsDir, paths.indexDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function walKey(r: WalRecord): string {
  return `${r.segment}:${r.byteOffset}`;
}

function segmentIndexOf(segment: string): number {
  const n = segment.slice(SEGMENT_PREFIX.length, -SEGMENT_SUFFIX.length);
  return Number.parseInt(n, 10);
}

function writeJsonAtomic(target: string, value: unknown): void {
  const tmp = `${target}.tmp`;
  const fd = fs.openSync(tmp, "w");
  fs.writeSync(fd, JSON.stringify(value));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, target);
  // The rename itself must be durable before the WAL that would replace it is truncated.
  const dir = fs.openSync(path.dirname(target), "r");
  fs.fsyncSync(dir);
  fs.closeSync(dir);
}
