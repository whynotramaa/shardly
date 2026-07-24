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
  for await (const line of rl) if (line.trim()) n++;
  return n;
}


export async function streamCorpus(
  onBatch: (docs: Document[]) => void,
  batchSize = 500,
  path = WIKI_CORPUS_PATH,
): Promise<void> {
  if (!existsSync(path)) return;
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  let batch: Document[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      batch.push(JSON.parse(trimmed) as Document);
    } catch {
      continue;
    }
    if (batch.length >= batchSize) {
      onBatch(batch);
      batch = [];
    }
  }
  if (batch.length > 0) onBatch(batch);
}







