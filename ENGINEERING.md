# Engineering notes

Shardly is a document store with full-text search, written from scratch in
TypeScript. No database, no Lucene, no search library. This document explains
why each part works the way it does, what the alternatives were, and where the
design knowingly stops short.

`README.md` tells you what Shardly does and how to run it. This file is the
argument behind it. Read them in either order.

Every number here comes from a run on this commit. The commands that produce
them are in the sections that use them.

## Contents

- [The one idea](#the-one-idea)
- [Why append-only segments](#why-append-only-segments)
- [Why a write-ahead log, and why two records per write](#why-a-write-ahead-log-and-why-two-records-per-write)
- [The recovery algorithm, and the case it deliberately drops](#the-recovery-algorithm-and-the-case-it-deliberately-drops)
- [Group commit, and why batching changes the fsync math](#group-commit-and-why-batching-changes-the-fsync-math)
- [Compaction, and where the commit point sits](#compaction-and-where-the-commit-point-sits)
- [Snapshots, and the version counter that guards them](#snapshots-and-the-version-counter-that-guards-them)
- [Tokenization, and the four places it loses information](#tokenization-and-the-four-places-it-loses-information)
- [The inverted index, and the cost of deleting from one](#the-inverted-index-and-the-cost-of-deleting-from-one)
- [BM25, term by term](#bm25-term-by-term)
- [Two passes and a bounded heap](#two-passes-and-a-bounded-heap)
- [What the benchmark actually measures](#what-the-benchmark-actually-measures)
- [Three ingestion adapters, one contract](#three-ingestion-adapters-one-contract)
- [The HTTP layer, and why it stays thin](#the-http-layer-and-why-it-stays-thin)
- [Known limits](#known-limits)

## The one idea

Every design decision in Shardly follows from one claim. You can find the
bytes of any document without reading any other document, and you can find the
documents matching a word without reading any document at all.

Two maps do all the work. `OffsetIndex` maps a document id to a segment file, a
byte offset, and a byte length. `InvertedIndex` maps a term to the list of
documents containing it. Both live in memory. Both are rebuildable from disk.
Everything else is the machinery that keeps them true across a crash.

A read is `fs.readSync(fd, buf, 0, length, byteOffset)`. One syscall, no scan.
A search walks posting lists and never opens a segment until it knows which ten
documents to return. That is the whole system.

## Why append-only segments

Documents live as one JSON object per line under `data/segments/`, in files
named `segment-0000.log` upward. `SEGMENT_MAX_BYTES` in `src/config.ts` caps
each file at 64 MiB, and `Storage.rotateSegment()` starts a new one when the
next record would overflow the cap.

Appending is the only write pattern that is cheap and safe at the same time. An
in-place update has to either fit in the space the old record occupied or move
the record and leave a hole, and both paths need the old and new state to be
consistent if the power fails halfway. Appending has neither problem, because
the old bytes are never touched. The cost lands somewhere else. Space is never
reclaimed until you compact.

The 64 MiB cap is not about performance. Nothing in the read path cares how
large a segment is, because reads seek directly. The cap exists so that
compaction has units to work with and so that a corrupt file loses a bounded
amount of data rather than everything.

`Storage` keeps a read-only file descriptor per segment in `this.readFds`, so a
hot read never pays for `open`. It keeps exactly one write descriptor, on the
newest segment, opened in append mode. That asymmetry is deliberate. Many
readers, one writer, no locking.

One subtlety in `openCurrentSegment()`: it sets `currentSegmentSize` from
`fs.statSync(p).size` rather than from the snapshot. The file on disk is the
authority on how many bytes it holds. If recovery restored a write the snapshot
never saw, trusting the snapshot would place the next record on top of a live
one.

## Why a write-ahead log, and why two records per write

The problem the log solves is narrow. A single `write` to a segment is not
atomic. The power can fail with half a JSON object on disk, and there is no way
to tell a half-written record from a whole one by looking at it.

`Storage.append()` writes each document in three steps:

1. Append a WAL record with `status: "pending"` and `fsync` it. This says where
   the record is about to go, before any of it exists.
2. Write the record to the segment and `fsync` it.
3. Update `offsetIndex` in memory, then append a WAL record with
   `status: "committed"` and `fsync` it.

Two WAL records per write looks wasteful until you ask what a single record
would tell you. A lone "I intend to write at offset 4096" leaves recovery
unable to distinguish a completed write from a torn one. A lone "I wrote at
offset 4096" is a lie if the process dies before the segment `fsync` returns,
because the log entry is durable and the data is not. You need the pair. The
pending record bounds where damage can be, and the committed record proves the
damage is not there.

The write returns to the caller only after step 3. That is what "acknowledged"
means in the crash harness, and it is the only promise Shardly makes.

`WriteAheadLog` holds one append-mode descriptor for the life of the process
and reuses it. Reopening per write would add two syscalls to a path that is
already dominated by `fsync`.

## The recovery algorithm, and the case it deliberately drops

`Storage.replayWal()` runs in the constructor, after the offset snapshot loads.
It reads every WAL record and makes two passes.

The first pass applies everything marked `committed`. These are proven durable,
so they are applied without inspection. Delete records are `committed` from the
moment they are written, because a tombstone is a memory-only flag and the log
record is the only durable part of it.

The second pass handles the crash window, meaning records marked `pending`
with no matching `committed` record, keyed by `${segment}:${byteOffset}`. For
each one,
`verifySegmentRecord()` checks that the segment file exists, that it is long
enough to hold the claimed range, that the bytes at that range parse as JSON,
and that the embedded id matches. If all four hold, the record survived and
gets applied. If any fail, it is dropped.

This is where Shardly is honest about its guarantee. A write in the crash
window is recovered when it happens to be intact and discarded when it is not.
Both outcomes are correct, because the caller never got an acknowledgement.
What the check cannot catch is a record that is byte-complete and
JSON-parseable but silently corrupted by the storage layer underneath, a
flipped bit inside a string value. Detecting that needs a per-record checksum.
Shardly does not have one, and adding a CRC to the record format is the single
highest-value change to this file.

Recovery ends by calling `snapshot()`, which persists the reconstructed state
and truncates the log. The WAL is a crash-window buffer, not a history.

`readAll()` swallows parse errors on individual lines. That is intentional and
narrow. The last line of the log is the one most likely to be torn by the same
crash being recovered from, and a torn tail should not make the whole file
unreadable.

Run the harness with `npx tsx scripts/crash-test.ts 6`. It spawns a writer,
kills it with `SIGKILL` after a random 150 to 550 ms, reopens the store, and
verifies every id the writer ever acknowledged, across all rounds so far. On
this commit: 125,719 acknowledged writes, six kills, zero missing, zero
corrupt.

The writer acknowledges over a pipe, and `fs.writeSync` on a non-blocking pipe
throws `EAGAIN` once the parent's buffer fills. Losing an ack does not produce
a false pass, it quietly shrinks the set under test, which is worse because it
looks like success. `scripts/crash-writer.ts` retries on `EAGAIN` rather than
dropping the line.

## Group commit, and why batching changes the fsync math

`fsync` costs the same whether it flushes 200 bytes or 200 kilobytes. Writing
documents one at a time means three `fsync` calls each, and that number, not
the byte count, sets the ingest ceiling.

`Storage.writeBatch()` restructures the same protocol around the batch:

1. Build the whole NDJSON blob in memory, assigning ids and computing offsets
   as it goes, rotating segments where the cap demands.
2. Write every pending WAL record in one `fsync`.
3. Write the segment data, one `fsync` per segment touched.
4. Update `offsetIndex`.
5. Write every committed WAL record in one `fsync`.

Three `fsync` calls per document becomes roughly three per batch. The ordering
guarantee is unchanged, because the invariant was never "one document at a
time", it was "intent durable before data, data durable before commit".

`npx tsx scripts/seed.ts 20000 /tmp/shardly-demo` writes 20,000 documents in
6.4 seconds, about 3,100 documents per second, in batches of 1,000.

The offset arithmetic in step 1 is the fiddly part. Offsets are computed against
`this.currentSegmentSize + Buffer.byteLength(chunk, "utf8")`, the committed size
plus the not-yet-flushed buffer, and `Buffer.byteLength` rather than
`String.length` because a multi-byte character would otherwise put every
subsequent offset in the batch off by the difference. That bug would be
invisible on ASCII test data and would corrupt every read on real text.

## Compaction, and where the commit point sits

Deleting a document sets `deleted: true` on its offset entry and appends a WAL
record. The bytes stay in the segment. Without compaction, a store that deletes
as much as it writes grows without bound, and `src/types.ts` promised a
compaction that did not exist.

`Storage.compact()` walks the live entries, writes them into fresh segments,
and unlinks the old files. The ordering is the whole design:

1. New segments are numbered from `currentSegmentIndex + 1`, so they never
   collide with a file that current offsets point at. The old files stay
   complete and readable throughout.
2. Every new segment is `fsync`ed.
3. `snapshot()` writes the new offset index atomically and truncates the WAL.
   **This is the commit point.**
4. Only after that do the old segment files get unlinked.

A crash before step 3 leaves the old snapshot and the old segments, both
intact, plus an orphaned partial file. A crash after step 3 leaves the new
snapshot valid and some old files still on disk. Neither window loses data,
which is the property worth having.

The orphan is not swept at startup, and that is a deliberate call marked with a
`ponytail:` comment in the source. A startup sweep that unlinks unreferenced
segments is exactly the code that deletes real data when a snapshot goes
missing for an unrelated reason. Leaving the orphan costs disk. The next
compaction reclaims it, because it reuses the same number and opens with `"w"`.
Even if a normal rotation reaches that number first, it opens with `"a"` and
sizes itself from the file, so new records land after the dead bytes and every
offset stays correct. Wasted space, never corruption.

On 20,000 seeded documents with half deleted, `compact()` reclaims 9,753,999
bytes in 141 ms.

## Snapshots, and the version counter that guards them

Rebuilding both maps from segments on every start would mean re-reading and
re-tokenizing the entire corpus. Instead, `SNAPSHOT_EVERY_N_WRITES` (500)
triggers `Engine.snapshot()`, which writes the offset index and the inverted
index as JSON and truncates the WAL.

`writeJsonAtomic()` writes to `${target}.tmp`, `fsync`s it, renames over the
target, and then `fsync`s the parent directory. That last step is easy to miss
and it matters here more than usual. A rename is atomic with respect to
readers, but it is not durable until the directory entry is flushed, and
`snapshot()` truncates the WAL immediately afterward. Without the directory
`fsync`, a power failure in that gap loses the snapshot and the log that would
have rebuilt it.

The harder problem is knowing whether a loaded snapshot is current. The
original check compared document counts, which fails on the case that actually
occurs. Delete one document, add another, and the counts match while the
contents do not.

`Storage` now keeps a `version` counter, incremented on every mutation and
written into the offset snapshot. `InvertedIndexStore.snapshot()` records the
same number, and `load()` returns it. `Engine.hydrateIndex()` compares the two:

```ts
if (this.index.load(this.paths.invertedSnapshot) === this.storage.stateVersion()) {
  return;
}
```

Anything other than an exact match rebuilds from the segments. Equal counts no
longer pass for equal state.

The two snapshots are written in sequence, not atomically together, so a crash
between them leaves a fresh offset snapshot and a stale inverted snapshot. The
version check catches that on the next start and rebuilds. Making the pair
atomic would need a two-phase write for no gain, because the inverted index is
derived data and rebuilding it is always safe.

## Tokenization, and the four places it loses information

`tokenize()` lowercases, replaces every run of non-alphanumeric characters with
a space, drops stopwords, and stems what remains. `tokenizeDocument()` walks a
JSON value recursively, collecting strings, numbers, and booleans, so a
document is searchable by any value at any depth without a schema.

Each stage throws information away, and it is worth being precise about what.

**The character class is ASCII-only.** `NON_ALNUM` is `/[^a-z0-9\s]+/g`,
applied after `toLowerCase()`. Any character outside `a-z0-9` becomes a
separator. `tokenize("Zürich café naïve")` returns
`["z", "rich", "caf", "na", "ve"]`, and `tokenize("東京 検索")` returns `[]`.
Non-English text is not merely ranked poorly, it is unindexable. For the
bundled English Wikipedia corpus this is invisible, which is exactly why it is
worth writing down.

**Stopwords are checked before stemming.** The list holds 51 surface forms, so
`have` and `has` are dropped while `having` stems to `hav` and survives.
`tokenize("have having has")` returns `["hav"]`. Checking the stem instead
would be more consistent, at the cost of dropping legitimate words that happen
to stem onto a stopword.

**The stemmer over-stems.** It is six suffix rules, not Porter.
`stem("cares")` returns `"car"`, colliding with the actual word `car`. A query
for `car` matches documents about caring. The length guards keep the worst
cases out, but they are guards, not a rule set.

**The stemmer also under-stems.** `stem("running")` returns `"runn"` and
`stem("runs")` returns `"run"`, so the two forms of one verb never unify. This
one is a straightforward defect rather than a trade-off. Porter's algorithm
handles it with a doubled-consonant rule.

The reason to keep the naive stemmer anyway is that it is a dozen lines you can
read in full and reason about, and swapping in Porter is a self-contained change to
one function with tests already around it. The reason to write the failures
down is that a stemmer nobody has measured is a stemmer everyone trusts too
much.

Query and document text go through the identical function, so a collision hurts
precision symmetrically rather than breaking recall in one direction.

## The inverted index, and the cost of deleting from one

`InvertedIndexStore` holds four maps: `index` (term to postings), `docFreq`
(term to document count), `docLengths` (document to token count), and
`docTerms` (document to its distinct terms). A running `totalTokens` makes
`averageDocumentLength()` O(1) instead of a scan.

The first three are what BM25 needs. `docTerms` exists only to make deletion
sane, and it is the most interesting map here.

Removing a document means removing it from every posting list it appears in.
The obvious implementation iterates the whole index and filters each list:

```ts
for (const [term, list] of this.index) {
  const next = list.filter((p) => p.docId !== docId);
  ...
}
```

That is O(vocabulary) per delete, and it allocates a replacement array for
every term in the corpus whether or not the document touched it. It is correct
and it passes every unit test. It also does not scale, because the per-delete
cost tracks the size of the whole corpus rather than the size of the document.
Removing the 2,386 bundled Wikipedia articles, the work behind
`POST /corpus/wikipedia/deindex`, took 2,313 ms of index time. The same
removal now takes 311 ms.

`docTerms` turns the loop into O(terms in this document):

```ts
for (const term of this.docTerms.get(docId) ?? []) {
  const list = this.index.get(term);
  ...
}
```

The gap widens with vocabulary size. On a synthetic corpus of 3,000 documents
of 120 tokens each over a 20,000-word vocabulary, deleting every document takes
14,555 ms before and 215 ms after, a 68x difference against the 7x seen on the
smaller Wikipedia vocabulary.

`docTerms` is not in the snapshot format. `load()` rebuilds it by walking the
postings once, which costs one pass over data already being parsed and keeps
old snapshots readable. Deriving beats storing when the derivation is cheaper
than the format change.

The memory cost is one array of string references per document. The strings
themselves are the same objects already used as keys in `index`, so this is
pointers, not text.

`addDocument()` calls `removeDocument()` first when the id is already known,
which makes re-adding an id an update rather than a silent duplicate. Postings
would otherwise accumulate two entries for one document and double its score.

## BM25, term by term

The score for a document is the sum over query terms of:

```
idf(term) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgdl))
```

`k1 = 1.5` and `b = 0.75` in `src/config.ts`, the standard defaults.
`rankBM25()` accepts overrides so tests can pin them.

**IDF asks how surprising the term is.** `idf()` implements
`log((N - n + 0.5) / (n + 0.5) + 1)`. A term in every document contributes
almost nothing. A term in three documents dominates. The `+ 1` inside the
logarithm is the part worth knowing. Without it, a term appearing in more than
half the corpus produces a negative IDF, and a document could lose points for
containing a query word. The `0.5` terms keep a term that appears in every
document from dividing by zero.

**`k1` makes term frequency saturate.** The tenth occurrence of a word adds far
less than the second. Raw frequency would let a page that repeats one word four
hundred times beat a page that is genuinely about the topic, which is the exact
failure mode BM25 was designed against.

**`b` normalizes for length.** At `b = 0.75`, three quarters of the length
correction applies. A long document has more chances to contain any term, so
its term frequencies get discounted by `docLen / avgdl`. Set `b = 0` and long
documents win everything. Set `b = 1` and a long document that genuinely covers
a topic in depth gets punished for its length. The test
`a genuinely more relevant long doc still wins when it earns it` in
`tests/rank.test.ts` pins that the middle setting behaves.

Every hit carries a `breakdown: TermScore[]` with each term's frequency, IDF,
and contribution, sorted by contribution. The scores sum to the total, and a
test asserts it. This is what lets the UI answer "why did this rank here"
instead of showing a number nobody can check.

## Two passes and a bounded heap

`rankBM25()` scores in one pass and explains in another.

Pass one deduplicates the query terms, drops the ones with no postings,
precomputes each surviving term's IDF once, then walks the posting lists
accumulating into `Map<docId, number>`. Numbers only. Building a
`{docId, score, breakdown}` object per candidate would allocate for every
document that matched any term, and the answer is ten of them.

Selection is `selectTopN()`. When the limit is `Infinity` or exceeds the
candidate count, it sorts everything, because a heap cannot beat a sort when
you want the whole list. Otherwise a fixed-capacity `MinHeap` keeps the best
`limit` items in O(n log k). The minimum sits at the root, so deciding whether
a candidate belongs is one comparison against `scores[0]`. For 20,000
candidates and a limit of 10, that is roughly 20,000 comparisons and 10 slots,
against 20,000 log 20,000 for a full sort.

Pass two builds breakdowns for the winners only. The original implementation
searched each term's posting list once per winner:

```ts
function termFrequencyIn(index, term, docId) {
  for (const p of index.postings(term)) {
    if (p.docId === docId) return p.termFrequency;
  }
  return 0;
}
```

That is O(winners × terms × postings). On a term appearing in 20,000 documents
with a limit of 10, it re-scans 20,000 postings ten times to recover ten
numbers. It now walks each term's postings once, filling a
`Map<docId, Map<term, tf>>` keyed by a `Set` of winner ids, which drops the
work to O(terms × postings) regardless of the limit.

`total` reports the full count of documents matching at least one term, not the
size of the returned page. Reporting the page size as the total would make
every search look like it found exactly ten things.

## What the benchmark actually measures

`Engine.benchmark()` runs a query through `search()` and through
`naiveSearch()` and reports both timings plus whether the top hit agrees. It
exists because a search engine that cannot show its own speedup is a claim, not
a result.

The honest framing matters more than the number. `naiveSearch()` reads every
document from disk, tokenizes it, computes document frequencies, and scores the
corpus, on every call. So the comparison is **no index at all** against **index
already built**, not linear scan against index lookup. The index build cost is
paid once at ingest and does not appear in either column. A pre-tokenized
linear scan would land between the two.

The comparison is still worth running, because both sides compute BM25 over the
same corpus with the same constants, and `topHitsMatch` verifies that the fast
path returns the same answer as the slow one. A speedup with a different answer
is a bug report.

On 20,000 seeded documents, via `npm run bench -- /tmp/shardly-demo`, which
discards a warm-up run and averages five:

| Query | Indexed | Unindexed | Ratio | Top hit |
| --- | ---: | ---: | ---: | --- |
| `storage index` | 4.8 ms | 423.1 ms | 87x | agrees |
| `crash recovery latency` | 4.4 ms | 415.2 ms | 94x | agrees |
| `vector` | 2.2 ms | 372.3 ms | 172x | agrees |
| `distributed replication shard` | 4.3 ms | 385.5 ms | 89x | agrees |
| `checksum integrity corruption` | 3.3 ms | 404.0 ms | 121x | agrees |

`speedup` divides by `Math.max(indexed.tookMs, 1e-6)`. On a small corpus where
the indexed path finishes in microseconds, that ratio is measuring timer
resolution as much as anything. Treat the ordering as real and the exact
multiplier as approximate.

## Three ingestion adapters, one contract

Every adapter returns plain `Document` objects and hands them to
`Engine.addDocuments()`. None of them knows about segments, the WAL, or the
index. That is the entire integration contract, and it is why adding a fourth
source touches one file.

**Files and PDFs.** `extractDocuments()` in `src/ingest/extract.ts` dispatches
on extension. PDFs go through `unpdf`, and a PDF with no extractable text is
reported as skipped with a reason rather than indexed as an empty document,
because a scanned page silently producing nothing is the kind of thing you want
to see in the response. JSON files become one document per object, or one per
array element. NDJSON is parsed line by line, skipping malformed lines rather
than failing the file.

Files with an unrecognized extension get a binary check before decoding:
`isProbablyBinary()` reads the first 8 KiB, returns true on any NUL byte, and
otherwise flags files where more than 30% of bytes are C0 control characters
outside tab, newline, and carriage return. A NUL byte is conclusive. The 30%
threshold is a heuristic, tuned to let odd-but-real text through while
rejecting compiled output. Extensions on the `TEXT_EXTENSIONS` list skip the
check entirely, because a `.ts` file is text even if it opens with something
strange.

**GitHub.** `src/ingest/github.ts` accepts a username, an `owner/repo`, or a
full URL, all normalized by `parseGithubTarget()`. Repository metadata always
gets indexed. Deep mode also walks the file tree and pulls source files.
Caps on repositories, files per repository, total files, and file size are
parameters with defaults rather than constants, so the HTTP route can hold a
fixed policy while tests pick their own. Concurrency runs through `mapLimit()`,
an 18-line worker pool. `Promise.all` over every file would open hundreds of
sockets and trip GitHub's rate limiter. A token is optional, is never stored,
and moves the rate limit from 60 to 5,000 requests per hour.

**Wikipedia.** Two paths, and the difference is the point. `src/ingest/corpus.ts`
streams `corpus/wikipedia.ndjson` from disk through `readline`, batching 500
documents at a time, so a large corpus never lands in memory whole. That is the
path the app uses. `src/ingest/wikipedia.ts` fetches live from the Wikipedia
API, and exists to build the corpus file in the first place. It runs a
concurrency-limited pump, honors `Retry-After` on 429 and 503, falls back to
exponential backoff with jitter, and gives up only after 25 consecutive
failures. One flaky response should not end a long crawl.

`POST /corpus/wikipedia/index` streams NDJSON progress events back to the
browser as it works. A synchronous request that returns after 2,386 documents
tells the user nothing for the whole duration, and the streaming version is
about twenty lines.

## The HTTP layer, and why it stays thin

`src/api/routes.ts` validates input, shapes output, and calls `Engine`. No
business logic. `Engine` has no idea Fastify exists, which is why
`tests/rank.test.ts` and `tests/storage.test.ts` construct their subjects
directly and `tests/api.test.ts` uses `app.inject()` with no network at all.

Two decisions in this file are load-bearing.

**`previewDoc()` truncates recursively.** `GET /documents` and `GET /search`
trim string values to 280 characters and set `_truncated`. The original version
only walked top-level keys, so a nested `{content: {body: "..."}}` from a deep
GitHub index shipped whole, and `_truncated` was absent while the response was
megabytes. It now recurses through objects and arrays.
`GET /documents/:id` returns the full document, because that is the detail view
and truncating it would defeat the purpose.

**`parseLimit()` clamps.** Unparseable or non-positive values fall back to the
default, and everything is capped at a maximum. A client asking for
`limit=100000000` gets the cap, not an attempt.

`buildServer()` returns both the app and the engine, and registers an `onClose`
hook that snapshots and closes descriptors. Tests need the engine handle;
production needs the clean shutdown. `SIGINT` and `SIGTERM` both route through
`app.close()`.

## Known limits

These are the things worth saying out loud before someone finds them.

**No checksums.** Recovery validates structure, not content. A bit flip inside
a string value survives `JSON.parse` and the id check. A CRC per record is the
fix.

**All I/O is synchronous.** `fs.readSync` and `fs.writeSync` block the Node
event loop, so a slow read stalls every concurrent request. At a scale where
the OS page cache holds the working set, this is fine and it keeps the storage
code linear and readable. At a larger scale it is the first thing to change.

**One writer, one process.** Nothing coordinates two processes against one data
directory. There is no lock file. Opening the same directory twice will corrupt
it.

**No auth.** `POST /reset` destroys the store and `DELETE /documents/:id`
removes a document, both unauthenticated, with CORS set to `origin: true`.
Correct for a local demo, unacceptable the moment it is deployed.

**The inverted index is memory-resident.** Postings are JavaScript objects, not
packed integers, and nothing spills to disk. The corpus has to fit in the heap.
Real engines use skip lists and delta-encoded posting blocks on disk.

**Snapshots are JSON.** Human-readable and slow to parse. A binary format would
load faster and diff worse. For a system whose point is being readable, JSON
wins.

**Search is a bag of words.** No phrase queries, no boolean operators, no field
weighting, no fuzzy matching. Position data would need to go into the postings
before any of that is possible.
