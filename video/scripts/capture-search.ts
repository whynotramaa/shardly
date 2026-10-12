// Indexes this repository's own TypeScript with the real Engine and records
// the tokenizer output and top hits the video shows. No numbers are invented.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/engine.js";
import { tokenizeDetailed } from "../../src/search/tokenizer.js";

const root = path.resolve(import.meta.dirname, "../..");
const query = process.argv[2] ?? "replayWalRecord";
const files = [...fs.globSync("src/**/*.ts", { cwd: root }), ...fs.globSync("tests/**/*.ts", { cwd: root })];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-video-"));
const engine = new Engine(dir);
try {
  engine.ingestDocuments(files.map((file) => ({
    title: path.basename(file), path: file, content: fs.readFileSync(path.join(root, file), "utf8"),
    source: "folder", type: "code", language: "typescript", sourceId: `video:${file}`,
  })));
  const res = engine.search(query, { limit: 3, inspect: true });
  const out = {
    query,
    documents: files.length,
    tokens: [...new Set(tokenizeDetailed(query).map((t) => t.term))],
    tookMs: res.tookMs,
    total: res.total,
    hits: res.hits.map((h) => ({
      title: String(h.doc.title), path: String(h.doc.path), score: h.score,
      breakdown: h.breakdown.map((b) => ({ term: b.term, contribution: b.contribution })),
      snippet: h.snippet ? { text: h.snippet.text, matches: h.snippet.matches } : null,
    })),
  };
  fs.writeFileSync(path.join(root, "video/search-data.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally { engine.close(); fs.rmSync(dir, { recursive: true, force: true }); }
