import fs from "node:fs";
import type { InvertedIndex, PostingList, Posting } from "../types.js";


export class InvertedIndexStore {
  /** term -> posting list. */
  private readonly index: InvertedIndex = new Map();
  /** term -> number of distinct docs containing it (BM25 IDF input). */
  private readonly docFreq = new Map<string, number>();
  /** docId -> its length in tokens (BM25 length normalization input). */
  private readonly docLengths = new Map<string, number>();
  /** Running sum of all document lengths, for O(1) average. */
  private totalTokens = 0;



  addDocument(docId: string, tokens: string[]): void {
    if (this.docLengths.has(docId)) this.removeDocument(docId);

    // Count term frequencies within this document.
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    for (const [term, freq] of tf) {
      let list = this.index.get(term);
      if (list === undefined) {
        list = [];
        this.index.set(term, list);
      }
      list.push({ docId, termFrequency: freq });
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    this.docLengths.set(docId, tokens.length);
    this.totalTokens += tokens.length;
  }

  /** Drop the entire index ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â every posting and all corpus stats. */
  clear(): void {
    this.index.clear();
    this.docFreq.clear();
    this.docLengths.clear();
    this.totalTokens = 0;
  }

  /** Strip a document from every term's posting list. Needed for delete/update. */
  removeDocument(docId: string): void {
    const length = this.docLengths.get(docId);
    if (length === undefined) return;

    for (const [term, list] of this.index) {
      const next = list.filter((p) => p.docId !== docId);
      if (next.length === list.length) continue; // term wasn't in this doc

      if (next.length === 0) {
        this.index.delete(term);
        this.docFreq.delete(term);
      } else {
        this.index.set(term, next);
        this.docFreq.set(term, next.length);
      }
    }

    this.docLengths.delete(docId);
    this.totalTokens -= length;
  }


  /** Posting list for a term, or an empty list if the term is unknown. */
  postings(term: string): PostingList {
    return this.index.get(term) ?? [];
  }

  /** How many documents contain a term (n(qi) in BM25's IDF). */
  documentFrequency(term: string): number {
    return this.docFreq.get(term) ?? 0;
  }

  /** Length in tokens of a specific document (|D| in BM25). */
  documentLength(docId: string): number {
    return this.docLengths.get(docId) ?? 0;
  }

  /** Total number of indexed documents (N in BM25). */
  documentCount(): number {
    return this.docLengths.size;
  }

  /** Average document length across the corpus (avgdl in BM25). */
  averageDocumentLength(): number {
    const n = this.docLengths.size;
    return n === 0 ? 0 : this.totalTokens / n;
  }


  /** Serialize the whole index to a JSON snapshot for fast startup. */
  snapshot(filePath: string): void {
    const payload = {
      index: Object.fromEntries(this.index),
      docFreq: Object.fromEntries(this.docFreq),
      docLengths: Object.fromEntries(this.docLengths),
      totalTokens: this.totalTokens,
    };
    const tmp = `${filePath}.tmp`;
    const fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, JSON.stringify(payload));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, filePath);
  }

  /** Load a snapshot back into memory. Returns false if none exists. */
  load(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.trim().length === 0) return false;

    const payload = JSON.parse(raw) as {
      index: Record<string, PostingList>;
      docFreq: Record<string, number>;
      docLengths: Record<string, number>;
      totalTokens: number;
    };

    this.index.clear();
    this.docFreq.clear();
    this.docLengths.clear();

    for (const [term, list] of Object.entries(payload.index)) {
      this.index.set(term, list as Posting[]);
    }
    for (const [term, n] of Object.entries(payload.docFreq)) {
      this.docFreq.set(term, n);
    }
    for (const [id, len] of Object.entries(payload.docLengths)) {
      this.docLengths.set(id, len);
    }
    this.totalTokens = payload.totalTokens;
    return true;
  }
}







