import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/engine.js";
import type { Document } from "../src/types.js";
import { rankingMetrics } from "./relevance-metrics.js";

type Fixture = {
  label: string; sourceCommit: string; description: string;
  documents: Array<{ id: string; sha256: string; doc: Document & { content: string } }>;
  cases: Array<{ query: string; graded: Record<string, number> }>;
};
const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/relevance-workspace.json", import.meta.url), "utf8")) as Fixture;
const ids = new Set(fixture.documents.map(doc => doc.id));
assert.equal(fixture.label, "repository-task-judgments");
assert.equal(ids.size, fixture.documents.length);
assert(fixture.cases.length >= 20);
assert.equal(new Set(fixture.cases.map(test => test.query)).size, fixture.cases.length);
for (const item of fixture.documents) assert.equal(createHash("sha256").update(item.doc.content).digest("hex"), item.sha256);
for (const test of fixture.cases) {
  assert(test.query.trim());
  assert(Object.entries(test.graded).every(([id, grade]) => ids.has(id) && Number.isInteger(grade) && grade >= 0 && grade <= 3));
  assert(Object.values(test.graded).some(grade => grade === 3));
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-workspace-eval-"));
let engine: Engine | undefined;
try {
  engine = new Engine(dir);
  engine.restoreBackup({ version: 1, documents: fixture.documents.map(({ id, doc }) => ({ id, doc })) });
  const run = (profile: "baseline" | "tuned") => {
    const cases = fixture.cases.map(test => {
      const hits = engine!.search(test.query, { profile, mode: "any", limit: 10 }).hits.map(hit => hit.docId);
      return { query: test.query, hits, ...rankingMetrics(hits, test.graded, 10) };
    });
    return {
      MRR10: cases.reduce((sum, test) => sum + test.mrr, 0) / cases.length,
      nDCG10: cases.reduce((sum, test) => sum + test.ndcg, 0) / cases.length,
      recall10: cases.reduce((sum, test) => sum + test.recall, 0) / cases.length,
      cases,
    };
  };
  const baseline = run("baseline"), tuned = run("tuned");
  engine.close(); engine = undefined;
  engine = new Engine(dir);
  assert.deepEqual(run("baseline"), baseline, "BM25 restart ranking changed");
  assert.deepEqual(run("tuned"), tuned, "field/passage restart ranking changed");
  // Fixed floors detect regressions without requiring either profile to beat the other.
  assert(baseline.nDCG10 >= 0.78 && tuned.nDCG10 >= 0.82, "repository relevance regression");
  console.log(JSON.stringify({ label: fixture.label, sourceCommit: fixture.sourceCommit, judgments: fixture.description, corpusDocuments: ids.size, judgedQueries: fixture.cases.length, mode: "any", cutoff: 10, restartParity: true, baseline, tuned }, null, 2));
} finally {
  try { engine?.close(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
