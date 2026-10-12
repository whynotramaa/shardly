import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Document } from "../types.js";

export const WIKI_CORPUS_PATH =
  process.env.WIKI_CORPUS ?? "./corpus/wikipedia.ndjson";

export function corpusExists(path = WIKI_CORPUS_PATH): boolean {
  return existsSync(path);
}

/** Count the documents available in the corpus file (0 if absent). */
export async function countCorpus(path = WIKI_CORPUS_PATH): Promise<number> {
  if (!existsSync(path)) return 0;
  let n = 0;
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (parseLine(line)) n++;
  return n;
}

export async function streamCorpus(
  onBatch: (docs: Document[]) => void | Promise<void>,
  batchSize = 500,
  path = WIKI_CORPUS_PATH,
): Promise<void> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("batch size must be a positive integer");
  if (!existsSync(path)) return;
  const input = createReadStream(path);
  const rl = createInterface({
    input,
    crlfDelay: Infinity,
  });
  let batch: Document[] = [];
  try {
    for await (const line of rl) {
      const doc = parseLine(line);
      if (!doc) continue;
      batch.push(doc);
      if (batch.length >= batchSize) {
        await onBatch(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await onBatch(batch);
  } finally {
    rl.close();
    input.destroy();
  }
}

function parseLine(line: string): Document | undefined {
  if (!line.trim()) return undefined;
  try {
    const doc = JSON.parse(line) as Document;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return undefined;
    return doc.source === "wikipedia" && Number.isSafeInteger(doc.pageid)
      ? { ...doc, sourceId: `wikipedia:${doc.pageid}` }
      : doc;
  } catch { return undefined; }
}
