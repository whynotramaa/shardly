import fs from "node:fs";
import { createHash } from "node:crypto";
import { tokenizeDetailed, type TokenInfo } from "./tokenizer.js";
import type { PostingList, Posting } from "../types.js";

export class InvertedIndexStore {
  private readonly index = new Map<string, { data: Uint32Array; size: number }>();
  private readonly ids: string[] = [];
  private readonly numbers = new Map<string, number>();
  private readonly freeNumbers: number[] = [];
  /** term -> number of distinct docs containing it (BM25 IDF input). */
  private readonly docFreq = new Map<string, number>();
  /** docId -> its length in tokens (BM25 length normalization input). */
  private readonly docLengths = new Map<string, number>();
  /** docId -> the distinct terms it contributed, so delete touches only those. */
  private readonly docTerms = new Map<string, string[]>();
  // shortcut: removed interned terms remain until rebuild/restart; prune if sustained vocabulary churn requires it.
  private readonly termIds = new Map<string, number>();
  private readonly interned: string[] = [];
  private intern(term: string): number {
    let id = this.termIds.get(term);
    if (id === undefined) { id = this.interned.length; this.interned.push(term); this.termIds.set(term, id); }
    return id;
  }
  private packedFrequencies(tokens: TokenInfo[]): PackedFrequencies {
    return new PackedFrequencies(tokens.map(t => this.intern(t.term)), this.termIds);
  }
  private totalTokens = 0;
  private dictionary: string[] | undefined;
  private readonly typoDictionary = new Map<string, Set<string>>();
  private readonly fields = new Map<string, IndexedField[]>();
  private readonly fieldTotals = new Map<
    string,
    { length: number; count: number }
  >();

