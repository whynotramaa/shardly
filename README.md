# Shardly

Shardly is a self-contained document store and hybrid retrieval engine for Node.js. Its append-only storage, WAL, tokenizer, BM25, Float32 vector store and HNSW graph are implemented in TypeScript without an embedded database or search library.

It supports durable document writes, O(1) document reads, chunk-level semantic retrieval, reciprocal rank fusion, optional local cross-encoder reranking, and cited context construction. Lexical operation requires no model, account or API key. Embedding and reranking inference can run locally in an optional worker through Transformers.js.

## Hybrid retrieval

```sh
npm ci
npm run build
npm test
SHARDLY_LOCAL_EMBEDDINGS=1 SHARDLY_MODEL_CACHE="$PWD/.cache/models" npm start
```

Model assets download once; set `SHARDLY_MODEL_OFFLINE=1` for subsequent offline operation. Use `npm ci --omit=optional` for lexical operation without the inference runtime. Document writes become durable independently of semantic backfill; inspect `/index/health` for completeness.

```sh
npm run example:rag -- README.md "How are writes recovered?"
npm run crash-test:hybrid
npm run bench:ann
npm run evaluate:fetch
OFFLINE=1 npm run evaluate:hybrid
```

Read the [local setup guide](docs/HYBRID_GUIDE.md), [API reference](docs/HYBRID_API.md), [architecture](docs/HYBRID_ARCHITECTURE.md), [HNSW notes](docs/HNSW.md), [WAL specification](docs/WAL_CONSISTENCY.md), [benchmark methodology](docs/HYBRID_BENCHMARKS.md), and [implementation status and remaining limits](docs/HYBRID_STATUS.md). Existing lexical API contracts and historical benchmarks remain available.

For the reasoning behind each decision, the alternatives rejected, and the
known limits, read [ENGINEERING.md](ENGINEERING.md).

See [agent/search setup](AGENT_SEARCH.md) for MCP, versioned evidence, optional hybrid retrieval and reranking, read scopes, and streaming backups. [Implementation status](IMPLEMENTATION.md) maps every research recommendation to shipped behavior or its remaining gate.

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

The scope is deliberately single-process and single-machine. There is no clustering, replication, account system, SQL layer, or external database. Optional administrator/read tokens enforce document scopes on agent retrieval. A local directory lock enforces one writer; manual compaction reclaims dead records.

## Search workspace

The workspace opens on search. Queries support quoted phrases, `-excluded` words, all/any matching, and `source:`, `repo:`, `type:`, and `language:` filters. Use facets to narrow results, repository/source grouping to diversify them, and prefix or typo expansion when needed. Optional synonyms are scoped to the current query.

Results include original-text passages with match offsets. The split preview loads the full document. Query URLs, saved searches, and named document collections preserve useful work; saved searches and collections live in browser storage, with portable export/import and explicit server save/load. Server-owned workspace state is included in backups.

The workspace separates Search, Sources, Library, and Engine. Search keeps advanced matching and engineering detail expandable. Sources manages uploads, GitHub/Wikipedia imports, and local folders. Library manages documents and saved work. Engine provides rebuilds, diagnostics, backup/restore, and measurements.

An empty library links directly to adding a source. Sources shows the indexed document count and links back to search after import. Sources and idle Search suggest queries drawn from document titles, filenames, and text. Each example is checked against the index before it appears. Examples are optional and stay hidden if their requests fail.

Fields and passages remains the default for this developer workspace. A frozen repository-task evaluation supports that choice; BM25 performs better on the external SciFact abstract benchmark. Choose either profile in Search options. Repository labels are provisional authored judgments, not user feedback. See [evaluation evidence](VERIFICATION.md).

Benchmark has a direct navbar link. It compares engine execution time and document counts, shows indexed stage timings and storage/cache reads, and keeps the last five manual runs while the view is open. Timings are single local samples; the page explains cache/order effects and the limits of top-document agreement.

