

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
  /** Tombstone flag ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â deleted docs stay in the segment until compaction. */
  deleted: boolean;
}

/** docId -> physical location. Lives fully in memory for fast lookups. */
export type OffsetIndex = Map<string, OffsetEntry>;

/** One document's contribution to a term's posting list. */
export interface Posting {
  docId: string;
  /** How many times the term appears in this document. */
  termFrequency: number;
}

export type PostingList = Posting[];

/** term -> which docs contain it, and how often. */
export type InvertedIndex = Map<string, PostingList>;

/** WAL record states. */
export type WalStatus = "pending" | "committed";


export type WalOp = "write" | "delete";

export interface WalRecord {
  op: WalOp;
  docId: string;
  segment: string;
  byteOffset: number;
  length: number;
  status: WalStatus;
}


export interface TermScore {
  term: string;
  termFrequency: number;
  idf: number;
  contribution: number;
}

export interface SearchHit {
  docId: string;
  score: number;
  doc: Document;
  breakdown: TermScore[];
}







