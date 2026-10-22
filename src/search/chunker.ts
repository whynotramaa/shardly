import { createHash } from "node:crypto";
import type { Document } from "../types.js";
import { documentFields } from "./tokenizer.js";
import type { Block } from "./evidence.js";
import { boundedInteger } from "../vector/store.js";

export interface ChunkOptions { size?: number; overlap?: number }
export interface Chunk extends Block { id: string; documentId: string; revision: string; order: number; tokens: number }
/** Unicode word tokens include stopwords; source offsets always use UTF-16. */
export function chunkDocument(documentId: string, revision: string, doc: Document, options: ChunkOptions = {}): Chunk[] {
  const size = boundedInteger(options.size ?? 160, "chunk size", 2, 4096);
  const overlap = boundedInteger(options.overlap ?? Math.min(32, size - 1), "chunk overlap", 0, size - 1);
  const chunks: Chunk[] = [];
  const language = typeof doc.contentLanguage === "string" ? doc.contentLanguage : "en";
  const words = new Intl.Segmenter(language, { granularity: "word" }), sentences = new Intl.Segmenter(language, { granularity: "sentence" });
  for (const { field, text } of documentFields(doc)) {
    if (["source", "repo", "type", "language", "contentLanguage", "sourceId", "path", "filename", "pageOffsets"].includes(field)) continue;
    const tokens = [...words.segment(text)].filter(row => row.isWordLike);
    const ends = [...sentences.segment(text)].map(row => row.index + row.segment.length);
    const cuts = new Set<number>();
    let sentence = 0;
    tokens.forEach((token, index) => { while (sentence < ends.length && ends[sentence]! <= token.index) { cuts.add(index); sentence++; } });
    let first = 0;
    let previousStart = 0, line = 1;
    while (first < tokens.length) {
      let last = Math.min(tokens.length, first + size);
      if (last < tokens.length) {
        for (let candidate = last; candidate > first + Math.max(overlap, Math.floor(size / 2)); candidate--) {
          if (cuts.has(candidate)) { last = candidate; break; }
        }
      }
      const start = first === 0 ? 0 : tokens[first]!.index;
      const end = last === tokens.length ? text.length : tokens[last]!.index;
      // Evidence references have a 64 KiB character limit even for unusually long tokens.
      if (end - start > 65536) throw new Error("chunk exceeds evidence character budget");
      const id = createHash("sha256").update(JSON.stringify(["tokens-1", documentId, revision, field, start, end, size, overlap])).digest("hex");
      line += text.slice(previousStart, start).split("\n").length - 1; previousStart = start;
      chunks.push({ id, documentId, revision, field, start, end, order: chunks.length, tokens: last - first, kind: "text", line });
      if (last === tokens.length) break;
      first = Math.max(first + 1, last - overlap);
    }
  }
  return chunks;
}
