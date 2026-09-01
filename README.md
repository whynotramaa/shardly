# Shardly

Shardly is a small, self-contained document store with full-text search. It is intentionally similar in spirit to a tiny Elasticsearch: the storage engine, write-ahead log, inverted index, tokenizer, and BM25 ranker are implemented in TypeScript without using an embedded database or a search library.

The project is designed to be understandable and defensible in an engineering interview. It demonstrates durable append-only storage, crash recovery, O(1) document reads, relevance ranking, ingestion pipelines, and a measured indexed-vs-linear-search comparison.

For the reasoning behind each decision, the alternatives rejected, and the
known limits, read [ENGINEERING.md](ENGINEERING.md).

## What the system does

- Stores arbitrary JSON documents durably on disk.
- Reads a document by id using an in-memory offset map and a direct byte-range seek.
- Deletes documents with tombstones instead of rewriting segment files.
- Tokenizes document fields recursively and indexes terms in memory.
- Ranks matches with BM25, including IDF, term-frequency saturation, and document-length normalization.
- Returns a per-term score breakdown so the UI can explain each result.
- Accepts JSON, bulk JSON, text/code files, JSON/NDJSON, PDFs, GitHub targets, and a bundled Wikipedia corpus.
- Compares indexed search with an unindexed scan over the same data.
- Provides a Next.js workspace for ingesting, browsing, searching, benchmarking, and inspecting documents.

The scope is deliberately single-process and single-machine. There is no clustering, replication, authentication, multi-tenancy, SQL layer, compaction implementation, or external database.

## Architecture

```text
input document
    |
    v
Fastify routes / ingestion adapters
    |
    v
Engine
  |--------------------|
  v                    v
Storage              Tokenizer
  |                    |
  v                    v
segments + WAL       InvertedIndexStore
  |                    |
  |                    v
  |                 BM25 ranker
  |                    |
  |--------------------|
           |
           v
      ranked response
```

