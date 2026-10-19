import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  dataPaths,
  SNAPSHOT_EVERY_N_WRITES,
  type DataPaths,
  BM25_K1,
  BM25_B,
} from "./config.js";
import { Storage } from "./storage/storage.js";
import { TopHeap } from "./search/heap.js";
import { InvertedIndexStore, type IndexedField } from "./search/index.js";
import { idf } from "./search/rank.js";
import { validateDocumentPolicy, authorized, matchesFilter, validateFilter, FILTER_FIELDS, type ReadScope } from "./search/filters.js";
import { blocks, passage, decodeReference, type EvidenceReference } from "./search/evidence.js";
import {
  tokenize,
  tokenizeDocument,
  tokenizeDetailed,
  documentFields,
  surfaceTokens,
  type TokenInfo,
  CONTENT_LANGUAGES,
  documentLanguage,
} from "./search/tokenizer.js";
import type {
  Document,
  SearchHit,
  TermScore,
  SearchOptions,
  SearchSnippet,
  Facet,
  SearchInspector,
  RebuildStatus,
  MissingExplanation,
} from "./types.js";

export interface SearchResponse {
  query: string;
  terms: string[];
  tookMs: number;
  total: number;
  hits: SearchHit[];
  facets: { source: Facet[]; repo: Facet[]; type: Facet[]; language: Facet[] };
  groups: Array<{ key: string; count: number }>;
  inspector?: SearchInspector;
}
export interface BenchmarkResponse {
  query: string;
  terms: string[];
  indexed: { tookMs: number; scanned: number; hits: number };
  naive: { tookMs: number; scanned: number; hits: number };
  speedup: number;
  topHitsMatch: boolean;
  details?: {
    postingReads: number;
    candidateCount: number;
    documentReads: number;
    cacheHits: number;
    stageMs: Record<string, number>;
  };
}
export class SearchInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "SearchInputError";
  }
}
type Parsed = {
  terms: string[];
  phrases: string[];
  exclude: string[];
  fields: Array<[string, string]>;
};
const META = ["source", "repo", "type", "language"] as const;
type Scored = { id: string; score: number; breakdown: TermScore[] };

