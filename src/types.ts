/** An arbitrary JSON document supplied by the caller. Stored verbatim. */
export type Document = Record<string, unknown>;

export interface StoredDocument {
  id: string;
  doc: Document;
}

/** Where a single document physically lives, for O(1) retrieval. */
export interface OffsetEntry {
  /** Segment file name, e.g. "segment-0002.log". */
  segment: string;
  /** Byte offset of the record's first byte within the segment. */
  byteOffset: number;
  /** Exact byte length of the record (excluding the trailing newline). */
  length: number;
  /** Tombstone flag — deleted docs stay in the segment until compaction. */
  deleted: boolean;
  /** SHA-256 of the record bytes, when written by hardened storage. */
  checksum?: string;
}

/** docId -> physical location. Lives fully in memory for fast lookups. */
export type OffsetIndex = Map<string, OffsetEntry>;

export interface Posting {
  docId: string;
  termFrequency: number;
}

export interface IndexedToken {
  term: string;
  field: string;
  position: number;
  start: number;
  end: number;
  original: string;
}

export type PostingList = Posting[];

/** term -> which docs contain it, and how often. */
export type InvertedIndex = Map<string, PostingList>;

export type WalStatus = "pending" | "committed";

export type WalOp = "write" | "delete";

export interface WalRecord {
  op: WalOp;
  docId: string;
  segment: string;
  byteOffset: number;
  length: number;
  status: WalStatus;
  /** SHA-256 of the exact segment record bytes; absent on legacy WAL records. */
  checksum?: string;
  /** SHA-256 of the segment record bytes; absent on legacy WAL records. */
  dataChecksum?: string;
}

export interface TermScore {
  term: string;
  termFrequency: number;
  idf: number;
  contribution: number;
}

export interface SearchHit {
  revision?: string;
  docId: string;
  score: number;
  doc: Document;
  breakdown: TermScore[];
  snippet?: SearchSnippet;
  passages?: SearchSnippet[];
  groupKey?: string;
}

export interface SearchSnippet {
  revision?: string;
  reference?: string;
  offsetUnit?: "utf16";
  heading?: string;
  text: string;
  field: string;
  start: number;
  end: number;
  matches: Array<{ start: number; end: number }>;
  line?: number;
  page?: number;
}

export interface SearchOptions {
  contentLanguage?: string;
  filter?: import("./search/filters.js").Filter;
  scope?: import("./search/filters.js").ReadScope;
  deadlineMs?: number;
  maxWork?: number;
  projection?: "full" | "evidence";
  facets?: boolean;
  limit?: number;
  offset?: number;
  mode?: "all" | "any";
  source?: string;
  repo?: string;
  type?: string;
  language?: string;
  docIds?: string[];
  groupBy?: "none" | "repo" | "source";
  prefix?: boolean;
  typos?: boolean;
  synonyms?: Record<string, string[]>;
  profile?: "baseline" | "tuned";
  inspect?: boolean;
  match?: "text" | "literal" | "substring";
}

export interface Facet {
  value: string;
  count: number;
}

export interface SearchInspector {
  parsedQuery: string[];
  expansions: Record<string, string[]>;
  candidateCount: number;
  postingReads: number;
  documentReads: number;
  cacheHits?: number;
  documentSource?: "memory" | "storage" | "mixed";
  stageMs: Record<string, number>;
  scoreBreakdown: Record<string, TermScore[]>;
  stages?: Array<{ name: string; tookMs: number; count?: number }>;
}

export interface RebuildStatus {
  state: "idle" | "running" | "completed" | "cancelled" | "stale" | "failed";
  processed: number;
  total: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
export interface MissingExplanation {
  docId: string;
  query: string;
  matched: boolean;
  returned: boolean;
  reasons: Array<{ code: string; detail: string }>;
  rank?: number;
  total: number;
  expansions: Record<string, string[]>;
}
