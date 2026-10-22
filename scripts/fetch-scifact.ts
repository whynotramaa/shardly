import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
const directory = path.resolve(".cache/relevance");
fs.mkdirSync(directory, { recursive: true });
const archive = path.join(directory, "scifact.zip"), expected = "5f7d1de60b170fc8027bb7898e2efca1";
const checksum = (bytes: Uint8Array) => createHash("md5").update(bytes).digest("hex");
let data = fs.existsSync(archive) ? fs.readFileSync(archive) : undefined;
if (!data || checksum(data) !== expected) {
  const response = await fetch("https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip", { signal: AbortSignal.timeout(240000) });
  if (!response.ok || !response.body) throw new Error(`SciFact download failed: ${response.status}`);
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) throw new Error("SciFact archive exceeds budget"); chunks.push(Buffer.from(chunk)); }
  data = Buffer.concat(chunks); assert.equal(checksum(data), expected, "BEIR published archive identity mismatch");
  fs.writeFileSync(archive + ".tmp", data); fs.renameSync(archive + ".tmp", archive);
}
const selected = new Set(["scifact/corpus.jsonl", "scifact/queries.jsonl", "scifact/qrels/test.tsv"]);
const files = unzipSync(data, { filter: entry => selected.has(entry.name) && entry.originalSize <= 64 * 1024 * 1024 });
for (const name of selected) { assert(files[name], `missing ${name}`); const destination = path.join(directory, name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, files[name]); }
console.log(path.join(directory, "scifact"));
