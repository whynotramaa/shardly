import fs from "node:fs";
import type { WalRecord } from "../types.js";

/**
 * Write-Ahead Log.
 *
 * The durability contract, per write:
 *   1. append a "pending" record here (fsync)      — intent is now durable
 *   2. append the document to its segment (fsync)   — data is now durable
 *   3. append a "committed" record here (fsync)     — write is now finalized
 *
 * If the process dies between steps, startup replay ({@link readAll}) sees a
 * "pending" record with no matching "committed" and lets the storage layer
 * decide whether the segment write actually landed (recover) or was torn
 * (discard). This is the concrete answer to "what happens on a mid-write crash".
 *
 * The WAL is truncated ({@link checkpoint}) after the offset index is snapshotted,
 * because at that point every committed location is captured elsewhere.
 */
export class WriteAheadLog {
  private fd: number;

  constructor(private readonly path: string) {
    // 'a' = append; the fd is reused for every write to avoid reopen cost.
    this.fd = fs.openSync(path, "a");
  }

  private append(record: WalRecord): void {
    const line = JSON.stringify(record) + "\n";
    fs.writeSync(this.fd, line);
    // Force the bytes to physical storage. Without this the OS page cache
    // hides torn-write bugs until it's too late to matter.
    fs.fsyncSync(this.fd);
  }

  /** Step 1: record intent before touching the segment. */
  logPending(record: Omit<WalRecord, "status" | "op">): void {
    this.append({ ...record, op: "write", status: "pending" });
  }

  /** Step 3: mark the write finalized after the segment fsync succeeded. */
  logCommitted(record: Omit<WalRecord, "status" | "op">): void {
    this.append({ ...record, op: "write", status: "committed" });
  }

  /**
   * Group-commit variant: write many records with a single fsync at the end.
   * This amortizes the fsync cost (the dominant per-write latency) across a
   * whole batch without weakening durability — the batch is atomic, since a
   * crash before the fsync leaves none of these records durable.
   */
  logManyPending(records: Omit<WalRecord, "status" | "op">[]): void {
    this.appendMany(records.map((r) => ({ ...r, op: "write", status: "pending" })));
  }

  logManyCommitted(records: Omit<WalRecord, "status" | "op">[]): void {
    this.appendMany(records.map((r) => ({ ...r, op: "write", status: "committed" })));
  }

  private appendMany(records: WalRecord[]): void {
    if (records.length === 0) return;
    let blob = "";
    for (const r of records) blob += JSON.stringify(r) + "\n";
    fs.writeSync(this.fd, blob);
    fs.fsyncSync(this.fd);
  }

  /** Durably record a tombstone. A delete only flips an in-memory flag, so a
   * single committed record (no pending phase) is sufficient to replay it. */
  logDelete(docId: string): void {
    this.append({
      op: "delete",
      docId,
      segment: "",
      byteOffset: 0,
      length: 0,
      status: "committed",
    });
  }

  /**
   * Read every record in write order. Tolerates a torn final line (a crash
   * mid-append to the WAL itself) by ignoring anything that won't parse.
   */
  readAll(): WalRecord[] {
    if (!fs.existsSync(this.path)) return [];
    const raw = fs.readFileSync(this.path, "utf8");
    const records: WalRecord[] = [];
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      try {
        records.push(JSON.parse(line) as WalRecord);
      } catch {
        // Torn trailing record from a crash — safe to drop, its data was
        // never acknowledged to a caller.
      }
    }
    return records;
  }

  /** Truncate the log to empty. Called after an index snapshot makes every
   * committed record redundant. */
  checkpoint(): void {
    fs.closeSync(this.fd);
    fs.truncateSync(this.path, 0);
    this.fd = fs.openSync(this.path, "a");
  }

  close(): void {
    fs.closeSync(this.fd);
  }
}
