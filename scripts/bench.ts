
import { Engine } from "../src/engine.js";

const dataDir = process.argv[2];
const QUERIES = [
  "storage index",
  "crash recovery latency",
  "vector",
  "distributed replication shard",
  "checksum integrity corruption",
];
const RUNS = 5;

function main() {
  const engine = new Engine(dataDir);
  console.log(`Corpus: ${engine.documentCount()} documents\n`);
  console.log(
    "query".padEnd(34) +
      "indexed(ms)".padStart(12) +
      "naive(ms)".padStart(12) +
      "speedup".padStart(10) +
      "match".padStart(7),
  );
  console.log("-".repeat(75));

  for (const q of QUERIES) {
    let idx = 0;
    let naive = 0;
    let b = engine.benchmark(q); // warm-up (ignored)
    for (let i = 0; i < RUNS; i++) {
      b = engine.benchmark(q);
      idx += b.indexed.tookMs;
      naive += b.naive.tookMs;
    }
    idx /= RUNS;
    naive /= RUNS;
    console.log(
      q.padEnd(34) +
        idx.toFixed(3).padStart(12) +
        naive.toFixed(1).padStart(12) +
        `${(naive / idx).toFixed(0)}x`.padStart(10) +
        String(b.topHitsMatch).padStart(7),
    );
  }
  engine.close();
}

main();