The inspector shows expansion, candidate counts, posting reads, real storage reads, cache hits, timings, and score contributions. Compare BM25 and field/passage ranking on the same corpus. Use the missing-match explanation to inspect a chosen document. Exact rank inspection stops at the first 1,000 matches and reports an unknown rank beyond that budget.

Literal mode preserves case, punctuation, and symbols. Substring mode searches original text without stemming, ignoring case. These modes scan at most 2,000 scoped documents and 8 MiB of original text; narrow a repository, source, or collection for larger corpora. They retain original UTF-16 match offsets.

Imports report added, updated, and duplicate records. Matching `sourceId` values update the same document id. Raw JSON CRUD intentionally creates distinct records. GitHub credentials stay in memory and must be entered again for a private retry after restart. Cancellation retains completed batches.

Backups contain document ids and full JSON metadata. Restore validates the payload and all id conflicts before writing. Existing identical ids are skipped; conflicting ids are rejected. An I/O failure during restore can leave completed writes, so retry the same backup after fixing the disk error.

See [FEATURES.md](FEATURES.md) for the implementation and verification checklist. Optional OCR and agent retrieval setup are documented in [AGENT_SEARCH.md](AGENT_SEARCH.md). Generated answers are outside this version.

## Local folders and rebuilds

Add an absolute API-server folder path in Sources. Two-second metadata polling detects changes; only changed files are read and hashed. Nested `.gitignore` rules use Git, with a separate Git directory inside the store. Symlinks are skipped. If Git is unavailable, a folder with ignore rules fails safely rather than indexing ignored files. Pause, resume, force rescan, and remove are explicit actions. Malformed structured-file changes retain the last good records. Changed-file staging has a 256 MiB budget; use narrower folder scopes for larger batches. Removing a source deletes only its owned indexed documents and leaves the files untouched.

Index rebuild creates a shadow index while searches use the live index. Cancellation, failure, or a changed storage version keeps the original index. The final version check and index switch are atomic within the worker. Rebuilding temporarily requires memory for both indexes.

Open `/app?demo=true` for the guided interview walkthrough. Demo actions are explicit and scoped; the guide does not reset or kill your running store.

## Architecture

```text
input document
    |
    v
Fastify routes / ingestion adapters
    |
    v
Engine worker, bounded RPC queue
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

Lexical search does not scan segment files to find candidates. It tokenizes the query, unions the relevant posting lists, scores only those candidates, and seeks into storage only for the returned documents.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/storage/storage.ts` | Append-only segments, offset index, reads, tombstones, rotation, snapshots, and recovery |
| `src/storage/wal.ts` | Durable pending/committed write records and delete records |
| `src/search/tokenizer.ts` | Lowercasing, punctuation removal, stopword filtering, stemming, and recursive document tokenization |
| `src/search/index.ts` | Packed postings, field/passage analysis, corpus statistics, and index snapshots |
| `src/runtime/` | Bounded worker RPC, import batching, and engine isolation |
| `src/ingest/folders.ts` | Managed local sources, ignore rules, synchronization, and source-owned deletion |
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

Documents are serialized as one NDJSON record per line under `data/segments/segment-0000.log`, with new segment files created after the 64 MiB limit. Each offset entry stores the segment name, byte offset, byte length, deletion flag, and a SHA-256 record checksum for new writes. Reads use `fs.readSync` at that exact offset; they do not scan the log.

This layout keeps writes simple. Deleted and superseded records stay in place,
hidden by the offset index, until `POST /compact` reclaims them.

### Compaction

`Storage.compact()` rewrites the live records into fresh segments numbered past
the current one, so the existing files stay readable until `snapshot()` durably
commits the new offsets. That snapshot is the commit point: a crash before it
leaves the old state intact, and a crash after it leaves only the old files to
unlink. Neither window loses data.

API compaction yields after every 16 live records so searches can continue reading the original segments. Writes queue behind compaction in the production worker. Direct storage mutations during async compaction fail with a retryable error. `Engine.compact()` returns a promise and must be awaited. The synchronous `Storage.compact()` remains available. Snapshot serialization, fsync, and individual large records can still block the worker.