export class Engine {
  private readonly storage: Storage;
  private index = new InvertedIndexStore();
  private readonly paths: DataPaths;
  private writesSinceSnapshot = 0;
  private readonly docs = new Map<string, Document>();
  private readonly sourceIds = new Map<string, string>();
  private readonly hashes = new Map<string, string>();
  private readonly docHashes = new Map<string, string>();
  private readonly cache = new Map<string, { doc: Document; bytes: number }>();
  private cacheBytes = 0;
  private storageReads = 0;
  private cacheHits = 0;
  private readonly maxCacheEntries = 128;
  private readonly maxCacheBytes = 8 * 1024 * 1024;
  private progress: RebuildStatus = { state: "idle", processed: 0, total: 0 };
  private rebuildCancelled = false;
  private closed = false;
  private readonly metadata = new Map<string, Map<string, Set<string>>>();
  constructor(dataDir?: string) {
    this.paths = dataPaths(dataDir);
    this.storage = new Storage(dataDir);
    try {
      this.hydrateIndex();
    } catch (error) {
      this.storage.close();
      throw error;
    }
  }
  addDocument(doc: Document): string {
    validateDocumentPolicy(doc);
    doc = structuredClone(doc);
    const id = this.storage.write(doc);
    this.indexDoc(id, doc);
    this.maybeSnapshot();
    return id;
  }
  addDocuments(docs: Document[]): string[] {
    docs.forEach(validateDocumentPolicy);
    docs = structuredClone(docs);
    const ids = this.storage.writeBatch(docs);
    ids.forEach((id, i) => this.indexDoc(id, docs[i]!));
    this.writesSinceSnapshot += ids.length;
    if (this.writesSinceSnapshot >= SNAPSHOT_EVERY_N_WRITES * 20) this.checkpoint();
    return ids;
  }
  getDocument(id: string): Document | null {
    return this.storage.read(id);
  }
  getDocumentRecord(id: string, expectedRevision?: string) {
    const revision = this.docHashes.get(id);
    if (!revision) return null;
    if (expectedRevision !== undefined && revision !== expectedRevision) throw Object.assign(new Error("This document changed after the search. Search again to open its current evidence."), { statusCode: 409 });
    return { id, revision, doc: this.storage.read(id)! };
  }
  retrievalStatus(scope?: ReadScope) {
    return { indexGeneration: this.storage.stateVersion(), documents: [...this.docs.values()].filter(doc => authorized(doc, scope)).length, rebuild: scope ? { state: this.progress.state } : this.rebuildStatus(), strategies: ["lexical", "literal", "substring"], offsetUnit: "utf16", analysisVersion: "blocks-1" };
  }
  retrievalManifest(options: SearchOptions = {}, offset = 0, limit = 100) {
    const ids = [...this.docs].filter(([id, doc]) => this.inScope(id, doc, options)).map(([id]) => id);
    return { indexGeneration: this.storage.stateVersion(), total: ids.length, items: ids.slice(offset, offset + Math.min(limit, 1000)).map(id => ({ id, revision: this.docHashes.get(id)!, doc: this.readDoc(id)! })) };
  }
  retrievalVersions(options: SearchOptions = {}) {
    return { indexGeneration: this.storage.stateVersion(), items: [...this.docs].filter(([id, doc]) => this.inScope(id, doc, options)).map(([id]) => ({ id, revision: this.docHashes.get(id)! })) };
  }
  backupPage(offset: number) {
    const items: Array<{ id: string; doc: Document }> = [];
    let position = 0, bytes = 0;
    for (const id of this.docs.keys()) {
      if (position++ < offset) continue;
      const doc = this.readDoc(id)!;
      const size = Buffer.byteLength(JSON.stringify({ id, doc }));
      if (size > 16 * 1024 * 1024 - 64) throw new SearchInputError("document exceeds streaming backup record budget");
      if (items.length && bytes + size > 1024 * 1024) break;
      items.push({ id, doc }); bytes += size;
      if (items.length >= 100 || bytes >= 1024 * 1024) break;
    }
    return { indexGeneration: this.storage.stateVersion(), items };
  }
  fetchEvidence(input: { reference?: string; documentId?: string; revision?: string; field?: string; start?: number; end?: number }, scope?: ReadScope) {
    const r = input.reference ? decodeReference(input.reference) : input as EvidenceReference;
    if (typeof r.documentId !== "string" || r.documentId.length > 128) throw new SearchInputError("invalid document id");
    const metadata = this.docs.get(r.documentId);
    if (!metadata || !authorized(metadata, scope)) return { state: "not_found" as const, documentId: r.documentId };
    const revision = this.docHashes.get(r.documentId)!;
    if (r.revision !== undefined && r.revision !== revision) return { state: "stale_reference" as const, documentId: r.documentId };
    const doc = this.readDoc(r.documentId)!;
    const fields = documentFields(doc);
    const field = r.field ?? fields.find(f => ["content", "body", "text"].includes(f.field))?.field ?? fields[0]?.field;
    const text = fields.find(f => f.field === field)?.text;
    if (text === undefined) throw new SearchInputError("field is not searchable");
    const start = r.start ?? 0, end = r.end ?? Math.min(text.length, start + 4000);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length || end - start > 65536) throw new SearchInputError("invalid evidence span");
    return { state: "complete" as const, documentId: r.documentId, revision, metadata: Object.fromEntries(["title", "filename", "path", "source", "repo", "type", "language", "modifiedAt"].filter(key => doc[key] !== undefined).map(key => [key, String(doc[key]).slice(0, 2048)])), passage: passage(r.documentId, revision, doc, { field: field!, start, end, text: "", matches: [] }), truncated: end < text.length };
  }
  private inScope(id: string, doc: Document, options: SearchOptions): boolean {
    return (!options.docIds || options.docIds.includes(id)) && META.every(k => options[k] === undefined || String(doc[k]) === options[k]) && (!options.contentLanguage || documentLanguage(doc) === options.contentLanguage) && authorized(doc, options.scope) && matchesFilter(doc, options.filter);
  }
  deleteDocument(id: string): boolean {
    const ok = this.storage.delete(id);
    if (ok) {
      const old = this.docs.get(id);
      if (old) {
        const source = identity(old);
        if (source && this.sourceIds.get(source) === id)
          this.sourceIds.delete(source);
        if (this.hashes.get(this.docHashes.get(id)!) === id)
          this.hashes.delete(this.docHashes.get(id)!);
      }
      this.index.removeDocument(id);
      this.docs.delete(id);
      this.evict(id);
      this.docHashes.delete(id);
      this.removeMetadata(id, old);
      this.maybeSnapshot();
    }
    return ok;
  }
  documentCount(): number {
    return this.docs.size;
  }
  listDocuments(
    offset: number,
    limit: number,
  ): { total: number; items: Array<{ id: string; doc: Document }> } {
    const ids = this.storage.liveDocIds();
    return {
      total: ids.length,
      items: ids
        .slice(offset, offset + limit)
        .map((id) => ({ id, doc: this.storage.read(id) ?? {} })),
    };
  }
  collectBySource(source: string): Array<{ id: string; pageid?: number }> {
    return this.storage.liveDocIds().flatMap((id) => {
      const d = this.docs.get(id);
      return d?.source === source
        ? [{ id, pageid: typeof d.pageid === "number" ? d.pageid : undefined }]
        : [];
    });
  }
  reset(): void {
    const version = this.storage.stateVersion();
    try {
      this.storage.reset();
    } finally {
      // Reset may commit before a directory sync or cleanup fails.
      if (this.storage.stateVersion() !== version) {
        this.index.clear();
        this.docs.clear();
        this.sourceIds.clear();
        this.hashes.clear();
        this.cache.clear();
        this.cacheBytes = 0;
        this.docHashes.clear();
        this.metadata.clear();
        this.writesSinceSnapshot = 0;
        fs.rmSync(this.paths.invertedSnapshot, { force: true });
      }
    }
  }

  search(
    query: string,
    limitOrOptions: number | SearchOptions = 10,
    maybeOptions: SearchOptions = {},
  ): SearchResponse {
    const readsBefore = this.storageReads, hitsBefore = this.cacheHits;
    const began = performance.now();
    const options =
      typeof limitOrOptions === "number"
        ? { ...maybeOptions, limit: limitOrOptions }
        : limitOrOptions;
    try { validateFilter(options.filter); } catch (error) { throw new SearchInputError((error as Error).message); }
    if (options.contentLanguage && !CONTENT_LANGUAGES.includes(options.contentLanguage as typeof CONTENT_LANGUAGES[number])) throw new SearchInputError("unsupported content language");
    const analyzeQuery = (value: string) => tokenizeDetailed(value, "text", options.contentLanguage).map(t => t.term);
    const deadline = began + (options.deadlineMs ?? 30_000);
    let work = 0;
    const checkWork = () => {
      if (++work > (options.maxWork ?? 5_000_000) || performance.now() > deadline) throw Object.assign(new Error("search work budget exceeded; narrow the query or scope"), { statusCode: 422, code: "scope_limit" });
    };
    if (options.match !== undefined && !["text", "literal", "substring"].includes(options.match)) throw new SearchInputError("invalid match mode");
    const limit = Math.max(0, Math.min(1000, Math.floor(options.limit ?? 10)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    if (
      !Number.isSafeInteger(offset) ||
      offset > 100000 ||
      !Number.isFinite(limit)
    )
      throw new SearchInputError("invalid pagination");
    if (options.match && options.match !== "text") return this.searchLiteral(query, options);

    const stageMs: Record<string, number> = {};
    let stage = began;
    const finish = (name: string) => {
      const now = performance.now();
      stageMs[name] = now - stage;
      stage = now;
    };
    const parsed = parseQuery(query);
    const terms = unique(
      parsed.terms.flatMap(analyzeQuery).concat(parsed.phrases.flatMap(analyzeQuery)),
    );
    if (
      !terms.length &&
      !parsed.phrases.some((p) => surfaceTokens(p).length) &&
      !parsed.fields.length &&
      !META.some((k) => options[k] !== undefined) &&
      !options.docIds && !options.filter && !options.scope
    )
      throw new SearchInputError(
        "query must contain a searchable term, phrase, filter, or document id",
      );
    finish("parse");
    const expansions: Record<string, string[]> = {};
    for (const term of terms) {
      const values = new Set([term]);
      for (const synonym of (options.synonyms?.[term] ?? []).slice(0, 20))
        for (const value of analyzeQuery(synonym.slice(0, 256)))
          if (values.size < 20) values.add(value);
      if (options.prefix)
        for (const value of this.index.prefix(term))
          if (values.size < 20) values.add(value);
      if (options.typos)
        for (const value of this.index.typos(term))
          if (values.size < 20) values.add(value);
      expansions[term] = [...values];
    }
    finish("expand");
    // Intersect indexed metadata scopes before walking postings or scoring documents.
    const scopes: Set<string>[] = [];
    for (const [key, value] of [
      ...parsed.fields,
      ...META.flatMap((k) =>
        options[k] === undefined ? [] : [[k, options[k]!] as [string, string]],
      ),
    ])
      scopes.push(this.metadata.get(key)?.get(value) ?? new Set());
    if (options.docIds) scopes.push(new Set(options.docIds));
    if (options.filter || options.scope || options.contentLanguage) scopes.push(new Set([...this.docs].filter(([, doc]) => authorized(doc, options.scope) && matchesFilter(doc, options.filter) && (!options.contentLanguage || documentLanguage(doc) === options.contentLanguage)).map(([id]) => id)));
    scopes.sort((a, b) => a.size - b.size);
    let scope: Set<string> | undefined;
    if (scopes.length)
      scope = new Set(
        [...scopes[0]!].filter((id) => scopes.every((s) => s.has(id))),
      );
    finish("candidates");
    const tfById = new Map<string, Map<string, number>>();
    let postingReads = 0;
    for (const value of new Set(Object.values(expansions).flat())) {
      for (const posting of this.index.postingEntries(value)) {
        checkWork();
        postingReads++;
        if (scope && !scope.has(posting.docId)) continue;
        const tf = tfById.get(posting.docId) ?? new Map<string, number>();
        tf.set(value, posting.termFrequency);
        tfById.set(posting.docId, tf);
      }
    }
    if (!terms.length)
      for (const id of scope ?? this.docs.keys())
        if (this.docs.has(id)) tfById.set(id, new Map());
    finish("postings");
    const excluded = new Set<string>();
    for (const term of parsed.exclude)
      for (const p of this.index.postingEntries(term)) {
        postingReads++;
        excluded.add(p.docId);
      }
    const candidates = new Map<string, Map<string, number>>();
    for (const [id, tf] of tfById) {
      if (
        excluded.has(id) ||
        parsed.phrases.some((p) => !hasPhrase(this.surfaceInfo(id), p))
      )
        continue;
      if (
        (options.mode ?? "any") === "all" &&
        terms.some((t) => !expansions[t]!.some((e) => tf.has(e)))
      )
        continue;
      candidates.set(id, tf);
    }
    finish("filter");
    const compare = (a: Scored, b: Scored) =>
      b.score - a.score || a.id.localeCompare(b.id);
    const heaps = new Map<string, TopHeap<Scored>>();
    const allIds: string[] = [];
    const groupBy = options.groupBy ?? "none";
    const weights = new Map<string, number>();
    for (const term of terms)
      for (const expanded of expansions[term]!)
        weights.set(
          expanded,
          Math.max(weights.get(expanded) ?? 0, expanded === term ? 1 : 0.65),
        );
    const idfs = new Map(
      [...weights.keys()].map((t) => [
        t,
        idf(this.docs.size, this.index.documentFrequency(t)),
      ]),
    );
    const scoreCandidate = (id: string, tf: Map<string, number>, explain = false): Scored => {
      const contributions = new Map<string, number>();
      const frequencies = explain ? new Map<string, number>() : undefined;
      const add = (term: string, frequency: number, contribution: number) => {
        contributions.set(term, (contributions.get(term) ?? 0) + contribution);
        if (frequencies) frequencies.set(term, (frequencies.get(term) ?? 0) + frequency);
      };
      if (options.profile === "baseline") {
        for (const [term, frequency] of tf)
          add(term, frequency, bm25(frequency, this.index.documentLength(id), this.index.averageDocumentLength()) * idfs.get(term)!);
      } else {
        for (const field of this.index.indexedFields(id)) {
          let best: typeof field.windows[number] | undefined, bestScore = -1;
          const contribution = (term: string, frequency: number, length: number) => weights.get(term)! * fieldWeight(field.field) * idfs.get(term)! * bm25(frequency, length, this.index.averageFieldLength(field.field));
          for (const window of field.windows) {
            checkWork();
            let score = 0;
            for (const term of weights.keys()) {
              const frequency = window.tf.get(term);
              if (frequency) score += contribution(term, frequency, window.length);
            }
            if (score > bestScore) { bestScore = score; best = window; }
          }
          if (best) for (const term of weights.keys()) {
            const frequency = best.tf.get(term);
            if (frequency) add(term, frequency, contribution(term, frequency, best.length));
          }
        }
      }
      const ordered = [...contributions].sort((a, b) => b[1] - a[1]);
      return { id, score: ordered.reduce((sum, [, value]) => sum + value, 0), breakdown: frequencies ? ordered.map(([term, contribution]) => ({ term, termFrequency: frequencies.get(term)!, idf: idfs.get(term)!, contribution })) : [] };
    };
    for (const [id, tf] of candidates) {
      checkWork();
      const row = scoreCandidate(id, tf);
      const key =
        groupBy === "none" ? "" : String(this.docs.get(id)?.[groupBy] ?? "");
      let heap = heaps.get(key);
      if (!heap) {
        heap = new TopHeap(offset + limit, compare);
        heaps.set(key, heap);
      }
      heap.offer(row);
      allIds.push(id);
    }
    let selected: Scored[];
    if (groupBy === "none") selected = heaps.get("")?.sorted() ?? [];
    else {
      const buckets = [...heaps].map(([key, heap]) => ({
        key,
        rows: heap.sorted(),
      }));
      buckets.sort((a, b) =>
        compare(
          a.rows[0] ?? { id: a.key, score: 0, breakdown: [] },
          b.rows[0] ?? { id: b.key, score: 0, breakdown: [] },
        ),
      );
      selected = [];
      for (let round = 0; selected.length < offset + limit; round++) {
        let moved = false;
        for (const bucket of buckets)
          if (bucket.rows[round]) {
            selected.push(bucket.rows[round]!);
            moved = true;
            if (selected.length === offset + limit) break;
          }
        if (!moved) break;
      }
    }
    const paged = selected.slice(offset, offset + limit);
    const resultFacets = options.facets === false ? { source: [], repo: [], type: [], language: [] } : facets(allIds, this.docs),
      groups = groupCounts(allIds, this.docs, groupBy);
    finish("score");
    const hits = paged.map((row) => {
      if (options.projection !== "evidence" || options.inspect) row.breakdown = scoreCandidate(row.id, candidates.get(row.id)!, true).breakdown;
      const doc = structuredClone(this.readDoc(row.id)!);
      let passages = makePassages(
        doc,
        this.index.indexedFields(row.id),
        weights,
        idfs,
        this.index,
      );
      if (!passages.length && parsed.phrases.length)
        passages = phrasePassages(
          doc,
          this.surfaceInfo(row.id),
          parsed.phrases,
        );
      if (options.projection === "evidence") {
        if (!passages.length) passages = blocks(doc).slice(0, 3).map(b => ({ ...b, text: "", matches: [] }));
        passages = passages.map(p => passage(row.id, this.docHashes.get(row.id)!, doc, p));
      }
      passages = passages.map(p => ({ ...p, revision: this.docHashes.get(row.id) }));
      return {
        docId: row.id,
        revision: this.docHashes.get(row.id),
        score: row.score,
        doc: options.projection === "evidence" ? Object.fromEntries(["title", "filename", "path", "source", "repo", "type", "language", "modifiedAt", "contentLanguage"].filter(key => doc[key] !== undefined).map(key => [key, doc[key]])) : doc,
        breakdown: options.projection === "evidence" && !options.inspect ? [] : row.breakdown,
        snippet: passages[0],
        passages,
        ...(groupBy === "none" ? {} : { groupKey: String(doc[groupBy] ?? "") }),
      };
    });
    finish("read");
    const tookMs = performance.now() - began;
    stageMs.total = tookMs;
    const response: SearchResponse = {
      query,
      terms,
      tookMs,
      total: allIds.length,
      hits,
      facets: resultFacets,
      groups,
    };
    if (options.inspect)
      response.inspector = {
        parsedQuery: [...parsed.terms, ...parsed.phrases],
        expansions,
        candidateCount: tfById.size,
        postingReads,
        documentReads: this.storageReads - readsBefore,
        cacheHits: this.cacheHits - hitsBefore,
        documentSource: this.storageReads === readsBefore ? "memory" : this.cacheHits === hitsBefore ? "storage" : "mixed",
        stageMs,
        stages: Object.entries(stageMs).map(([name, tookMs]) => ({
          name,
          tookMs,
        })),
        scoreBreakdown: Object.fromEntries(
          paged.map((r) => [r.id, r.breakdown]),
        ),
      };
    return response;
  }

  rebuildStatus(): RebuildStatus { return { ...this.progress }; }
  cancelRebuild(): boolean {
    if (this.progress.state !== "running") return false;
    this.rebuildCancelled = true;
    return true;
  }
  async rebuildIndex(options: { signal?: AbortSignal; batchSize?: number } = {}): Promise<RebuildStatus> {
    if (this.closed) throw new Error("engine is closed");
    if (this.progress.state === "running") throw new SearchInputError("rebuild already running");
    const batchSize = options.batchSize ?? 32;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new SearchInputError("batchSize must be 1..256");
    const version = this.storage.stateVersion(), ids = this.storage.liveDocIds();
    const shadow = new InvertedIndexStore();
    this.rebuildCancelled = false;
    this.progress = { state: "running", processed: 0, total: ids.length, startedAt: new Date().toISOString() };
    const interrupted = () => {
      if (this.rebuildCancelled || options.signal?.aborted || this.closed) return "cancelled" as const;
      if (version !== this.storage.stateVersion()) return "stale" as const;
      return undefined;
    };
    try {
      // Yield before reading so even an empty rebuild can be cancelled.
      await new Promise<void>(resolve => setImmediate(resolve));
      for (let i = 0; i < ids.length; i++) {
        const state = interrupted();
        if (state) { this.progress.state = state; break; }
        const doc = this.storage.read(ids[i]!);
        if (!doc) throw new Error("document disappeared during rebuild");
        const fields = documentFields(doc).map(f => ({ ...f, tokens: tokenizeDetailed(f.text, f.field, documentLanguage(doc)) }));
        shadow.addDocument(ids[i]!, fields.flatMap(f => f.tokens.map(t => t.term)));
        shadow.setFields(ids[i]!, fields);
        this.progress.processed++;
        if ((i + 1) % batchSize === 0) await new Promise<void>(resolve => setImmediate(resolve));
      }
      if (this.progress.state === "running") {
        const state = interrupted();
        if (state) this.progress.state = state;
        else { this.index = shadow; this.progress.state = "completed"; }
      }
    } catch (error) {
      this.progress.state = "failed";
      this.progress.error = error instanceof Error ? error.message : String(error);
    }
    this.progress.finishedAt = new Date().toISOString();
    return this.rebuildStatus();
  }

  private searchLiteral(query: string, options: SearchOptions): SearchResponse {
    const began = performance.now(), before = this.storageReads, hitsBefore = this.cacheHits;
    if (typeof query !== "string" || query.length < (options.match === "substring" ? 2 : 1) || query.length > 256)
      throw new SearchInputError("literal query must be 1..256 characters; substring requires at least 2");
    const ids = [...this.docs.keys()].filter(id => this.inScope(id, this.docs.get(id)!, options));
    if (ids.length > 2000) throw new SearchInputError("literal scan exceeds 2000 documents; narrow filters or document ids");
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.match === "substring" ? "giu" : "gu");
    const snippets = new Map<string, SearchSnippet[]>();
    let scanned = 0;
    for (const id of ids) {
      const doc = this.readDoc(id)!;
      const passages: SearchSnippet[] = [];
      for (const { field, text } of documentFields(doc)) {
        scanned += text.length;
        if (scanned > 8 * 1024 * 1024) throw new SearchInputError("literal scan exceeds 8 Mi UTF-16 units; narrow scope");
        pattern.lastIndex = 0;
        for (let found = pattern.exec(text); found && passages.length < 3; found = pattern.exec(text)) {
          const at = found.index, endAt = at + found[0].length;
          const start = Math.max(0, at - 80), end = Math.min(text.length, endAt + 100);
          const pages = field === "content" && Array.isArray(doc.pageOffsets) ? doc.pageOffsets as Array<{page:number;start:number;end:number}> : [];
          const page = pages.find(p => at >= p.start && at < p.end)?.page;
          passages.push({ field, text: text.slice(start, end), start, end, matches: [{start:at,end:endAt}], line: text.slice(0, at).split("\n").length, ...(page === undefined ? {} : {page}) });
        }
      }
      if (passages.length) snippets.set(id, passages);
    }
    const result = this.search("", { ...options, match: "text", docIds: [...snippets.keys()] });
    result.query = query; result.terms = [query]; result.tookMs = performance.now() - began;
    for (const hit of result.hits) { hit.passages = snippets.get(hit.docId)?.map(p => ({ ...p, revision: hit.revision })); hit.snippet = hit.passages?.[0]; }
    if (result.inspector) {
      result.inspector.parsedQuery = [query]; result.inspector.expansions = { [query]: [query] };
      result.inspector.documentReads = this.storageReads - before;
      result.inspector.cacheHits = this.cacheHits - hitsBefore;
      result.inspector.documentSource = this.storageReads === before ? "memory" : this.cacheHits === hitsBefore ? "storage" : "mixed";
      result.inspector.stageMs.literalScan = result.tookMs - result.inspector.stageMs.total!;
      result.inspector.stageMs.total = result.tookMs;
    }
    return result;
  }

  explainMissing(query: string, docId: string, options: SearchOptions = {}): MissingExplanation {
    const reasons: MissingExplanation["reasons"] = [];
    const base: MissingExplanation = { query, docId, matched: false, returned: false, reasons, total: 0, expansions: {} };
    if (!this.docs.has(docId)) { reasons.push({code:"missing_document",detail:"Document does not exist"}); return base; }
    const literal = options.match && options.match !== "text";
    const parsed = literal ? {terms:[],phrases:[],exclude:[],fields:[]} : parseQuery(query);
    const terms = unique(parsed.terms.flatMap(tokenize).concat(parsed.phrases.flatMap(tokenize)));
    if (!literal && !terms.length && !parsed.phrases.length && !parsed.fields.length && !META.some(k => options[k] !== undefined) && !options.docIds) {
      const words = parsed.terms.flatMap(t => surfaceTokens(t));
      reasons.push(words.length ? {code:"stopwords",detail:"Query contains no indexed terms after stopword removal"} : {code:"no_terms",detail:"Query contains no positive searchable terms; use literal mode for symbols"}); return base;
    }
    const result = this.search(query, { ...options, inspect:true });
    base.total = result.total; base.expansions = result.inspector!.expansions;
    const doc = this.docs.get(docId)!;
    for (const [key, value] of [...parsed.fields, ...META.flatMap(k => options[k] === undefined ? [] : [[k, options[k]!] as [string,string]])])
      if (String(doc[key]) !== value) reasons.push({code:"filter",detail:`${key} does not match ${value}`});
    if (options.docIds && !options.docIds.includes(docId)) reasons.push({code:"filter",detail:"Document is outside the selected document ids"});
    if (!literal) {
      const tf = this.index.indexedFields(docId);
      const missing = terms.filter(t => !(base.expansions[t] ?? [t]).some(e => tf.some(f => f.tf.has(e))));
      if ((options.mode ?? "any") === "all" || missing.length === terms.length)
        for (const term of missing) reasons.push({code:(base.expansions[term]?.length ?? 0) > 1 ? "expansion" : "term",detail:`No match for ${term} or its enabled expansions`});
      for (const phrase of parsed.phrases) if (!hasPhrase(this.surfaceInfo(docId),phrase)) reasons.push({code:"phrase",detail:`Exact phrase missing: ${phrase}`});
      for (const term of parsed.exclude) if (tf.some(f => f.tf.has(term))) reasons.push({code:"exclusion",detail:`Matches excluded term ${term}`});
    }
    const scoped = this.search(query, {...options, docIds: options.docIds && !options.docIds.includes(docId) ? [] : [docId],offset:0,limit:1});
    base.matched = scoped.total > 0;
    if (!base.matched) { if (literal && !reasons.length) reasons.push({code:"literal",detail:"Original text does not contain the requested literal"}); return base; }
    const returnedAt = result.hits.findIndex(h => h.docId === docId);
    base.returned = returnedAt >= 0;
    if (base.returned) base.rank = (options.offset ?? 0) + returnedAt + 1;
    else {
      // shortcut: inspect only the first 1000 ranks, expand with a shared score-only ranking pass if needed.
      const page = this.search(query, {...options, offset:0, limit:1000});
      const position = page.hits.findIndex(h => h.docId === docId);
      if (position >= 0) {
        base.rank = position + 1;
        reasons.push({code:base.rank <= (options.offset ?? 0) ? "page" : "rank",detail:`Rank ${base.rank} is outside the requested page`});
      } else reasons.push({code:"rank_unknown",detail:"Matches but is outside the requested page. Rank is unknown beyond the first 1000 results inspected"});
    }
    return base;
  }

  naiveSearch(query: string, limit = 10): SearchResponse {
    const terms = unique(tokenize(query));
    const start = performance.now();
    const scored: Scored[] = [];
    for (const id of this.docs.keys()) {
      const doc = this.readDoc(id)!;
      const all = tokenizeDocument(doc);
      const tf = new Map<string, number>();
      for (const t of all)
        if (terms.includes(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
      if (!tf.size) continue;
      const len = Math.max(all.length, 1);
      let score = 0;
      const breakdown: TermScore[] = [];
      for (const [term, f] of tf) {
        const termIdf = idf(this.docs.size, this.index.documentFrequency(term));
        const c =
          (termIdf * f * (BM25_K1 + 1)) /
          (f +
            BM25_K1 *
              (1 -
                BM25_B +
                (BM25_B * len) /
                  Math.max(this.index.averageDocumentLength(), 1)));
        score += c;
        breakdown.push({
          term,
          termFrequency: f,
          idf: termIdf,
          contribution: c,
        });
      }
      scored.push({ id, score, breakdown });
    }
    scored.sort((a, b) => b.score - a.score);
    return {
      query,
      terms,
      tookMs: performance.now() - start,
      total: scored.length,
      hits: scored.slice(0, limit).map((r) => ({
        docId: r.id,
        score: r.score,
        doc: structuredClone(this.readDoc(r.id)!),
        breakdown: r.breakdown,
      })),
      facets: { source: [], repo: [], type: [], language: [] },
      groups: [],
    };
  }
  benchmark(query: string, limit = 10): BenchmarkResponse {
    const indexed = this.search(query, { limit, profile: "baseline", inspect: true }),
      naive = this.naiveSearch(query, limit);
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
      topHitsMatch: indexed.hits[0]?.docId === naive.hits[0]?.docId,
      details: indexed.inspector && {
        postingReads: indexed.inspector.postingReads,
        candidateCount: indexed.inspector.candidateCount,
        documentReads: indexed.inspector.documentReads,
        cacheHits: indexed.inspector.cacheHits ?? 0,
        stageMs: indexed.inspector.stageMs,
      },
    };
  }
  suggest(prefix: string, limit = 10): string[] {
    return this.index.prefix(
      prefix.normalize("NFC").toLowerCase(),
      Math.max(0, Math.min(50, limit)),
    );
  }
  diagnostics(term?: string): unknown {
    const selected = (
      term ? [term.toLocaleLowerCase()] : this.index.terms()
    ).slice(0, 50);
    return {
      documentCache: { byteSource: "estimated UTF-16 serialized document size; excludes object overhead", entries: this.cache.size, bytes: this.cacheBytes, maxEntries: this.maxCacheEntries, maxBytes: this.maxCacheBytes },
      postingMemory: this.index.postingMemory(),
      rebuild: this.rebuildStatus(),
      documents: this.index.documentCount(),
      vocabularySize: this.index.terms().length,
      postingCount: this.index
        .terms()
        .reduce((n, t) => n + this.index.documentFrequency(t), 0),
      indexBytes: fs.existsSync(this.paths.invertedSnapshot)
        ? fs.statSync(this.paths.invertedSnapshot).size
        : undefined,
      memoryBytes: process.memoryUsage().heapUsed,
      memorySource: "process.heapUsed",
      storage: this.storage.diagnostics(),
      terms: selected.map((t) => ({
        term: t,
        documentFrequency: this.index.documentFrequency(t),
        postings: this.index.postings(t).slice(0, 20),
      })),
    };
  }
  compare(
    query: string,
    options: SearchOptions = {},
  ): { baseline: SearchResponse; tuned: SearchResponse } {
    return {
      baseline: this.search(query, { ...options, profile: "baseline" }),
      tuned: this.search(query, { ...options, profile: "tuned" }),
    };
  }
  ingestDocuments(docs: Document[]): {
    ids: string[];
    added: number;
    updated: number;
    duplicates: number;
  } {
    docs.forEach(validateDocumentPolicy);
    const ids: string[] = [];
    let added = 0,
      updated = 0,
      duplicates = 0;
    let pending: Document[] = [];
    const pendingKeys = new Set<string>();
    const flush = () => {
      if (!pending.length) return;
      ids.push(...this.addDocuments(pending));
      added += pending.length;
      pending = [];
      pendingKeys.clear();
    };
    for (const doc of docs) {
      const source = identity(doc),
        hash = hashDoc(doc),
        key = source ?? hash;
      // Flush before a repeated identity so the next input sees the preceding durable version.
      if (pendingKeys.has(key)) flush();
      const existing = source
        ? this.sourceIds.get(source)
        : this.hashes.get(hash);
      if (!existing) {
        pending.push(doc);
        pendingKeys.add(key);
        if (pending.length === 500) flush();
        continue;
      }
      flush();
      if (this.docHashes.get(existing) === hash) {
        ids.push(existing);
        duplicates++;
      } else {
        const copy = structuredClone(doc);
        this.storage.writeWithId(existing, copy);
        this.indexDoc(existing, copy);
        this.maybeSnapshot();
        ids.push(existing);
        updated++;
      }
    }
    flush();
    return { ids, added, updated, duplicates };
  }
  exportBackup(): {
    version: 1;
    documents: Array<{ id: string; doc: Document }>;
  } {
    return {
      version: 1,
      documents: [...this.docs.keys()].map((id) => ({
        id,
        doc: structuredClone(this.readDoc(id)!),
      })),
    };
  }
  restoreBackup(input: unknown): {
    added: number;
    updated: number;
    duplicates: number;
  } {
    let items: Array<{ id: string; doc: Document }>;
    try {
      items = validateBackup(input);
    } catch (e) {
      throw new SearchInputError(
        e instanceof Error ? e.message : "invalid backup",
      );
    }
    const byId = new Map<string, Document>();
    for (const x of items) {
      if (byId.has(x.id)) throw new SearchInputError("duplicate backup id");
      validateDocumentPolicy(x.doc);
      byId.set(x.id, x.doc);
    }
    for (const [id, doc] of byId)
      if (this.docs.has(id) && this.docHashes.get(id) !== hashDoc(doc))
        throw new SearchInputError(`backup conflicts with existing id ${id}`);
    let added = 0,
      duplicates = 0;
    for (const [id, doc] of byId) {
      if (this.docs.has(id)) {
        duplicates++;
        continue;
      }
      const copy = structuredClone(doc);
      this.storage.writeWithId(id, copy);
      this.indexDoc(id, copy);
      added++;
    }
    return { added, updated: 0, duplicates };
  }
  async compact(): Promise<{ reclaimedBytes: number; removedDocuments: number }> {
    const result = await this.storage.compactAsync();
    this.snapshot();
    return result;
  }
  snapshot(): void {
    this.storage.snapshot();
    this.index.snapshot(
      this.paths.invertedSnapshot,
      this.storage.stateVersion(),
    );
    this.writesSinceSnapshot = 0;
  }
  close(): void {
    this.closed = true;
    this.cancelRebuild();
    try {
      this.snapshot();
    } finally {
      this.storage.close();
    }
  }
  private checkpoint(): void {
    // WAL remains durable; only the rebuildable full-text cache waits for an explicit snapshot.
    this.storage.snapshot();
    this.writesSinceSnapshot = 0;
  }
  private evict(id: string): void {
    const value = this.cache.get(id);
    if (value) this.cacheBytes -= value.bytes;
    this.cache.delete(id);
  }
  private putCache(id: string, doc: Document): void {
    this.evict(id);
    const bytes = Buffer.byteLength(JSON.stringify(doc)) * 2;
    if (bytes > this.maxCacheBytes) return;
    this.cache.set(id, { doc, bytes }); this.cacheBytes += bytes;
    while (this.cache.size > this.maxCacheEntries || this.cacheBytes > this.maxCacheBytes) this.evict(this.cache.keys().next().value!);
  }
  private readDoc(id: string): Document | null {
    const cached = this.cache.get(id);
    if (cached) { this.cacheHits++; this.cache.delete(id); this.cache.set(id, cached); return cached.doc; }
    this.storageReads++;
    const doc = this.storage.read(id);
    if (doc) this.putCache(id, doc);
    return doc;
  }
  private surfaceInfo(id: string): TokenInfo[] {
    return documentFields(this.readDoc(id)).flatMap(f => surfaceTokens(f.text, f.field));
  }
  private maybeSnapshot(): void {
    if (++this.writesSinceSnapshot >= SNAPSHOT_EVERY_N_WRITES * 20) this.checkpoint();
  }
  private removeMetadata(id: string, doc?: Document): void {
    if (!doc) return;
    for (const key of META) {
      const values = this.metadata.get(key),
        value = String(doc[key]);
      const ids = values?.get(value);
      ids?.delete(id);
      if (!ids?.size) values?.delete(value);
    }
  }
  private indexDoc(id: string, doc: Document, cached = false): void {
    const old = this.docs.get(id);
    if (old) {
      const source = identity(old);
      if (source && this.sourceIds.get(source) === id)
        this.sourceIds.delete(source);
      if (this.hashes.get(this.docHashes.get(id)!) === id)
        this.hashes.delete(this.docHashes.get(id)!);
      this.removeMetadata(id, old);
    }
    const fields = documentFields(doc).map((f) => ({
      ...f,
      tokens: tokenizeDetailed(f.text, f.field, documentLanguage(doc)),
    }));
    const info = fields.flatMap((f) => f.tokens);
    if (!cached)
      this.index.addDocument(
        id,
        info.map((x) => x.term),
      );
    this.index.setFields(id, fields);
    this.docs.set(id, Object.fromEntries([...new Set([...META, ...FILTER_FIELDS, "_access", "sourceId", "pageid", "fullName"])].filter(k => doc[k] !== undefined).map(k => [k, doc[k]])));
    this.putCache(id, doc);
    this.docHashes.set(id, hashDoc(doc));
    for (const key of META)
      if (doc[key] !== undefined) {
        const values = this.metadata.get(key) ?? new Map<string, Set<string>>();
        const value = String(doc[key]),
          ids = values.get(value) ?? new Set<string>();
        ids.add(id);
        values.set(value, ids);
        this.metadata.set(key, values);
      }
    const source = identity(doc);
    if (source) this.sourceIds.set(source, id);
    this.hashes.set(hashDoc(doc), id);
  }
  private hydrateIndex(): void {
    let loaded = false;
    const ids = this.storage.liveDocIds();
    try {
      loaded =
        this.index.load(this.paths.invertedSnapshot, true) ===
          this.storage.stateVersion() &&
        this.index.documentCount() === ids.length &&
        ids.every((id) => this.index.hasDocument(id));
    } catch {
      /* Corrupt caches never block recovery. */
    }
    if (!loaded) this.index.clear();
    for (const id of ids) {
      const doc = this.storage.read(id);
      if (doc) this.indexDoc(id, doc, loaded);
    }
  }
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
export function parseQuery(query: string): Parsed {
  if (typeof query !== "string" || query.length > 4096)
    throw new SearchInputError("query must be at most 4096 characters");
  if ((query.match(/"/g) ?? []).length % 2)
    throw new SearchInputError("unterminated quoted phrase");
  const phrases: string[] = [];
  const quotedFields: Array<[string, string]> = [];
  const scoped = query.replace(/\b(source|repo|type|language):"([^\"]+)"/g, (_, field: string, value: string) => { quotedFields.push([field, value]); return " "; });
  const without = scoped.replace(/"([^\"]+)"/g, (_, p: string) => {
    phrases.push(p);
    return " ";
  });
  const words = without.split(/\s+/).filter(Boolean);
  const fields = quotedFields.concat(words.flatMap((x) => {
    const m = /^(source|repo|type|language):(.+)$/.exec(x);
    return m ? [[m[1]!, m[2]!] as [string, string]] : [];
  }));
  return {
    terms: words.filter(
      (x) => !x.startsWith("-") && !/^(source|repo|type|language):/.test(x),
    ),
    phrases,
    exclude: words
      .filter((x) => x.startsWith("-"))
      .flatMap((x) => tokenize(x.slice(1))),
    fields,
  };
}
function bm25(tf: number, length: number, average: number): number {
  return (
    (tf * (BM25_K1 + 1)) /
    (tf + BM25_K1 * (1 - BM25_B + (BM25_B * length) / Math.max(average, 1)))
  );
}
function fieldWeight(field: string): number {
  return field === "title"
    ? 3
    : field === "path"
      ? 2
      : field === "repo"
        ? 1.5
        : 1;
}
function hasPhrase(info: TokenInfo[], phrase: string): boolean {
  const q = surfaceTokens(phrase);
  if (!q.length) return false;
  for (let i = 0; i < info.length; i++) {
    const first = info[i]!;
    if (
      q.every(
        (t, j) =>
          info[i + j]?.field === first.field &&
          info[i + j]?.term === t.term &&
          info[i + j]?.position === first.position + j,
      )
    )
      return true;
  }
  return false;
}
function makePassages(
  doc: Document,
  fields: IndexedField[],
  weights: Map<string, number>,
  idfs: Map<string, number>,
  index: InvertedIndexStore,
): SearchSnippet[] {
  const texts = new Map(documentFields(doc).map((f) => [f.field, f.text]));
  const heap = new TopHeap<{
    field: IndexedField;
    start: number;
    end: number;
    score: number;
  }>(
    12,
    (a, b) =>
      b.score - a.score ||
      a.field.field.localeCompare(b.field.field) ||
      a.start - b.start,
  );
  for (const field of fields)
    for (const window of field.windows) {
      let score = 0;
      for (const [term, weight] of weights)
        if (window.tf.has(term))
          score +=
            weight *
            fieldWeight(field.field) *
            idfs.get(term)! *
            bm25(
              window.tf.get(term)!,
              window.length,
              index.averageFieldLength(field.field),
            );
      if (score)
        heap.offer({ field, start: window.start, end: window.end, score });
    }
  const out: SearchSnippet[] = [];
  for (const row of heap.sorted()) {
    if (
      out.some(
        (s) =>
          s.field === row.field.field && s.start < row.end && row.start < s.end,
      )
    )
      continue;
    const text = texts.get(row.field.field)!;
    const matching = row.field.tokens.filter(
      (t) => weights.has(t.term) && t.start >= row.start && t.end <= row.end,
    );
    const anchor = matching[0]!;
    const start = Math.max(row.start, anchor.start - 100),
      end = Math.min(row.end, start + 360);
    const matches = [
      ...new Map(
        matching
          .filter((t) => t.end <= end)
          .map((t) => [`${t.start}:${t.end}`, { start: t.start, end: t.end }]),
      ).values(),
    ];
    const pages =
      row.field.field === "content" && Array.isArray(doc.pageOffsets)
        ? (doc.pageOffsets as Array<{
            page: number;
            start: number;
            end: number;
          }>)
        : [];
    const page = pages.find(
      (p) => anchor.start >= p.start && anchor.start < p.end,
    )?.page;
    out.push({
      text: text.slice(start, end),
      field: row.field.field,
      start,
      end,
      matches,
      line: text.slice(0, anchor.start).split("\n").length,
      ...(page === undefined ? {} : { page }),
    });
    if (out.length === 3) break;
  }
  return out;
}
function phrasePassages(
  doc: Document,
  surfaces: TokenInfo[],
  phrases: string[],
): SearchSnippet[] {
  const texts = new Map(documentFields(doc).map((f) => [f.field, f.text]));
  const out: SearchSnippet[] = [];
  for (const phrase of phrases) {
    const words = surfaceTokens(phrase);
    if (!words.length) continue;
    const at = surfaces.findIndex((first, i) =>
      words.every(
        (word, j) =>
          surfaces[i + j]?.field === first.field &&
          surfaces[i + j]?.term === word.term &&
          surfaces[i + j]?.position === first.position + j,
      ),
    );
    if (at < 0) continue;
    const tokens = surfaces.slice(at, at + words.length),
      first = tokens[0]!,
      last = tokens[tokens.length - 1]!;
    const text = texts.get(first.field)!,
      start = Math.max(0, first.start - 80),
      end = Math.min(text.length, last.end + 100);
    if (
      out.some((s) => s.field === first.field && s.start < end && start < s.end)
    )
      continue;
    const pages =
      first.field === "content" && Array.isArray(doc.pageOffsets)
        ? (doc.pageOffsets as Array<{
            page: number;
            start: number;
            end: number;
          }>)
        : [];
    const page = pages.find(
      (p) => first.start >= p.start && first.start < p.end,
    )?.page;
    out.push({
      text: text.slice(start, end),
      field: first.field,
      start,
      end,
      matches: tokens.map((t) => ({ start: t.start, end: t.end })),
      line: text.slice(0, first.start).split("\n").length,
      ...(page === undefined ? {} : { page }),
    });
    if (out.length === 3) break;
  }
  return out;
}
function facetValues(
  ids: string[],
  docs: Map<string, Document>,
  key: string,
): Facet[] {
  const c = new Map<string, number>();
  for (const id of ids) {
    const v = docs.get(id)?.[key];
    if (v !== undefined) c.set(String(v), (c.get(String(v)) ?? 0) + 1);
  }
  return [...c]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
function facets(
  ids: string[],
  docs: Map<string, Document>,
): SearchResponse["facets"] {
  return {
    source: facetValues(ids, docs, "source"),
    repo: facetValues(ids, docs, "repo"),
    type: facetValues(ids, docs, "type"),
    language: facetValues(ids, docs, "language"),
  };
}
function groupCounts(
  ids: string[],
  docs: Map<string, Document>,
  by = "none",
): Array<{ key: string; count: number }> {
  if (by === "none") return [];
  const c = new Map<string, number>();
  for (const id of ids) {
    const k = String(docs.get(id)?.[by] ?? "");
    if (k) c.set(k, (c.get(k) ?? 0) + 1);
  }
  return [...c]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
function identity(doc: Document): string | undefined {
  if (typeof doc.sourceId === "string") return doc.sourceId;
  if (typeof doc.pageid === "number" && doc.source === "wikipedia")
    return `wikipedia:${doc.pageid}`;
  if (
    typeof doc.fullName === "string" &&
    typeof doc.path === "string" &&
    doc.source === "github"
  )
    return `github:${doc.fullName.toLowerCase()}:file:${doc.path}`;
  if (typeof doc.fullName === "string" && doc.source === "github")
    return `github:${doc.fullName.toLowerCase()}:repository`;
  return undefined;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function hashDoc(doc: Document): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(doc)))
    .digest("hex");
}
function validateBackup(input: unknown): Array<{ id: string; doc: Document }> {
  validateJson(input, new Set());
  if (
    !input ||
    typeof input !== "object" ||
    (input as { version?: unknown }).version !== 1 ||
    !Array.isArray((input as { documents?: unknown }).documents)
  )
    throw new Error("invalid backup");
  const documents = (
    input as { documents: Array<{ id: string; doc: Document }> }
  ).documents;
  for (const item of documents) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.includes("\n") ||
      item.id.length > 1024 ||
      !item.doc ||
      typeof item.doc !== "object" ||
      Array.isArray(item.doc)
    )
      throw new Error("invalid backup document");
  }
  return documents;
}
function validateJson(value: unknown, ancestors: Set<object>, depth = 0): void {
  if (depth > 100) throw new Error("backup nesting exceeds 100 levels");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (
    !value ||
    typeof value !== "object" ||
    ancestors.has(value) ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error("backup must contain valid JSON values");
  ancestors.add(value);
  for (const child of Object.values(value))
    validateJson(child, ancestors, depth + 1);
  ancestors.delete(value);
}
