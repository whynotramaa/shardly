import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/engine.js";
import type { Document, SearchOptions } from "../src/types.js";

type Case = {
  query: string;
  options?: SearchOptions;
  relevant: string[];
  graded: Record<string, number>;
};
type Fixture = {
  label: string;
  documents: Array<{ id: string; doc: Document }>;
  cases: Case[];
};
const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/relevance.json", import.meta.url),
    "utf8",
  ),
) as Fixture;
const keys = fixture.cases.map((test) =>
  JSON.stringify([test.query, test.options ?? {}]),
);
const documentIds = new Set(fixture.documents.map((d) => d.id));
if (
  fixture.label !== "synthetic-authored-regression" ||
  fixture.cases.length < 50 ||
  new Set(keys).size !== keys.length ||
  documentIds.size !== fixture.documents.length
)
  throw new Error(
    "fixture requires at least 50 distinct query/options cases and unique documents",
  );
for (const test of fixture.cases) {
  if (
    !test.relevant.length ||
    test.relevant.some((id) => !documentIds.has(id)) ||
    Object.entries(test.graded).some(
      ([id, grade]) =>
        !documentIds.has(id) || !Number.isFinite(grade) || grade < 0,
    ) ||
    test.relevant.some((id) => !(test.graded[id]! > 0))
  )
    throw new Error("invalid relevance judgments");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-eval-"));
let engine: Engine | undefined;
try {
  engine = new Engine(dir);
  const ingestStart = performance.now(),
    memoryBefore = process.memoryUsage().heapUsed;
  engine.restoreBackup({ version: 1, documents: fixture.documents });
  const ingestMs = performance.now() - ingestStart,
    heapDeltaBytes = process.memoryUsage().heapUsed - memoryBefore;
  function run(profile: "baseline" | "tuned") {
    const latencies: number[] = [];
    let mrr = 0,
      ndcg = 0;
    for (const test of fixture.cases) {
      const before = performance.now();
      const ids = engine!
        .search(test.query, { ...test.options, limit: 10, profile })
        .hits.map((h) => h.docId);
      latencies.push(performance.now() - before);
      const rank = ids.findIndex((id) => test.relevant.includes(id));
      mrr += rank < 0 ? 0 : 1 / (rank + 1);
      // Exponential gain, with IDCG drawn from every judged document, including unreturned ones.
      const dcg = (grades: number[]) =>
        grades
          .slice(0, 10)
          .reduce(
            (sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2),
            0,
          );
      const ideal = dcg(Object.values(test.graded).sort((a, b) => b - a));
      ndcg += ideal ? dcg(ids.map((id) => test.graded[id] ?? 0)) / ideal : 0;
    }
    latencies.sort((a, b) => a - b);
    return {
      MRR: mrr / fixture.cases.length,
      nDCG: ndcg / fixture.cases.length,
      p50Ms: latencies[Math.floor(latencies.length * 0.5)]!,
      p95Ms: latencies[Math.floor(latencies.length * 0.95)]!,
    };
  }
  const baseline = run("baseline"),
    tuned = run("tuned");
  const beforeRestart = fixture.cases.map((test) =>
    engine!
      .search(test.query, { ...test.options, limit: 10 })
      .hits.map((h) => h.docId),
  );
  const restartStart = performance.now();
  engine.close();
  engine = undefined;
  engine = new Engine(dir);
  const restartMs = performance.now() - restartStart;
  const restartHits = fixture.cases.every(
    (test, i) =>
      JSON.stringify(
        engine!
          .search(test.query, { ...test.options, limit: 10 })
          .hits.map((h) => h.docId),
      ) === JSON.stringify(beforeRestart[i]),
  );
  if (
    !restartHits ||
    tuned.nDCG < 0.75 ||
    tuned.MRR < 0.8 ||
    tuned.nDCG < baseline.nDCG + 0.02
  )
    throw new Error(
      `evaluation regression: ${JSON.stringify({ baseline, tuned, restartHits })}`,
    );
  console.log(
    JSON.stringify({
      label: fixture.label,
      fixtureCases: fixture.cases.length,
      distinctQueriesAndOptions: new Set(keys).size,
      gain: "2^grade-1",
      baseline,
      tuned,
      ingestMs,
      heapDeltaBytes,
      restartMs,
      restartHits,
    }),
  );
} finally {
  try {
    engine?.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