### Write-ahead log

Each single-document write follows this order:

1. Append a pending WAL record and `fsync` it.
2. Append the document record to the segment and `fsync` the segment.
3. Append a committed WAL record and `fsync` it.
4. Update the in-memory offset index and return the id.

On startup, the storage layer loads the offset snapshot and replays the WAL. Committed writes are verified before they are applied; corrupted committed data stops recovery. Pending writes are verified against the exact segment byte range: intact JSON with the expected id is recovered; missing or malformed bytes are discarded as a torn, unacknowledged write. Deletes are represented by a committed tombstone record.

Snapshots are written atomically through a temporary file, `fsync`, and rename. Once the offset snapshot is complete, the WAL can be checkpointed and truncated.

### Group commit for bulk ingest

`writeBatch` records all intents, writes the batch to the segment, and finalizes the batch with shared fsyncs. This keeps the durability contract while avoiding three fsyncs per document. The seed script uses batches of 1,000 documents because fsync is the dominant cost of individual writes.

[Completion checklist](docs/HYBRID_STATUS.md) · [Current verification and measurements](VERIFICATION.md)

## Search decisions

### Tokenization

The tokenizer is intentionally hand-written. It matches Unicode words, normalizes terms to NFC, expands camelCase and snake_case identifiers, removes a compact English stopword list, and applies simple suffix rules. Original text offsets and stopword positions remain available for phrases and highlighting. It preserves duplicate tokens because term frequency needs them. `tokenizeDocument` walks nested objects and arrays and converts primitive values to searchable text.

### Inverted index

The index stores numeric document IDs and frequencies in packed typed arrays; the public posting iterator resolves IDs to strings. Field token offsets and field/window frequencies are packed as well. It also maintains document frequency, each document's token length, total document count, and the running sum needed for average document length. Re-adding an id removes its old postings first, so the update path cannot leave stale terms behind.

Explicit snapshot and close write the complete index as checksummed JSON. Automatic ingest checkpoints update storage only, avoiding repeated full-index serialization. A validated snapshot reuses baseline postings. Startup still reads stored documents to rebuild field, passage, metadata, and document caches; storage remains the durable source and can rebuild invalid index caches.

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
| `GET` | `/suggest?q=...` | Bounded vocabulary prefix suggestions |
| `POST` | `/search/compare` | Baseline and tuned ranked results |
| `GET` | `/diagnostics` | Storage, vocabulary, postings, and memory estimates |
| `GET` / `POST` | `/backup` | Export documents / validate and merge a backup |
| `GET` / `POST` | `/sources/folders` | List/add managed local folder sources |
| `POST` | `/sources/folders/:id/pause`, `/resume`, `/rescan` | Control source synchronization |
| `DELETE` | `/sources/folders/:id` | Remove only this source's indexed documents |
| `POST` | `/search/explain-missing` | Explain a chosen document's matching and pagination |
| `GET` / `POST` / `DELETE` | `/maintenance/rebuild` | Inspect/start/cancel shadow index rebuild |
| `POST` | `/demo/seed`, `/demo/import`, `/demo/durability` | Explicit isolated demonstration actions |
| `GET` / `POST` | `/demo/search`, `/demo/search/compare` | Search/compare only the separate demo store |
| `GET` / `POST` | `/jobs` | List / queue GitHub or offline Wikipedia imports |
| `GET` | `/jobs/:id` | Import state and progress |
| `POST` | `/jobs/:id/cancel` / `/jobs/:id/retry` | Cancel / queue a separate retry |
| `GET` | `/benchmark?q=...` | Indexed and naive timings plus top-hit agreement |
| `POST` | `/compact` | Rewrite segments, dropping tombstoned records |
| `POST` | `/reset` | Clear the store and index |