Search does not scan segment files to find candidates. It tokenizes the query, unions the relevant posting lists, scores only those candidates, and seeks into storage only for the returned documents.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/storage/storage.ts` | Append-only segments, offset index, reads, tombstones, rotation, snapshots, and recovery |
| `src/storage/wal.ts` | Durable pending/committed write records and delete records |
| `src/search/tokenizer.ts` | Lowercasing, punctuation removal, stopword filtering, stemming, and recursive document tokenization |
| `src/search/index.ts` | Term postings, term frequencies, document frequencies, document lengths, and index snapshots |
| `src/search/rank.ts` | BM25 scoring, score explanations, and bounded top-N selection |
| `src/engine.ts` | Coordinates storage and search; exposes CRUD, ingest, search, benchmark, reset, and lifecycle operations |
| `src/api/routes.ts` | Thin Fastify HTTP handlers |
| `src/api/server.ts` | Fastify setup, CORS, multipart support, and shutdown handling |
| `src/ingest/` | File extraction, GitHub ingestion, Wikipedia fetching, and bundled-corpus streaming |
| `scripts/` | Seeding, benchmark reporting, crash testing, and Wikipedia prefetching |
| `tests/` | Unit and API coverage for the storage, recovery, tokenizer, index, ranker, ingestion, and server behavior |
| `web/` | Separate Next.js frontend application |
| `corpus/wikipedia.ndjson` | Bundled offline Wikipedia sample corpus; currently 2,386 records and about 1.4 MB |
| `brief.md` | Original build brief and constraints |

## Storage and durability decisions

### Append-only, size-capped segments

Documents are serialized as one NDJSON record per line under `data/segments/segment-0000.log`, with new segment files created after the 64 MiB limit. Each offset entry stores the segment name, byte offset, byte length, and deletion flag. Reads use `fs.readSync` at that exact offset; they do not scan the log.

This layout keeps writes simple. Deleted and superseded records stay in place,
hidden by the offset index, until `POST /compact` reclaims them.

### Compaction

`Storage.compact()` rewrites the live records into fresh segments numbered past
the current one, so the existing files stay readable until `snapshot()` durably
commits the new offsets. That snapshot is the commit point: a crash before it
leaves the old state intact, and a crash after it leaves only the old files to
unlink. Neither window loses data.

### Write-ahead log

Each single-document write follows this order:

1. Append a pending WAL record and `fsync` it.
2. Append the document record to the segment and `fsync` the segment.
3. Update the in-memory offset index.
4. Append a committed WAL record and `fsync` it.

On startup, the storage layer loads the offset snapshot and replays the WAL. Committed writes are applied directly. Pending writes are verified against the exact segment byte range: intact JSON with the expected id is recovered; missing or malformed bytes are discarded as a torn, unacknowledged write. Deletes are represented by a committed tombstone record.

Snapshots are written atomically through a temporary file, `fsync`, and rename. Once the offset snapshot is complete, the WAL can be checkpointed and truncated.

### Group commit for bulk ingest

`writeBatch` records all intents, writes the batch to the segment, and finalizes the batch with shared fsyncs. This keeps the durability contract while avoiding three fsyncs per document. The seed script uses batches of 1,000 documents because fsync is the dominant cost of individual writes.

## Search decisions

### Tokenization

The tokenizer is intentionally hand-written. It lowercases, turns non-alphanumeric characters into separators, splits on whitespace, removes a compact English stopword list, and applies simple suffix rules. It preserves duplicate tokens because term frequency needs them. `tokenizeDocument` walks nested objects and arrays and converts primitive values to searchable text.

### Inverted index

The index maps each term to postings of `{ docId, termFrequency }`. It also maintains document frequency, each document's token length, total document count, and the running sum needed for average document length. Re-adding an id removes its old postings first, so the update path cannot leave stale terms behind.

The complete index is snapshotted as JSON. The snapshot is a fast-start cache; storage remains the durable source of document data and can rebuild the index through the engine's startup path.

### BM25

The ranker uses the standard BM25 form with `k1 = 1.5` and `b = 0.75`:

```text
score(D, Q) = sum over q of
  IDF(q) * (tf(q,D) * (k1 + 1)) /
  (tf(q,D) + k1 * (1 - b + b * |D| / avgdl))
```

Rare terms receive more weight through IDF. Repeated terms help, but with diminishing returns. The `b` term prevents a long document from winning merely because a query term occupies a smaller or larger fraction of its text. The tests explicitly cover a short document versus an over-long document with equal term frequency, and also verify that a genuinely more relevant long document can still win.

Ranking uses two passes: the first accumulates numeric scores for candidates, and the second builds detailed term contributions only for the winners. A fixed-capacity min-heap avoids sorting every candidate when a small result limit is requested.

## API

The Fastify API is intentionally thin; validation and response shaping stay at the edge while engine behavior remains testable in isolation.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check |
| `GET` | `/stats` | Live document count |
| `POST` | `/documents` | Add one JSON document |
| `POST` | `/documents/bulk` | Add an array of JSON documents |
| `POST` | `/documents/upload` | Multipart text, code, JSON, NDJSON, and PDF ingestion |
| `POST` | `/ingest/github` | Index a user or repository, optionally in deep source mode |
| `GET` | `/corpus/wikipedia/status` | Show bundled and indexed Wikipedia counts |
| `POST` | `/corpus/wikipedia/index` | Stream offline corpus indexing progress as NDJSON |
| `POST` | `/corpus/wikipedia/deindex` | Remove Wikipedia documents while keeping the corpus file |
| `GET` | `/documents` | Paginated document list with trimmed previews |
| `GET` | `/documents/:id` | Full document lookup |
| `DELETE` | `/documents/:id` | Tombstone and de-index a document |
| `GET` | `/search?q=...&limit=...` | Ranked hits with snippets and BM25 breakdowns |
| `GET` | `/benchmark?q=...` | Indexed and naive timings plus top-hit agreement |
| `POST` | `/compact` | Rewrite segments, dropping tombstoned records |
| `POST` | `/reset` | Clear the store and index |

## Ingestion decisions

- Text-like extensions are decoded as UTF-8.
- JSON objects remain structured and get a filename field for traceability.
- JSON arrays become multiple documents.
- NDJSON is parsed line by line, with malformed lines skipped.
- PDFs use `unpdf` for text extraction.
- Binary-looking content is rejected before it can pollute the index.
- GitHub ingestion accepts a username, `owner/repo`, or GitHub URL. Repository metadata and README content are always collected; deep mode fetches source files under bounded request and file budgets with concurrent blob fetching.
- Wikipedia is prefetched into local NDJSON because repeatedly calling the live API is rate-limited. The UI can index or de-index the saved corpus without losing the source file.

## Frontend

The `web/` app is a Next.js client with two surfaces:

- The landing page explains the storage-to-ranking signal path and includes a live search entry point.
- The workspace provides upload/ingest, GitHub, Wikipedia, search, document browsing, document detail rendering, and benchmark views.
- The engineering page records the system's design, BM25 behavior, durability model, ingestion choices, API surface, and benchmark method.
- Search results expose term contributions and highlighting rather than presenting an unexplained score.
- Markdown and code documents have dedicated renderers; snippets are kept short in list/search responses while full documents are loaded by id.

The UI uses a restrained dark/light instrument-panel visual system, with a persisted theme toggle and responsive layouts.

## Running the project

### Engine and API

```bash
npm install
npm run dev
```

The API listens on `http://localhost:3001` by default. Persisted state goes to `./data`; set `SHARDLY_DATA_DIR` to choose another default, or pass a data directory to the engine in scripts/tests.

