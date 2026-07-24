import fs from "node:fs";
import { dataPaths, SNAPSHOT_EVERY_N_WRITES, type DataPaths } from "./config.js";
import { Storage } from "./storage/storage.js";
import { InvertedIndexStore } from "./search/index.js";
import { rankBM25, idf } from "./search/rank.js";
import { tokenize, tokenizeDocument } from "./search/tokenizer.js";
import { BM25_K1, BM25_B } from "./config.js";
import type { Document, SearchHit, TermScore } from "./types.js";

export interface SearchResponse {
  query: string;
  terms: string[];
  tookMs: number;
  total: number;
  hits: SearchHit[];
}

export interface BenchmarkResponse {
  query: string;
  terms: string[];
  indexed: { tookMs: number; scanned: number; hits: number };
  naive: { tookMs: number; scanned: number; hits: number };
  speedup: number;
  topHitsMatch: boolean;
}

/**
 * The engine wires the four independent modules together into one document
 * store: storage (durability), the inverted index (fast candidate lookup),
 * the tokenizer (text -> terms), and BM25 (ranking).
 *
 * Latency design: every corpus statistic BM25 needs lives in the in-memory
 * inverted index, so a search touches disk only to hydrate the final top-N
 * documents — each via a single O(1) offset seek. Nothing scans segments.
 */
export class Engine {
  private readonly storage: Storage;
  private readonly index = new InvertedIndexStore();
  private readonly paths: DataPaths;
  private writesSinceSnapshot = 0;

  constructor(dataDir?: string) {
    this.paths = dataPaths(dataDir);
    this.storage = new Storage(dataDir);
    this.hydrateIndex();
  }

  // ---------------------------------------------------------------------------
  // Document CRUD
  // ---------------------------------------------------------------------------

  addDocument(doc: Document): string {
    const docId = this.storage.write(doc);
    this.index.addDocument(docId, tokenizeDocument(doc));
    this.maybeSnapshot();
    return docId;
  }

  /** Group-commit batch ingest — one amortized fsync for the batch. Use for
   * bulk import; far higher throughput than looping {@link addDocument}. */
  addDocuments(docs: Document[]): string[] {
    const ids = this.storage.writeBatch(docs);
    for (let i = 0; i < ids.length; i++) {
      this.index.addDocument(ids[i]!, tokenizeDocument(docs[i]!));
    }
    this.writesSinceSnapshot += ids.length;
    if (this.writesSinceSnapshot >= SNAPSHOT_EVERY_N_WRITES) this.snapshot();
    return ids;
  }

  getDocument(docId: string): Document | null {
    return this.storage.read(docId);
  }

  deleteDocument(docId: string): boolean {
    const ok = this.storage.delete(docId);
    if (ok) {
      this.index.removeDocument(docId);
      this.maybeSnapshot();
    }
    return ok;
  }

  documentCount(): number {
    return this.storage.size();
  }

  /** A page of stored documents (newest-written last), for the browse view. */
  listDocuments(
    offset: number,
    limit: number,
  ): { total: number; items: Array<{ id: string; doc: Document }> } {
    const ids = this.storage.liveDocIds();
    const items = ids.slice(offset, offset + limit).map((id) => ({
      id,
      doc: this.storage.read(id) ?? {},
    }));
    return { total: ids.length, items };
  }

  /** Collect the ids (and pageids, if present) of every live document whose
   *  `source` field matches — used to de-index or dedupe a bundled corpus. */
  collectBySource(source: string): Array<{ id: string; pageid?: number }> {
    const out: Array<{ id: string; pageid?: number }> = [];
    for (const id of this.storage.liveDocIds()) {
      const doc = this.storage.read(id);
      if (doc && doc.source === source) {
        out.push({
          id,
          pageid: typeof doc.pageid === "number" ? doc.pageid : undefined,
        });
      }
    }
    return out;
  }

