import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const MAGIC = Buffer.from("SHRDV001");
const MAX_BYTES = 1024 * 1024 * 1024;

/** One checksummed publication unit: header, small JSON descriptors, binary payload. */
export function encode(metadata: unknown, payload: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(16);
  MAGIC.copy(header); header.writeUInt32LE(json.length, 8); header.writeUInt32LE(payload.length, 12);
  const body = Buffer.concat([header, json, payload]);
  if (body.length > MAX_BYTES) throw new Error("vector checkpoint exceeds 1 GiB budget");
  return Buffer.concat([body, createHash("sha256").update(body).digest()]);
}
export function decode(data: Buffer): { metadata: unknown; payload: Buffer } {
  if (data.length < 48 || data.length > MAX_BYTES + 32 || !data.subarray(0, 8).equals(MAGIC)) throw new Error("invalid vector checkpoint header");
  const jsonBytes = data.readUInt32LE(8), payloadBytes = data.readUInt32LE(12);
  if (jsonBytes + payloadBytes + 48 !== data.length || !createHash("sha256").update(data.subarray(0, -32)).digest().equals(data.subarray(-32))) throw new Error("vector checkpoint checksum or length mismatch");
  return { metadata: JSON.parse(data.toString("utf8", 16, 16 + jsonBytes)), payload: data.subarray(16 + jsonBytes, -32) };
}
export function readCheckpoint(file: string): Buffer {
  if (fs.statSync(file).size > MAX_BYTES + 32) throw new Error("vector checkpoint exceeds size budget");
  return fs.readFileSync(file);
}
export function publish(file: string, data: Buffer): void {
  decode(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd = -1;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = -1;
    decode(readCheckpoint(temporary));
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd >= 0) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}