The expanded agent endpoints are `POST /retrieve`, `POST /search`, `POST /fetch`, `POST /search/batch`, and `GET /retrieval/status`. Semantic indexing uses `GET /retrieval/semantic` and `POST/DELETE /retrieval/semantic/index`. Server saved work uses `GET/PUT /workspace`; streaming backups use `GET/POST /backup/stream`. `GET /ready` and administrator-only `GET /operations` expose readiness and bounded HTTP metrics. See [contracts and configuration](AGENT_SEARCH.md).

## Ingestion decisions

- Text-like extensions are decoded as UTF-8.
- JSON objects remain structured and get a filename field for traceability.
- JSON arrays become multiple documents.
- NDJSON is parsed line by line. A malformed line rejects extraction; managed folders retain the last good indexed version.
- PDFs use `unpdf` for text extraction. Optional blank-page OCR uses installed Poppler/Tesseract tools.
- Office, MIME email, EPUB, HTML, CSV/TSV, and RTF have format-specific extraction with bounded inputs and parser diagnostics.
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
npm ci
npm run demo                # optional small, repeatable showcase corpus
npm run dev
```

The API listens on `http://127.0.0.1:3001` by default. The frontend is available at `http://localhost:3000/app`. Browser origins are restricted to loopback and an optional exact `SHARDLY_ALLOWED_ORIGIN`. Configure `SHARDLY_ADMIN_TOKEN` for network exposure and `SHARDLY_READ_KEYS` for scoped retrieval clients. Persisted state goes to `./data`; set `SHARDLY_DATA_DIR` to choose another default, or pass a data directory to the engine in scripts/tests.

Useful commands:

```bash
npm run build
npm test
npm run evaluate            # synthetic authored relevance regression suite
npm run evaluate:workspace  # frozen real repository content, authored task judgments
npm run compare:fts -- 10000 # requires Python 3 with SQLite FTS5
npm run bench:concurrent    # isolated worker HTTP/import benchmark
npm run bench:maintenance   # HTTP searches during worker compaction
npm run profile:engine      # sampled allocations and retained heap, 10k docs by default
npm run evaluate:fetch      # cached public BEIR SciFact archive
npm run evaluate:real       # all 300 externally judged queries
npm run seed                 # 50,000 deterministic synthetic documents by default
npm run crash-test           # repeated SIGKILL recovery test
npx tsx scripts/bench.ts     # benchmark an existing data directory
npx tsx scripts/fetch-wikipedia.ts [count] [output]
```

The frontend is a separate application:

```bash
cd web
npm ci
npm run dev
```

The frontend API base is configurable through `NEXT_PUBLIC_API_URL`; otherwise it targets the local API.

GitHub Actions runs tests, the engine build, both frontend builds, and both authored relevance suites on pushes and pull requests. The separate **Manual benchmarks** workflow runs crash recovery, 100k-document comparison, concurrent imports, compaction, heap profiling, and SciFact evaluation. It uploads reports as workflow artifacts.

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

These historical 50,000-document measurements predate field and passage ranking. They are retained as the original baseline, not a claim about the current engine:

| Query | Indexed | Naive | Speedup | Top hit |
| --- | ---: | ---: | ---: | --- |
| `vector` | 5.98 ms | 747.4 ms | 125x | agrees |
| `storage index` | 17.41 ms | 815.9 ms | 47x | agrees |
| `crash recovery latency` | 20.61 ms | 840.8 ms | 41x | agrees |
| `checksum integrity corruption` | 15.47 ms | 797.5 ms | 52x | agrees |

The historical naive column reads and tokenizes storage on every query. The current benchmark method is described in [ENGINEERING.md](ENGINEERING.md). Read the historical column for what it is. `naiveSearch` re-reads and re-tokenizes
every document from disk on each call, so the comparison is "no index at all"
against "index already built", not "linear scan of pre-tokenized data" against
"index". The index build cost is paid once at ingest and does not appear here.
A pre-tokenized linear scan would land somewhere between the two columns.

These are local measurements, not a performance guarantee. Run `npm run seed`
and `npm run bench` on the target machine for fresh numbers. The crash test checks acknowledged writes after repeated SIGKILLs. It exercises process crashes; it does not prove behavior under physical power loss or faulty hardware.


