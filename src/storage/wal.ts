import fs from "node:fs";
import type { WalRecord } from "../types.js";

export class WriteAheadLog {
  private fd: number;

  constructor(private readonly path: string) {
    // 'a' = append; the fd is reused for every write to avoid reopen cost.
    this.fd = fs.openSync(path, "a");
  }

  private append(record: WalRecord): void {
    const line = JSON.stringify(record) + "\n";
    fs.writeSync(this.fd, line);
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

  readAll(): WalRecord[] {
    if (!fs.existsSync(this.path)) return [];
    const raw = fs.readFileSync(this.path, "utf8");
    const records: WalRecord[] = [];
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      try {
        records.push(JSON.parse(line) as WalRecord);
      } catch {
      }
    }
    return records;
  }

  checkpoint(): void {
    fs.closeSync(this.fd);
    fs.truncateSync(this.path, 0);
    this.fd = fs.openSync(this.path, "a");
  }

  close(): void {
    fs.closeSync(this.fd);
  }
}