  /** Clear every document and index — a clean slate for the user's own uploads. */
  reset(): void {
    this.storage.reset();
    this.index.clear();
    fs.rmSync(this.paths.invertedSnapshot, { force: true });
    this.writesSinceSnapshot = 0;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /** Ranked full-text search via the inverted index. */
  search(query: string, limit = 10): SearchResponse {
    const terms = tokenize(query);
    const start = performance.now();
    const { total, results } = rankBM25(this.index, terms, { limit });
    const hits: SearchHit[] = results.map((r) => ({
      docId: r.docId,
      score: r.score,
      doc: this.storage.read(r.docId) ?? {},
      breakdown: r.breakdown,
    }));
    const tookMs = performance.now() - start;
    return { query, terms, tookMs, total, hits };
  }

  /**
   * The baseline the benchmark exists to beat: score the query by reading and
   * tokenizing EVERY live document from disk — no index, no shortcuts. This is
   * what a store without an inverted index is forced to do on every query.
   */
  naiveSearch(query: string, limit = 10): SearchResponse {
    const terms = [...new Set(tokenize(query))];
    const start = performance.now();

    const ids = this.storage.liveDocIds();

    // Single linear pass: gather each doc's length + query-term frequencies,
    // plus the corpus stats BM25 needs — all recomputed from scratch.
    const docTokens = new Map<string, Map<string, number>>();
    const docLen = new Map<string, number>();
    const docFreq = new Map<string, number>();
    let totalTokens = 0;

    for (const id of ids) {
      const doc = this.storage.read(id);
      if (doc === null) continue;
      const tokens = tokenizeDocument(doc);
      totalTokens += tokens.length;
      docLen.set(id, tokens.length);

      const tf = new Map<string, number>();
      for (const t of tokens) if (terms.includes(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
      if (tf.size > 0) {
        docTokens.set(id, tf);
        for (const t of tf.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
    }

    const n = ids.length;
    const avgdl = n === 0 ? 0 : totalTokens / n;
    const scored: { docId: string; score: number; breakdown: TermScore[] }[] = [];

    for (const [id, tf] of docTokens) {
      let score = 0;
      const breakdown: TermScore[] = [];
      for (const [term, freq] of tf) {
        const termIdf = idf(n, docFreq.get(term) ?? 0);
        const len = docLen.get(id) ?? 0;
        const denom = freq + BM25_K1 * (1 - BM25_B + (BM25_B * len) / avgdl);
        const contribution = (termIdf * (freq * (BM25_K1 + 1))) / denom;
        score += contribution;
        breakdown.push({ term, termFrequency: freq, idf: termIdf, contribution });
      }
      breakdown.sort((a, b) => b.contribution - a.contribution);
      scored.push({ docId: id, score, breakdown });
    }
    scored.sort((a, b) => b.score - a.score);

    const hits: SearchHit[] = scored.slice(0, limit).map((r) => ({
      docId: r.docId,
      score: r.score,
      doc: this.storage.read(r.docId) ?? {},
      breakdown: r.breakdown,
    }));
    const tookMs = performance.now() - start;
    return { query, terms, tookMs, total: scored.length, hits };
  }

  /** Run the same query both ways and compare timings — the interview demo. */
  benchmark(query: string, limit = 10): BenchmarkResponse {
    const indexed = this.search(query, limit);
    const naive = this.naiveSearch(query, limit);

    const topIndexed = indexed.hits[0]?.docId;
    const topNaive = naive.hits[0]?.docId;

    return {
      query,
      terms: indexed.terms,
      indexed: {
        tookMs: indexed.tookMs,
        scanned: indexed.total,
        hits: indexed.hits.length,
      },
      naive: {
        tookMs: naive.tookMs,
        scanned: this.storage.size(),
        hits: naive.hits.length,
      },
      speedup: naive.tookMs / Math.max(indexed.tookMs, 1e-6),
      topHitsMatch: topIndexed === topNaive,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Persist both index snapshots and truncate the WAL. */
  snapshot(): void {
    this.storage.snapshot();
    this.index.snapshot(this.paths.invertedSnapshot);
    this.writesSinceSnapshot = 0;
  }

  close(): void {
    this.snapshot();
    this.storage.close();
  }

  private maybeSnapshot(): void {
    if (++this.writesSinceSnapshot >= SNAPSHOT_EVERY_N_WRITES) this.snapshot();
  }

  /**
   * Rebuild the in-memory inverted index at startup. Prefer the snapshot for a
   * fast start, but if it's missing or out of sync with storage (e.g. a crash
   * recovered writes the snapshot never saw), rebuild from the durable segments
   * — storage is always the source of truth.
   */
  private hydrateIndex(): void {
    const loaded = this.index.load(this.paths.invertedSnapshot);
    if (loaded && this.index.documentCount() === this.storage.size()) return;

    this.rebuildIndexFromStorage();
  }

  private rebuildIndexFromStorage(): void {
    for (const id of this.storage.liveDocIds()) {
      const doc = this.storage.read(id);
      if (doc !== null) this.index.addDocument(id, tokenizeDocument(doc));
    }
  }
}
