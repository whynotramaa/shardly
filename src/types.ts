/**
 * Core domain types. These are the structures you explain in an interview,
 * so they are kept small, precise, and free of `any`.
 */

/** An arbitrary JSON document supplied by the caller. Stored verbatim. */
export type Document = Record<string, unknown>;

/** A document as it lives on disk / is returned to callers: the user's fields
 * plus the engine-assigned id. */
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

/** WAL operation. Writes use the pending→committed handshake; deletes only
 * flip a tombstone flag so a single committed record is enough. */
export type WalOp = "write" | "delete";

export interface WalRecord {
  op: WalOp;
  docId: string;
  segment: string;
  byteOffset: number;
  length: number;
  status: WalStatus;
}

/** Per-term breakdown of why a document scored the way it did — surfaced to
 * the frontend so a result's ranking is explainable. */
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