  indexedFields(id: string): IndexedField[] {
    return this.fields.get(id) ?? [];
  }
  averageFieldLength(field: string): number {
    const stats = this.fieldTotals.get(field);
    return stats ? stats.length / stats.count : 1;
  }
  setFields(
    id: string,
    values: Array<{ field: string; text: string; tokens?: TokenInfo[] }>,
  ): void {
    this.removeFields(id);
    const fields = values.map(
      ({ field, text, tokens = tokenizeDetailed(text, field) }) => {
        const length = tokens.length
          ? tokens[tokens.length - 1]!.position + 1
          : 0;
        const windows: TokenWindow[] = [];
        const main = !["title", "path", "repo"].includes(field);
        let first = 0,
          last = 0;
        for (let start = 0; start < length; start += main ? 90 : length) {
          while (first < tokens.length && tokens[first]!.position < start)
            first++;
          while (
            last < tokens.length &&
            tokens[last]!.position < start + (main ? 120 : length)
          )
            last++;
          const local = tokens.slice(first, last);
          if (local.length)
            windows.push({
              start: local[0]!.start,
              end: local[local.length - 1]!.end,
              length: Math.min(main ? 120 : length, length - start),
              tf: this.packedFrequencies(local),
            });
          if (!main || start + 120 >= length) break;
        }
        const stats = this.fieldTotals.get(field) ?? { length: 0, count: 0 };
        for (const window of windows) {
          stats.length += window.length;
          stats.count++;
        }
        this.fieldTotals.set(field, stats);
        const packed = new Uint32Array(tokens.length * 4);
        tokens.forEach((t, i) => packed.set([this.intern(t.term), t.position, t.start, t.end], i * 4));
        const words = this.interned;
        return { field, length, tf: this.packedFrequencies(tokens), windows,
          packedBytes: packed.byteLength,
          get tokens(): Array<Omit<TokenInfo, "original">> {
            return Array.from({ length: packed.length / 4 }, (_, i) => ({ term: words[packed[i * 4]!]!, position: packed[i * 4 + 1]!, start: packed[i * 4 + 2]!, end: packed[i * 4 + 3]!, field }));
          }
        };
      },
    );
    this.fields.set(id, fields);
  }
  private removeFields(id: string): void {
    for (const field of this.fields.get(id) ?? []) {
      const stats = this.fieldTotals.get(field.field)!;
      for (const window of field.windows) {
        stats.length -= window.length;
        stats.count--;
      }
      if (!stats.count) this.fieldTotals.delete(field.field);
    }
    this.fields.delete(id);
  }
  prefix(prefix: string, limit = 20): string[] {
    const words = this.terms();
    let lo = 0,
      hi = words.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (words[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    while (
      lo < words.length &&
      out.length < limit &&
      words[lo]!.startsWith(prefix)
    )
      out.push(words[lo++]!);
    return out;
  }
  private addTypoTerm(term: string): void {
    if (term.length > 64) return;
    for (const key of deletions(term)) {
      const bucket = this.typoDictionary.get(key) ?? new Set<string>();
      bucket.add(term);
      this.typoDictionary.set(key, bucket);
    }
  }
  typos(term: string, limit = 20): string[] {
    if (term.length < 3 || term.length > 64) return [];
    // shortcut: typos use terms up to 64 UTF-16 units and 2048 checks, raise only with measured recall needs.
    const out = new Set<string>();
    let work = 0;
    for (const key of deletions(term))
      for (const word of this.typoDictionary.get(key) ?? []) {
        if (++work > 2048) return [...out];
        if (oneEdit(term, word)) out.add(word);
        if (out.size >= limit) return [...out];
      }
    return [...out];
  }

  addDocument(docId: string, tokens: string[]): void {
    this.dictionary = undefined;
    if (this.docLengths.has(docId)) this.removeDocument(docId);

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    let number = this.numbers.get(docId);
    if (number === undefined) { number = this.freeNumbers.pop() ?? this.ids.length; this.ids[number] = docId; this.numbers.set(docId, number); }
    for (const [term, freq] of tf) {
      let list = this.index.get(term);
      if (list === undefined) {
        list = { data: new Uint32Array(8), size: 0 };
        this.index.set(term, list);
        this.addTypoTerm(term);
      }
      if (list.size * 2 === list.data.length) {
        const next = new Uint32Array(list.data.length * 2); next.set(list.data); list.data = next;
      }
      list.data[list.size * 2] = number;
      list.data[list.size * 2 + 1] = freq;
      list.size++;
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    this.docLengths.set(docId, tokens.length);
    this.docTerms.set(docId, [...tf.keys()]);
    this.totalTokens += tokens.length;
  }

  clear(): void {
    this.termIds.clear();
    this.interned.length = 0;
    this.freeNumbers.length = 0;
    this.ids.length = 0;
    this.numbers.clear();
    this.fields.clear();
    this.fieldTotals.clear();
    this.dictionary = undefined;
    this.typoDictionary.clear();
    this.index.clear();
    this.docFreq.clear();
    this.docLengths.clear();
    this.docTerms.clear();
    this.totalTokens = 0;
  }

  /** Strip a document from its own terms' posting lists. Needed for delete/update. */
  removeDocument(docId: string): void {
    this.removeFields(docId);
    this.dictionary = undefined;
    const length = this.docLengths.get(docId);
    if (length === undefined) return;

    for (const term of this.docTerms.get(docId) ?? []) {
      const list = this.index.get(term);
      if (list === undefined) continue;
      const number = this.numbers.get(docId);
      let size = 0;
      for (let i = 0; i < list.size; i++) if (list.data[i * 2] !== number) {
        list.data[size * 2] = list.data[i * 2]!;
        list.data[size * 2 + 1] = list.data[i * 2 + 1]!; size++;
      }
      list.size = size;
      if (size === 0) {
        this.index.delete(term);
        if (term.length <= 64)
          for (const key of deletions(term)) {
            const bucket = this.typoDictionary.get(key);
            bucket?.delete(term);
            if (!bucket?.size) this.typoDictionary.delete(key);
          }
        this.docFreq.delete(term);
      } else {
        this.docFreq.set(term, size);
      }
    }

    const number = this.numbers.get(docId);
    if (number !== undefined) { this.ids[number] = ""; this.freeNumbers.push(number); this.numbers.delete(docId); }
    this.docLengths.delete(docId);
    this.docTerms.delete(docId);
    this.totalTokens -= length;
  }

  *postingEntries(term: string): IterableIterator<Posting> {
    const list = this.index.get(term);
    if (!list) return;
    for (let i = 0; i < list.size; i++) yield { docId: this.ids[list.data[i * 2]!]!, termFrequency: list.data[i * 2 + 1]! };
  }
  postings(term: string): PostingList { return [...this.postingEntries(term)]; }

  postingMemory() {
    let packedBytes = 0, postingCount = 0;
    for (const list of this.index.values()) { packedBytes += list.data.byteLength; postingCount += list.size; }
    let tokenBytes = 0, frequencyBytes = 0;
    for (const fields of this.fields.values()) for (const f of fields) { tokenBytes += f.packedBytes ?? 0; frequencyBytes += f.tf.byteLength; for (const w of f.windows) frequencyBytes += w.tf.byteLength; }
    return { packedBytes, tokenBytes, frequencyBytes, postingCount, objectEstimateBytes: postingCount * 48 };
  }

  terms(): string[] {
    return (this.dictionary ??= [...this.index.keys()].sort());
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
  hasDocument(id: string): boolean {
    return this.docLengths.has(id);
  }

  documentCount(): number {
    return this.docLengths.size;
  }

  /** Average document length across the corpus (avgdl in BM25). */
  averageDocumentLength(): number {
    const n = this.docLengths.size;
    return n === 0 ? 0 : this.totalTokens / n;
  }

  snapshot(filePath: string, version: number): void {
    const payload = {
      formatVersion: 4,
      ids: this.ids,
      version,
      index: Object.fromEntries([...this.index].map(([term, list]) => [term, Array.from(list.data.subarray(0, list.size * 2))])),
      docFreq: Object.fromEntries(this.docFreq),
      docLengths: Object.fromEntries(this.docLengths),
      totalTokens: this.totalTokens,
    };
    const checksum = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const tmp = `${filePath}.tmp`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, JSON.stringify({ ...payload, checksum }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  }

  /** Load a snapshot. Returns the storage version it was built at, or null if none. */
  load(filePath: string): number | null {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.trim().length === 0) return null;

    const payload = JSON.parse(raw) as {
      checksum?: string;
      formatVersion?: number;
      version?: number;
      ids?: string[];
      index: Record<string, PostingList | number[]>;
      docFreq: Record<string, number>;
      docLengths: Record<string, number>;
      totalTokens: number;
    };
    if (payload.formatVersion !== 3 && payload.formatVersion !== 4) return null;
    const { checksum, ...body } = payload;
    if (checksum !== createHash("sha256").update(JSON.stringify(body)).digest("hex"))
      throw new Error("index cache checksum mismatch");
    if (!Number.isSafeInteger(payload.version) || !payload.index || !payload.docLengths || !payload.docFreq || !Number.isSafeInteger(payload.totalTokens) || payload.totalTokens < 0)
      throw new Error("invalid index cache");
    const lengths = Object.values(payload.docLengths);
    if (lengths.some(n => !Number.isSafeInteger(n) || n < 0) || lengths.reduce((a,b) => a+b,0) !== payload.totalTokens)
      throw new Error("invalid index lengths");
    const docIds = payload.formatVersion === 4 ? payload.ids : Object.keys(payload.docLengths);
    if (!Array.isArray(docIds) || docIds.some(id => typeof id !== "string")) throw new Error("invalid document ids");
    const numbers = new Map<string, number>();
    docIds.forEach((id, i) => {
      if (!id) return;
      if (numbers.has(id) || !Object.hasOwn(payload.docLengths, id)) throw new Error("invalid document ids");
      numbers.set(id, i);
    });
    if (numbers.size !== lengths.length) throw new Error("invalid document ids");
    const sums = new Map<string, number>();
    const packed = new Map<string, {data:Uint32Array;size:number}>();
    for (const [term, list] of Object.entries(payload.index)) {
      if (!term || !Array.isArray(list) || !list.length) throw new Error("invalid postings");
      const size = payload.formatVersion === 4 ? list.length / 2 : list.length;
      if (!Number.isInteger(size) || payload.docFreq[term] !== size) throw new Error("invalid postings");
      const data = new Uint32Array(size * 2), seen = new Set<string>();
      for (let i = 0; i < size; i++) {
        const p = list[i] as Posting;
        const number = payload.formatVersion === 4 ? (list[i * 2] as number) : numbers.get(p?.docId);
        const frequency = payload.formatVersion === 4 ? list[i * 2 + 1] as number : p?.termFrequency;
        const id = number === undefined ? undefined : docIds[number];
        if (!Number.isSafeInteger(number) || number! < 0 || !id || seen.has(id) || !Number.isSafeInteger(frequency) || frequency <= 0 || frequency > 0xffffffff)
          throw new Error("invalid posting");
        seen.add(id); sums.set(id, (sums.get(id) ?? 0) + frequency);
        data[i * 2] = number!; data[i * 2 + 1] = frequency;
      }
      packed.set(term, {data,size});
    }
    for (const [id, length] of Object.entries(payload.docLengths)) if ((sums.get(id) ?? 0) !== length) throw new Error("invalid posting total");
    if (Object.keys(payload.docFreq).length !== packed.size) throw new Error("invalid frequencies");
    this.clear();
    docIds.forEach((id,i) => { this.ids.push(id); if (id) this.numbers.set(id,i); else this.freeNumbers.push(i); });
    for (const [term, list] of packed) { this.index.set(term,list); this.addTypoTerm(term); }
    for (const [term,n] of Object.entries(payload.docFreq)) this.docFreq.set(term,n);
    for (const [id,len] of Object.entries(payload.docLengths)) this.docLengths.set(id,len);
    this.totalTokens = payload.totalTokens;
    for (const term of this.index.keys()) for (const p of this.postingEntries(term)) {
      const terms = this.docTerms.get(p.docId) ?? [];
      terms.push(term); this.docTerms.set(p.docId,terms);
    }

    return payload.version ?? -1;
  }
}

export interface TokenWindow {
  start: number;
  end: number;
  length: number;
  tf: PackedFrequencies;
}
export interface IndexedField {
  field: string;
  length: number;
  tokens: Array<Omit<TokenInfo, "original">>;
  packedBytes?: number;
  tf: PackedFrequencies;
  windows: TokenWindow[];
}
class PackedFrequencies {
  private readonly data: Uint32Array;
  constructor(ids: number[], private readonly terms: Map<string, number>) {
    const counts = new Map<number, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    this.data = new Uint32Array([...counts].sort((a, b) => a[0] - b[0]).flat());
  }
  get byteLength(): number { return this.data.byteLength; }
  get(term: string): number | undefined {
    const id = this.terms.get(term);
    if (id === undefined) return undefined;
    let lo = 0, hi = this.data.length / 2;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.data[mid * 2]! < id) lo = mid + 1; else hi = mid; }
    return this.data[lo * 2] === id ? this.data[lo * 2 + 1] : undefined;
  }
  has(term: string): boolean { return this.get(term) !== undefined; }
}
function deletions(word: string): Set<string> {
  const keys = new Set([word]);
  for (let i = 0; i < word.length; i++)
    keys.add(word.slice(0, i) + word.slice(i + 1));
  return keys;
}
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
