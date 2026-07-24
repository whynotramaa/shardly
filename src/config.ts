import path from "node:path";




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


export const SEGMENT_MAX_BYTES = 64 * 1024 * 1024;


export const BM25_K1 = 1.5;
export const BM25_B = 0.75;


export const SNAPSHOT_EVERY_N_WRITES = 500;







