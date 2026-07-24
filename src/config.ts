import path from "node:path";

/**
 * Single source of truth for every tunable constant in the system.
 * No magic numbers scattered across modules — everything that could be
 * tweaked or explained in an interview lives here.
 */

/** Default root for all persisted state. Overridable via env, or per-instance
 * by passing a dataDir to the engine/storage (used heavily by tests). */
export const DEFAULT_DATA_DIR = process.env.SHARDLY_DATA_DIR
  ? path.resolve(process.env.SHARDLY_DATA_DIR)
  : path.resolve(process.cwd(), "data");

export interface DataPaths {
  dataDir: string;
  segmentsDir: string;
  indexDir: string;
  walPath: string;
  offsetSnapshot: string;
  invertedSnapshot: string;
}

/** Derive every on-disk path from a root data directory. */
export function dataPaths(dataDir: string = DEFAULT_DATA_DIR): DataPaths {
  return {
    dataDir,
    segmentsDir: path.join(dataDir, "segments"),
    indexDir: path.join(dataDir, "index"),
    walPath: path.join(dataDir, "wal.log"),
    offsetSnapshot: path.join(dataDir, "index", "offset-index.snapshot.json"),
    invertedSnapshot: path.join(
      dataDir,
      "index",
      "inverted-index.snapshot.json",
    ),
  };
}

/**
 * Max size of a single segment file before it is sealed and a new one opened.
 * Real systems (Kafka, Cassandra) cap segments so compaction can touch one
 * segment at a time. 64MB here — small enough to demo rotation, large enough
 * to be realistic.
 */
export const SEGMENT_MAX_BYTES = 64 * 1024 * 1024;

/** BM25 tuning constants. k1 controls term-frequency saturation; b controls
 * document-length normalization. These are the textbook defaults. */
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/**
 * How many writes to accumulate before persisting index snapshots to disk.
 * The in-memory index is authoritative; snapshots are a fast-startup cache
 * that the WAL/segment replay can always rebuild if stale.
 */
export const SNAPSHOT_EVERY_N_WRITES = 500;
