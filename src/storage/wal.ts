import fs from "node:fs";
import { createHash } from "node:crypto";
import type { WalRecord } from "../types.js";

function recordChecksum(record: Omit<WalRecord, "checksum">): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function withChecksum(record: Omit<WalRecord, "checksum">): WalRecord {
  return { ...record, checksum: recordChecksum(record) };
}

export class WriteAheadLog {
  private fd: number;
  private broken = false;
  private sequence = 0;

  constructor(private readonly path: string) { this.fd = fs.openSync(path, "a"); }

  position(): number { return this.sequence; }
  setSequenceFloor(sequence: number): void { this.sequence = Math.max(this.sequence, sequence); }

  private append(record: Omit<WalRecord, "checksum">): void { this.appendMany([record]); }

  private appendMany(records: Omit<WalRecord, "checksum">[]): void {
    if (this.broken) throw new Error("WAL writer is broken; checkpoint or reopen the store");
    if (records.length === 0) return;
    const blob = records.map((r) => JSON.stringify(withChecksum({ ...r, sequence: ++this.sequence })) + "\n").join("");
    try {
      writeAll(this.fd, Buffer.from(blob, "utf8"));
      fs.fsyncSync(this.fd);
    } catch (error) { this.broken = true; throw error; }
  }

  logPending(record: Omit<WalRecord, "status" | "op">): void {
    const { checksum: ignored, ...base } = record;
    this.append({ ...base, op: "write", status: "pending" });
  }

  logCommitted(record: Omit<WalRecord, "status" | "op">): void {
    const { checksum: ignored, ...base } = record;
    this.append({ ...base, op: "write", status: "committed" });
  }

  logManyPending(records: Omit<WalRecord, "status" | "op">[]): void {
    this.appendMany(records.map(({ checksum: ignored, ...r }) => ({ ...r, op: "write", status: "pending" })));
  }

  logManyCommitted(records: Omit<WalRecord, "status" | "op">[]): void {
    this.appendMany(records.map(({ checksum: ignored, ...r }) => ({ ...r, op: "write", status: "committed" })));
  }

  logDelete(docId: string): void {
    this.append({ op: "delete", docId, segment: "", byteOffset: 0, length: 0, status: "committed" });
  }

  readAll(): WalRecord[] {
    if (!fs.existsSync(this.path)) return [];
    const raw = fs.readFileSync(this.path, "utf8");
    const lines = raw.split("\n");
    const records: WalRecord[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line) continue;
      let value: unknown;
      try { value = JSON.parse(line); } catch {
        if (i === lines.length - 1 && !raw.endsWith("\n")) break;
        throw new Error("WAL contains malformed record");
      }
      if (!isWalRecord(value)) throw new Error("WAL contains invalid record");
      if (value.checksum !== undefined) {
        const { checksum: ignored, ...withoutChecksum } = value;
        if (recordChecksum(withoutChecksum) !== value.checksum) throw new Error("WAL checksum mismatch");
      }
      records.push(value);
      if (value.sequence !== undefined) this.setSequenceFloor(value.sequence);
    }
    return records;
  }

  checkpoint(): void {
    if (this.fd >= 0) { fs.closeSync(this.fd); this.fd = -1; }
    try {
      const fd = fs.openSync(this.path, "w");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.fd = fs.openSync(this.path, "a");
      this.broken = false;
    } catch (error) {
      this.broken = true;
      if (this.fd >= 0) { fs.closeSync(this.fd); this.fd = -1; }
      try { this.fd = fs.openSync(this.path, "a"); } catch { /* close() remains safe after an unrecoverable checkpoint error */ }
      throw error;
    }
  }

  close(): void {
    if (this.fd >= 0) { fs.closeSync(this.fd); this.fd = -1; }
  }
}

function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(fd, buffer, offset, buffer.length - offset);
    if (written <= 0) throw new Error("storage write made no progress");
    offset += written;
  }
}

function isWalRecord(value: unknown): value is WalRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (r.op === "write" || r.op === "delete") && typeof r.docId === "string" &&
    typeof r.segment === "string" && Number.isSafeInteger(r.byteOffset) && (r.byteOffset as number) >= 0 &&
    Number.isSafeInteger(r.length) && (r.length as number) >= 0 &&
    (r.status === "pending" || r.status === "committed") &&
    (r.sequence === undefined || Number.isSafeInteger(r.sequence) && (r.sequence as number) > 0) &&
    (r.checksum === undefined || (typeof r.checksum === "string" && /^[a-f0-9]{64}$/.test(r.checksum))) &&
    (r.dataChecksum === undefined || (typeof r.dataChecksum === "string" && /^[a-f0-9]{64}$/.test(r.dataChecksum)));
}
