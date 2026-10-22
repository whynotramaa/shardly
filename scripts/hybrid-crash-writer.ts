import fs from "node:fs";
import { Engine } from "../src/engine.js";
import { SemanticIndex } from "../src/search/semantic.js";
import { MockEmbeddings } from "../src/vector/providers.js";
import { VectorStore } from "../src/vector/store.js";
import { HnswIndex } from "../src/vector/hnsw.js";

const [directory, stage, replaceId, deleteId] = process.argv.slice(2);
if (!directory || !stage || !replaceId || !deleteId) throw new Error("hybrid-crash-writer requires directory, stage and document IDs");
const engine = new Engine(directory);
const kill = () => process.kill(process.pid, "SIGKILL");
const originalWrite = fs.writeSync;
if (stage === "wal-pending" || stage === "wal-committed") {
  fs.writeSync = ((fd: number, data: Buffer, ...args: unknown[]) => {
    const result = Reflect.apply(originalWrite, fs, [fd, data, ...args]);
    if (Buffer.isBuffer(data) && data.toString().includes(`"status":"${stage === "wal-pending" ? "pending" : "committed"}"`)) kill();
    return result;
  }) as typeof fs.writeSync;
}
engine.replaceDocument(replaceId, { content: "updated durable storage record" });
engine.deleteDocument(deleteId);
const id = engine.addDocument({ content: "new durable storage record" });
fs.writeSync(1, JSON.stringify({ id, replaceId, deleteId }) + "\n");
if (stage === "acknowledged") kill();
if (stage === "chunk") {
  const manifest = engine.retrievalManifest.bind(engine);
  engine.retrievalManifest = (...args) => { const result = manifest(...args); kill(); return result; };
}
const provider = new MockEmbeddings(32);
if (stage === "embedding") provider.embed = async () => { kill(); return []; };
const semantic = new SemanticIndex(engine, directory, { provider });
if (stage === "vector") {
  const insert = VectorStore.prototype.insert;
  VectorStore.prototype.insert = function (...args) { insert.apply(this, args); kill(); };
}
if (stage === "graph") {
  const add = HnswIndex.prototype.add;
  HnswIndex.prototype.add = function (...args) { add.apply(this, args); kill(); };
}
const rename = fs.renameSync;
fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
  if (stage === "checkpoint-temp" && String(to).endsWith("semantic.vectors.bin")) kill();
  rename(from, to);
  if (stage === "vector-published" && String(to).endsWith("semantic.vectors.bin")) kill();
  if (stage === "job-published" && String(to).endsWith("semantic.job.bin")) kill();
  if (stage === "graph-published" && String(to).endsWith("semantic.hnsw.bin")) kill();
}) as typeof fs.renameSync;
if (stage === "replay") {
  // Release descriptors without checkpointing so the next open must replay acknowledged records.
  Reflect.get(engine, "storage").close();
  const read = fs.readFileSync;
  fs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    const data = Reflect.apply(read, fs, [file, ...args]);
    if (String(file).endsWith("wal.log")) kill();
    return data;
  }) as typeof fs.readFileSync;
  new Engine(directory);
}
semantic.start(); await semantic.settled();
if (semantic.status().state !== "completed") throw new Error(JSON.stringify(semantic.status()));
throw new Error(`crash point was not reached: ${stage}`);
