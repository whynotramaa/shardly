import { BM25_K1, BM25_B } from "../config.js";
import type { InvertedIndexStore } from "./index.js";
import type { TermScore } from "../types.js";

/**
 * BM25 ranking, implemented by hand.
 *
 * Per query term qi, per document D:
 *
 *   score += IDF(qi) * ( f * (k1 + 1) ) / ( f + k1 * (1 - b + b * |D|/avgdl) )
 *
 * where
 *   f     = frequency of qi in D
 *   |D|   = length of D in tokens
 *   avgdl = average document length in the corpus
 *   IDF   = ln( (N - n + 0.5) / (n + 0.5) + 1 )
 *   N     = total docs, n = docs containing qi
 *
 * The `b` term normalizes for document length, so a long doc isn't unfairly
 * favored just for having more room to contain a term (tested in rank.test.ts).
 *
 * Latency design (two passes):
 *   1. Accumulate a single running score per candidate — numbers only, no
 *      per-term object allocation. This is the O(total postings) work.
 *   2. Select the top-N with a bounded min-heap (O(candidates · log N)), then
 *      compute the explanatory per-term breakdown for those ≤N winners only.
 * The naive one-pass version allocated a breakdown array for every candidate
 * and sorted all of them; deferring that to the winners is the big win when a
 * common term matches tens of thousands of documents.
 *
 * Depends only on the index's read surface and the two constants — it knows
 * nothing about `fs` or how documents are stored.
 */

export interface RankResult {
  docId: string;
  score: number;
  breakdown: TermScore[];
}

export interface RankOutput {
  /** Total number of documents matching at least one query term. */
  total: number;
  /** The top-N results (per the limit), highest score first. */
  results: RankResult[];
}

export interface RankOptions {
  limit?: number;
  k1?: number;
  b?: number;
}

/** IDF(qi) = ln( (N - n + 0.5) / (n + 0.5) + 1 ). The `+1` keeps IDF
 * non-negative even for terms that appear in most documents. */
export function idf(totalDocs: number, docsContaining: number): number {
  return Math.log(
    (totalDocs - docsContaining + 0.5) / (docsContaining + 0.5) + 1,
  );
}

/** Contribution of a single (term, doc) pair to the BM25 score. */
function contributionOf(
  termIdf: number,
  termFrequency: number,
  docLen: number,
  avgdl: number,
  k1: number,
  b: number,
): number {
  const denom = termFrequency + k1 * (1 - b + (b * docLen) / avgdl);
  return (termIdf * (termFrequency * (k1 + 1))) / denom;
}

export function rankBM25(
  index: InvertedIndexStore,
  queryTerms: string[],
  options: RankOptions = {},
): RankOutput {
  const { limit = Infinity, k1 = BM25_K1, b = BM25_B } = options;

  const totalDocs = index.documentCount();
  const avgdl = index.averageDocumentLength();
  if (totalDocs === 0 || avgdl === 0) return { total: 0, results: [] };

  // Deduplicate query terms and precompute each term's IDF once.
  const uniqueTerms = [...new Set(queryTerms)].filter(
    (t) => index.postings(t).length > 0,
  );
  const idfByTerm = new Map<string, number>();
  for (const term of uniqueTerms) {
    idfByTerm.set(term, idf(totalDocs, index.documentFrequency(term)));
  }

  // Pass 1: accumulate total scores. Numbers only — no per-candidate objects.
  const scores = new Map<string, number>();
  for (const term of uniqueTerms) {
    const termIdf = idfByTerm.get(term)!;
    for (const { docId, termFrequency } of index.postings(term)) {
      const c = contributionOf(
        termIdf,
        termFrequency,
        index.documentLength(docId),
        avgdl,
        k1,
        b,
      );
      scores.set(docId, (scores.get(docId) ?? 0) + c);
    }
  }

  // Select the winners: partial top-N when a limit is set, else full sort.
  const winners = selectTopN(scores, limit);

  // Pass 2: build the per-term breakdown for winners only.
  const results = winners.map(({ docId, score }) => {
    const docLen = index.documentLength(docId);
    const breakdown: TermScore[] = [];
    for (const term of uniqueTerms) {
      const tf = termFrequencyIn(index, term, docId);
      if (tf === 0) continue;
      const termIdf = idfByTerm.get(term)!;
      breakdown.push({
        term,
        termFrequency: tf,
        idf: termIdf,
        contribution: contributionOf(termIdf, tf, docLen, avgdl, k1, b),
      });
    }
    breakdown.sort((a, b2) => b2.contribution - a.contribution);
    return { docId, score, breakdown };
  });

  return { total: scores.size, results };
}

/** Term frequency of `term` in `docId` via its posting list. Winners only, so
 * this runs at most N·|query| times regardless of corpus size. */
function termFrequencyIn(
  index: InvertedIndexStore,
  term: string,
  docId: string,
): number {
  for (const p of index.postings(term)) {
    if (p.docId === docId) return p.termFrequency;
  }
  return 0;
}

/**
 * Return the highest-scoring entries, descending. For a bounded limit this uses
 * a size-`limit` min-heap so the cost is O(candidates · log limit) instead of
 * sorting the entire candidate set.
 */
function selectTopN(
  scores: Map<string, number>,
  limit: number,
): Array<{ docId: string; score: number }> {
  const all: Array<{ docId: string; score: number }> = [];

  if (!Number.isFinite(limit) || limit >= scores.size) {
    for (const [docId, score] of scores) all.push({ docId, score });
    all.sort((a, b) => b.score - a.score);
    return all;
  }

  const heap = new MinHeap(limit);
  for (const [docId, score] of scores) heap.offer(docId, score);
  return heap.drainDescending();
}

/** Fixed-capacity min-heap keyed by score, keeping the top-`capacity` items. */
class MinHeap {
  private readonly ids: string[] = [];
  private readonly scores: number[] = [];

  constructor(private readonly capacity: number) {}

  offer(id: string, score: number): void {
    if (this.scores.length < this.capacity) {
      this.ids.push(id);
      this.scores.push(score);
      this.bubbleUp(this.scores.length - 1);
    } else if (score > this.scores[0]!) {
      this.ids[0] = id;
      this.scores[0] = score;
      this.bubbleDown(0);
    }
  }

  drainDescending(): Array<{ docId: string; score: number }> {
    const out = this.ids.map((id, i) => ({ docId: id, score: this.scores[i]! }));
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent]! <= this.scores[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.scores.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.scores[l]! < this.scores[smallest]!) smallest = l;
      if (r < n && this.scores[r]! < this.scores[smallest]!) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.scores[a], this.scores[b]] = [this.scores[b]!, this.scores[a]!];
  }
}
