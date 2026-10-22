import type { RuntimeEngine } from "../runtime/engine.js";
import type { RetrievalHit } from "../api/retrieval.js";
import type { ReadScope } from "./filters.js";
import { chunkDocument } from "./chunker.js";

export interface ContextOptions { tokenBudget: number; neighbors: number; ordering: "rank" | "source" }
/** Budget units are Unicode words, not a model-specific subword vocabulary. */
export async function buildContext(engine: RuntimeEngine, hits: RetrievalHit[], options: ContextOptions, scope?: ReadScope) {
  const segmenter = new Intl.Segmenter("en", { granularity: "word" });
  const words = (text: string) => [...segmenter.segment(text)].filter(row => row.isWordLike);
  const evidence: Array<{ citation: string; documentId: string; revision: string; chunkId: string; field: string; start: number; end: number; text: string; reference: string; metadata: Record<string, unknown>; scores: Record<string, number>; tokens: number }> = [];
  let tokens = 0;
  for (const hit of hits) {
    let passages = [...hit.passages];
    if (options.neighbors && passages.length) {
      const manifest = await engine.retrievalManifest({ docIds: [hit.documentId], scope }, 0, 1);
      const doc = manifest.items[0];
      if (doc && doc.revision === hit.revision) {
        const chunks = chunkDocument(doc.id, doc.revision, doc.doc);
        for (const original of hit.passages) {
          const matches = chunks.map((chunk, index) => ({ chunk, index })).filter(({ chunk }) => chunk.field === original.field && chunk.start < original.end && chunk.end > original.start);
          for (const { index } of matches) for (let i = Math.max(0, index - options.neighbors); i <= Math.min(chunks.length - 1, index + options.neighbors); i++) {
            const chunk = chunks[i]!;
            if (chunk.field !== original.field) continue;
            const fetched = await engine.fetchEvidence({ documentId: hit.documentId, revision: hit.revision, field: chunk.field, start: chunk.start, end: chunk.end }, scope);
            if (fetched.state === "complete") passages.push(fetched.passage);
          }
        }
      }
    }
    passages = passages.sort((a, b) => a.field.localeCompare(b.field) || a.start - b.start);
    for (let passage of passages) {
      if (tokens >= options.tokenBudget) break;
      if (!passage.reference || evidence.some(row => row.text.trim() === passage.text.trim() || row.documentId === hit.documentId && row.field === passage.field && row.start < passage.end && row.end > passage.start)) continue;
      const counted = words(passage.text), remaining = options.tokenBudget - tokens;
      if (!counted.length) continue;
      if (counted.length > remaining) {
        const end = passage.start + counted[remaining]!.index;
        const fetched = await engine.fetchEvidence({ documentId: hit.documentId, revision: hit.revision, field: passage.field, start: passage.start, end }, scope);
        if (fetched.state !== "complete") continue;
        passage = fetched.passage;
      }
      const count = Math.min(counted.length, remaining);
      evidence.push({ citation: `C${evidence.length + 1}`, documentId: hit.documentId, revision: passage.revision ?? hit.revision!, chunkId: passage.reference!, field: passage.field, start: passage.start, end: passage.end, text: passage.text, reference: passage.reference!, metadata: hit.source, scores: hit.scores, tokens: count });
      tokens += count;
    }
  }
  if (options.ordering === "source") evidence.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.field.localeCompare(b.field) || a.start - b.start);
  return { tokenBudget: options.tokenBudget, tokenUnit: "unicode-words", tokens, evidence, text: evidence.map(row => `[${row.citation}] ${row.text}`).join("\n\n"), citationGuarantee: "References identify retrieved source ranges; they do not verify claims." };
}
