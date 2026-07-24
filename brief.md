# Project: Shardly — A Document Store with Full-Text Search (Mini Elasticsearch)

## What this document is

This is a build spec meant to be handed to Claude Code as the starting prompt for implementation. It defines the architecture, exact file layout, component responsibilities, and milestone-by-milestone build order. Follow it in order — each milestone should be working and testable before moving to the next. Do not skip ahead to the frontend before the storage and indexing layers are solid.

---

## 1. What we're building

A self-contained document store with full-text search, similar in spirit to Elasticsearch but scoped down to something one engineer can build, understand completely, and defend in an interview.

Core capabilities:
- Store JSON documents durably (survives process crash without corrupting data)
- Retrieve any document by ID in O(1) disk seek, not a scan
- Full-text search across all documents, ranked by relevance (not just keyword match)
- A live benchmark: ranked search should be dramatically faster than a naive linear scan over the same data

Non-goals (explicitly out of scope, don't build these):
- No distributed/multi-node anything — single process, single machine
- No SQL — this is document storage, not relational
- No authentication/multi-tenancy — single-user local tool
- No use of an existing embedded DB (SQLite, LevelDB, etc.) or search library (Lunr, Elasticlunr, etc.) for the core engine — the storage layer and inverted index must be hand-written. Using Fastify/Next.js for the *surrounding* API/UI is fine.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | Type safety on the index/storage internals matters here |
| Runtime | Node.js | `fs` module gives raw file control we need |
| API server | Fastify | Lower overhead than Express, worth mentioning in interview as a deliberate choice |
| Frontend | Next.js | Upload UI + search UI + score breakdown display |
| Storage | Hand-rolled append-only log files | This is the point of the project — no external DB |
| Persistence format | Newline-delimited JSON (NDJSON) per segment | Simple to append, simple to replay |

---

## 3. On-disk layout

```
/data
├── segments/
│   ├── segment-0000.log      # append-only, one JSON doc per line, in write order
│   ├── segment-0001.log      # created once current segment hits SEGMENT_MAX_BYTES
│   └── segment-0002.log      # the segment currently being appended to
│
├── index/
│   ├── inverted-index.snapshot.json   # term -> posting list, flushed periodically
│   └── offset-index.snapshot.json     # docId -> { segment, byteOffset, length }
│
└── wal.log                    # write-ahead log: "intent to write" markers
```

### Why segments, not one giant file
Splitting into size-capped segments (e.g. 64MB each) mirrors how real log-structured storage works (Kafka partitions, Cassandra SSTables). It also sets up future compaction (reclaiming space from deleted/updated docs) without needing to touch the whole dataset at once.

### Why a WAL
Before any write touches a segment file, first append an intent record to `wal.log`: `{ docId, segment, status: "pending" }`. Once the write to the segment completes and is `fsync`'d, mark the WAL entry `"committed"`. On startup, replay any `"pending"` entries that never got marked committed — that's the crash-recovery story. This is the single most interview-relevant piece of the whole system: it's the concrete answer to "what happens if the process dies mid-write."

**Critical implementation detail:** use `fs.createWriteStream` with explicit `fsync()` calls after each write, not just `fs.writeFile`. Without an explicit fsync, the OS page cache silently protects you from your own bugs during testing, and you won't discover a real corruption bug until it's too late to matter for the demo.

---

## 4. Component breakdown

### 4.1 Storage Layer (`src/storage/`)

**Responsibilities:**
- `write(doc: Document): docId` — append doc to current segment, update offset index, write WAL entries around it
- `read(docId: string): Document | null` — look up offset index, seek directly into the correct segment file, read exact byte range, parse JSON
- `delete(docId: string): void` — tombstone the doc in the offset index (mark deleted, don't rewrite the segment); actual space reclamation is a stretch goal via compaction
- Segment rotation: when current segment exceeds `SEGMENT_MAX_BYTES`, close it and open a new one

**Data structures in memory:**
```ts
type OffsetEntry = { segment: string; byteOffset: number; length: number; deleted: boolean };
type OffsetIndex = Map<string, OffsetEntry>; // docId -> location
```

**On startup:** load `offset-index.snapshot.json` into memory, then replay any uncommitted WAL entries to catch up on writes that happened after the last snapshot but before a crash.

### 4.2 Tokenizer (`src/search/tokenizer.ts`)

Write this yourself — do not import a library. Pipeline:
1. Lowercase the input
2. Strip punctuation (keep alphanumerics + spaces)
3. Split on whitespace
4. Remove stopwords (small hardcoded list: "the", "a", "is", "and", etc. — 30-50 words is enough)
5. Optional stretch: basic suffix-stripping stemmer (e.g. strip trailing "ing", "ed", "s") — don't reach for a real stemming library, a simple rule-based version is fine and easier to explain

### 4.3 Inverted Index (`src/search/index.ts`)

**Core data structure:**
```ts
type Posting = { docId: string; termFrequency: number };
type PostingList = Posting[];
type InvertedIndex = Map<string, PostingList>; // term -> which docs contain it, and how often
```

**Responsibilities:**
- `addDocument(docId, tokens: string[])` — for each unique token, increment its posting list entry for this doc
- `removeDocument(docId)` — strip this doc's postings from every term it appeared in (needed for delete/update)
- Track document frequency (`docFreq: Map<string, number>` — how many docs contain each term, needed for BM25's IDF component) and total document count and average document length (also needed for BM25)
- Periodic snapshot to `inverted-index.snapshot.json`, rebuilt into memory on startup

### 4.4 Ranking — BM25 (`src/search/rank.ts`)

Implement this by hand. Formula, per term per document:

```
score(D, Q) = Σ IDF(qi) * ( f(qi, D) * (k1 + 1) ) / ( f(qi, D) + k1 * (1 - b + b * |D| / avgdl) )
```

Where:
- `f(qi, D)` = how many times query term `qi` appears in document `D`
- `|D|` = length of document `D` in tokens
- `avgdl` = average document length across the whole corpus
- `IDF(qi) = ln( (N - n(qi) + 0.5) / (n(qi) + 0.5) + 1 )`, where `N` = total docs, `n(qi)` = number of docs containing `qi`
- `k1` (typically 1.2–2.0) and `b` (typically 0.75) are tunable constants — start with `k1 = 1.5, b = 0.75`

**Why this matters for the interview:** BM25's document-length normalization (`b`) is what fixes the classic bug of a short document accidentally out-ranking a genuinely more relevant longer one just because a query term happens to make up a bigger fraction of it. Deliberately test this scenario and be ready to explain it — it's the best "here's a specific bug I found and fixed" story available in this project.

### 4.5 API Layer (`src/api/`)

Fastify routes:
- `POST /documents` — accept JSON body, tokenize, write to storage, add to inverted index
- `GET /documents/:id` — direct lookup via offset index
- `DELETE /documents/:id` — tombstone + remove from index
- `GET /search?q=...&limit=10` — tokenize query, look up posting lists for each query term, score candidates with BM25, return ranked results **with score breakdown per document** (so the frontend can show why each result ranked where it did)
- `GET /benchmark?q=...` — run the same query both via the inverted index and via a naive linear scan over all documents, return both timings side by side. This route exists specifically for the interview demo.

### 4.6 Frontend (`web/`)

Next.js app with three views:
1. **Upload/ingest view** — paste or upload JSON documents, see them get indexed
2. **Search view** — search bar, ranked results list, each result shows its BM25 score and which query terms matched
3. **Benchmark view** — run a query, show a bar chart comparing "naive scan" time vs "inverted index" time. This is the screen you actually pull up first in an interview.

---

## 5. Build order (do not reorder)

1. **Storage layer only.** Write/read/delete docs to segments with the offset index. No search yet. Test: kill the process mid-write (literally `kill -9` it in a loop while writing), restart, confirm no corruption and the WAL replay recovers correctly.
2. **Tokenizer.** Pure function, easy to unit test in isolation.
3. **Inverted index**, wired to the storage layer's write path (every doc written also gets indexed).
4. **BM25 ranking** on top of the inverted index. Test with a deliberately tricky corpus (one short doc that repeats the query term, one long doc that's genuinely more relevant) to confirm ranking behaves correctly.
5. **Fastify API** wrapping all of the above.
6. **Benchmark route** — naive scan vs indexed search, timed.
7. **Next.js frontend** — build this last, once the engine underneath is trustworthy.
8. **Load test**: index 50k–100k documents (Wikipedia abstracts dataset works well, or your own GitHub repo commit messages / resume bullets for something personal and demoable), record real benchmark numbers for the interview.

---

## 7. Clean code guidelines for this build

- Storage, tokenizer, index, and ranking are four separate modules with no circular imports — `rank.ts` should not know about `fs`, and `storage/` should not know what BM25 is
- Every public function in `storage/` and `search/` gets a unit test before the API layer touches it
- No `any` types on the core data structures (`OffsetEntry`, `PostingList`, `Posting`) — these are the types you'll be explaining in the interview, they should read cleanly
- Constants (`SEGMENT_MAX_BYTES`, `k1`, `b`) live in one `config.ts`, not scattered as magic numbers
- Keep the WAL replay logic in its own function with its own test — this is the piece most likely to have a subtle bug, and the piece most worth being able to explain line by line
