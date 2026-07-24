
import { Engine } from "../src/engine.js";

const COUNT = Number.parseInt(process.argv[2] ?? "50000", 10);
const dataDir = process.argv[3]; // undefined -> default ./data

const VOCAB = [
  "storage", "index", "search", "database", "system", "engine", "document",
  "query", "ranking", "segment", "offset", "durability", "crash", "recovery",
  "inverted", "posting", "tokenizer", "stopword", "relevance", "score",
  "distributed", "log", "append", "snapshot", "compaction", "tombstone",
  "latency", "throughput", "benchmark", "cache", "memory", "disk", "seek",
  "write", "read", "delete", "update", "consistency", "replication", "shard",
  "partition", "cluster", "node", "network", "protocol", "serialize", "buffer",
  "stream", "flush", "fsync", "corruption", "integrity", "checksum", "vector",
];

const TITLE_PREFIX = [
  "Notes on", "A study of", "Understanding", "Deep dive into", "Practical",
  "Rethinking", "Scaling", "Debugging", "Optimizing", "Introduction to",
];

/** Deterministic PRNG so runs are reproducible. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const rand = makeRng(42);

/** Sample a vocab word with a bias toward the front of the list (Zipf-ish). */
function sampleWord(): string {
  const idx = Math.floor(Math.pow(rand(), 2.2) * VOCAB.length);
  return VOCAB[Math.min(idx, VOCAB.length - 1)]!;
}

function makeDocument(i: number) {
  const bodyLen = 20 + Math.floor(rand() * 180); // 20ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ200 tokens
  const words: string[] = [];
  for (let w = 0; w < bodyLen; w++) words.push(sampleWord());
  return {
    title: `${TITLE_PREFIX[i % TITLE_PREFIX.length]} ${sampleWord()} ${sampleWord()}`,
    body: words.join(" "),
    seq: i,
  };
}

function main() {
  console.log(`Seeding ${COUNT} documents into ${dataDir ?? "./data"} ...`);
  const engine = new Engine(dataDir);
  const start = performance.now();

  // Group-commit in batches: one amortized fsync per batch instead of per doc.
  const BATCH = 1000;
  let batch: ReturnType<typeof makeDocument>[] = [];
  for (let i = 0; i < COUNT; i++) {
    batch.push(makeDocument(i));
    if (batch.length === BATCH) {
      engine.addDocuments(batch);
      batch = [];
    }
    if ((i + 1) % 10000 === 0) {
      const rate = ((i + 1) / (performance.now() - start)) * 1000;
      console.log(`  ${i + 1} docs  (${rate.toFixed(0)} docs/s)`);
    }
  }
  if (batch.length > 0) engine.addDocuments(batch);
  engine.snapshot();
  const elapsed = (performance.now() - start) / 1000;

  console.log(
    `\nDone: ${engine.documentCount()} docs in ${elapsed.toFixed(1)}s ` +
      `(${(COUNT / elapsed).toFixed(0)} docs/s, group-commit fsync)`,
  );

  // Fire a couple of benchmark queries so the seed run itself reports numbers.
  for (const q of ["storage index", "crash recovery latency", "vector"]) {
    const b = engine.benchmark(q, 10);
    console.log(
      `\nquery "${q}":\n` +
        `  indexed: ${b.indexed.tookMs.toFixed(3)} ms  (${b.indexed.scanned} candidates)\n` +
        `  naive:   ${b.naive.tookMs.toFixed(3)} ms  (${b.naive.scanned} docs scanned)\n` +
        `  speedup: ${b.speedup.toFixed(0)}x   topHitsMatch=${b.topHitsMatch}`,
    );
  }
  engine.close();
}

main();







