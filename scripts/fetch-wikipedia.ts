
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fetchWikipediaDocuments } from "../src/ingest/wikipedia.js";

const count = Number.parseInt(process.argv[2] ?? "20000", 10);
const outFile = process.argv[3] ?? "./corpus/wikipedia.ndjson";

async function main() {
  mkdirSync(dirname(outFile), { recursive: true });
  const stream = createWriteStream(outFile, { flags: "w" });
  const start = Date.now();
  let written = 0;

  console.log(`Fetching ${count} Wikipedia articles → ${outFile}`);
  await fetchWikipediaDocuments({
    count,
    concurrency: 5, // gentle: avoid tripping the rate limiter
    onDocs: (docs) => {
      for (const d of docs) stream.write(JSON.stringify(d) + "\n");
      written += docs.length;
      if (written % 1000 < docs.length) {
        const rate = (written / ((Date.now() - start) / 1000)).toFixed(0);
        console.log(`  ${written} / ${count}  (${rate}/s)`);
      }
    },
  });

  await new Promise<void>((resolve) => stream.end(resolve));
  console.log(
    `Done: ${written} articles in ${((Date.now() - start) / 1000).toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