Useful commands:

```bash
npm run build
npm test
npm run seed                 # 50,000 deterministic synthetic documents by default
npm run crash-test           # repeated SIGKILL recovery test
npx tsx scripts/bench.ts     # benchmark an existing data directory
npx tsx scripts/fetch-wikipedia.ts [count] [output]
```

The frontend is a separate application:

```bash
cd web
npm install
npm run dev
```

The frontend API base is configurable through `NEXT_PUBLIC_API_URL`; otherwise it targets the local API.

## Verification and observed results

The test suite covers:

- Exact storage round trips, missing ids, tombstones, restart persistence, stale snapshots, batch writes, and torn-write rejection.
- Tokenization, stopwords, punctuation, duplicates, stemming, and nested documents.
- Posting-list construction, corpus statistics, deletion, updates, and index snapshots.
- BM25 empty results, rare-term weighting, length normalization, relevance, limits, ordering, and score-breakdown sums.
- API CRUD, validation, snippets, search, reset, restart behavior, and benchmark top-hit agreement.
- Text, structured JSON, arrays, NDJSON, binary rejection, empty files, and real PDF extraction.
- GitHub target parsing.

Run them with `npm test`. The TypeScript production build passes with `npm run build`.

The repository's recorded 50,000-document benchmark uses five-run averages and reports:

| Query | Indexed | Naive | Speedup | Top hit |
| --- | ---: | ---: | ---: | --- |
| `vector` | 5.98 ms | 747.4 ms | 125x | agrees |
| `storage index` | 17.41 ms | 815.9 ms | 47x | agrees |
| `crash recovery latency` | 20.61 ms | 840.8 ms | 41x | agrees |
| `checksum integrity corruption` | 15.47 ms | 797.5 ms | 52x | agrees |

Read the naive column for what it is. `naiveSearch` re-reads and re-tokenizes
every document from disk on each call, so the comparison is "no index at all"
against "index already built", not "linear scan of pre-tokenized data" against
"index". The index build cost is paid once at ingest and does not appear here.
A pre-tokenized linear scan would land somewhere between the two columns.

These are local measurements, not a performance guarantee. Run `npm run seed`
and `npm run bench` on the target machine for fresh numbers. The crash harness
proves that acknowledged writes survive repeated SIGKILLs with no missing or
corrupted records.


