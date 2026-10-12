# How Shardly works

Shardly is a personal document and code search engine. The TypeScript storage,
analyzer, index, and ranker are hand-built so an interviewer can inspect the
whole path. Fastify exposes the engine; Next.js exposes the evidence behind
each result. OCR, AI chat, accounts, and distributed infrastructure are outside
this version.

## Durable storage

Segments contain newline-delimited `{id,doc}` records. An offset map records
the file, byte offset, byte length, deletion state, and SHA-256 checksum for new
records. A lookup seeks directly to those bytes and verifies their identity and
checksum. The offset lookup is constant time; reading and hashing scale with
record size. UTF-8 byte lengths never come from JavaScript string lengths.

A write syncs its pending WAL record, segment bytes, then commit record. Only
after commit sync succeeds does storage publish the offset and return the id.
Bulk writes amortize syncs across a batch; rotation syncs each completed segment.
A bulk request is not a transaction. Recovery can retain an intact unacknowledged
subset of a batch.

The WAL and segment data have separate checksums. Recovery identifies matching
commits, then replays operations chronologically. Replaying all commits and then
all pending writes could resurrect an old version after a replacement or delete.
Committed data must pass verification or opening fails. Pending data without a
commit is recovered if intact and ignored if torn. Only a malformed unterminated
final WAL line is discarded; malformed interior records and bad checksums fail.

Old records remain compatible. Without a checksum they receive structural and
identity checks, not content-integrity verification. Checksums detect corruption;
backups or re-imports provide recovery from damaged media.

An atomic offset snapshot becomes the source of offsets before WAL truncation.
Directory syncs protect file creation and rename ordering on local filesystems.
The inverted snapshot is disposable. A stale format, version mismatch, or invalid
cache requires a rebuild from stored documents. A valid cache reuses baseline
postings; field, passage, metadata, and document caches still rebuild at startup.

`writeWithId` appends a replacement and switches its offset after durable commit.
Deletion records a tombstone. Compaction rewrites live data into fresh segments
before replacing the snapshot. Original segments remain available until the new
offsets are committed. Cleanup failures can leave safe orphans for a later open.

A PID-backed directory lock rejects a second local writer. It is not a distributed
lock and does not make a network filesystem safe. Partial reads and writes loop
until complete. Failed writes must prevent later writes from using stale offsets;
fault tests exercise these paths.

WAL append failure blocks further appends until a successful checkpoint or reopen.
Reset commits an empty snapshot before removing the old segments. A process killed
inside stale-lock reclamation can leave `.lock-reclaim`; opening fails safely with
an instruction to remove that guard after confirming there is no active writer.

## Analysis and matching

The analyzer preserves Unicode letters, combining marks, numbers, and underscores.
Terms are lowercased and NFC-normalized. Offsets stay in the original text as
UTF-16 indices, so browser slicing remains correct when normalization changes
term length. Identifiers emit complete forms and camelCase or snake_case parts.

The compact English stopword list and six suffix rules keep the analyzer readable.
Stopwords leave positional gaps for phrase matching. This is not a complete
linguistic analyzer. Stemming can merge unrelated words or miss inflections;
languages without word separators need language-specific segmentation.

Query syntax includes quoted phrases, excluded words prefixed with `-`, all/any
matching, and source/repository/type/language filters. Prefix, one-edit typo, and
query-scoped synonym expansions are bounded. Arbitrary regexes, wildcard expressions,
and nested boolean trees are outside the grammar. API bounds limit query length,
expansions, result counts, pagination depth, scopes, and synonym payload size.

## Ranking and explanations

Baseline BM25 uses `k1 = 1.5` and `b = 0.75`:

```text
IDF = log(1 + (N - df + 0.5) / (df + 0.5))
contribution = IDF * tf * (k1 + 1)
               / (tf + k1 * (1 - b + b * length / averageLength))
```

Rare terms receive more weight. Frequency saturates; repetition does not increase
relevance linearly. Length normalization limits verbose documents' advantage.
Tuned ranking adds field and passage relevance. Each parent appears once, with
bounded matching passages.

Posting lists identify candidates before retrieval. Scopes, phrases, exclusions,
and matching mode narrow them. Results carry term contributions, original-field
snippets, line numbers, and PDF pages when extraction supplied page offsets.
Facets and groups describe matches before pagination. Grouped results distribute
visibility across repositories or sources; expanding a group applies its filter.

The inspector exposes actual posting/storage reads and stage timers. It does not
infer reads from candidate counts. A 128-entry cache with an estimated 8 MiB serialized UTF-16 byte budget can make storage
reads zero. The byte estimate excludes JavaScript object overhead. Posting IDs,
frequencies, token offsets, and field/window frequencies use packed typed arrays.
Interned removed terms remain until a rebuild or restart. Automatic storage
checkpoints avoid full-text cache serialization on each ingestion batch. Timings are local wall-clock samples, not a CPU profiler.

Literal mode matches case-sensitive original symbols and punctuation. Substring
mode ignores case without stemming. Both scan original text within a 2,000-document
and 8 MiB scope budget, and preserve source offsets. Narrow filters or a collection
when that budget is exceeded. Missing-match explanations distinguish semantic
failures from pagination. Rank lookup is bounded to the first 1,000 matches; an
uninspected omitted hit has an unknown rank, not a fabricated one.

## Workers, folders, and rebuilds

Production owns the Engine and storage lock in one worker. A bounded RPC queue
returns 503 on overload. HTTP health stays on the main thread. Bulk imports yield
between 16-document batches; reads can run between batches, while mutations stay
serialized. PDF extraction also runs in the worker. One large extraction, storage
operation, or common-term query can still block engine requests.

Managed folders use two-second metadata polling. Only changed files are read and
hashed, and unchanged polls do not snapshot the index. Git evaluates nested ignore
rules, including non-repository roots, through a separate managed Git directory.
Symlinks and escaped paths are rejected. A full successful scan is required before
missing files are deleted. Permission or extraction failure keeps last good
documents. Structured-file preflight completes before any changed-file reconciliation,
so a truncated JSON/JSONL record does not replace or delete prior records. The
changed-file staging budget is 256 MiB and rejects oversized batches before writes.
Folder removal checks ownership rather than deleting arbitrary IDs.

A rebuild creates a separate index and yields between analysis batches. Searches
continue on the active index. A storage-version check prevents publishing a stale
shadow; cancellation or failure retains the active index. A successful switch is
atomic in the worker. The temporary second index increases memory use.

## Imports and backups

Raw CRUD creates distinct documents. Ingestion uses stable `sourceId` values for
GitHub repositories, case-sensitive paths, Wikipedia page ids, and upload
filename/record ordinals. Unchanged content is a duplicate; changed content
replaces the same id. A different upload with the same filename and ordinal
deliberately targets the same identity. Use another filename to retain both.

The queue runs one import at a time and persists bounded history. GitHub fetches
have timeouts and repository/file budgets. Credentials stay in memory, never in
history. Restart marks unfinished jobs interrupted. Retry creates a new job;
deduplication makes completed batches reusable. Cancellation retains completed
batches. Extraction and storage batches cannot be interrupted mid-call. Scanned
PDFs without embedded text are skipped; there is no OCR.

Backup export preserves ids and complete documents. Restore validates all entries
and id conflicts before writing. Identical existing ids are duplicates; conflicting
ids fail instead of overwriting data. Restore merges instead of replacing the store.
Disk errors can leave completed writes. Retry after repairing the disk condition.
Browser saved searches and collections are outside engine backups.

The guided walkthrough owns a separate temporary demo worker and store. Its
durability action copies acknowledged records into another temporary store, kills
only that owned child writer with SIGKILL, then verifies WAL recovery. Normal
documents remain untouched, and temporary stores are removed on app shutdown.

## Measurements

`npm run evaluate` builds a temporary deterministic corpus and measures authored
synthetic relevance cases. MRR measures first relevant rank; nDCG compares ranked
gains with ideal gains at the same cutoff. These are regression expectations, not
held-out human judgments. Report baseline and tuned results together.

`npm run evaluate:fetch` and `npm run evaluate:real` load BEIR SciFact with external
expert-authored judgments. Report all 300 queries and both ranking profiles at
cutoff 10. Scientific abstracts are a separate domain from code search, and
field/passage ranking is not universally better. See [dataset attribution](DATASETS.md).

`npm run bench:concurrent` measures real loopback HTTP search and health requests
while importing. It checks that search streams observe partially indexed batches,
not merely that requests completed before the import response.

`npm run compare:fts -- 10000` reports 20 warm queries after three warmups, with
p50/p95, ingestion, restart, heap growth, and RSS. Python's in-memory SQLite FTS5
receives identical pre-tokenized text. SQLite returns ids; Shardly prepares snippets
and explanations. Tokenization setup, durability costs, BM25 constants, and tie
ordering differ. This is context, not an equal-work speed contest. SQLite BM25
returns lower numbers for better results. See the
[official documentation](https://www.sqlite.org/fts5.html#the_bm25_function).

`npm run bench -- /path/to/data` compares indexed and scan paths. Inspect the current
implementation when interpreting the scan. Cached documents, pre-tokenized data,
and cold reads measure different work. Old tables in the illustrated guide are
historical baseline measurements, not current tuned-engine claims.

`npm run crash-test` waits for acknowledgements, sends SIGKILL, reopens storage,
and checks every acknowledged id. It exercises process crashes, not physical
power loss, firmware lying about sync, or every filesystem behavior.

Current results and reproducible commands: [verification report](VERIFICATION.md).

## Deployment and limits

The supported deployment is one process and one local data directory. The API
binds to loopback, restricts browser origins, and rejects unrelated cross-origin
mutations. There is no user authentication. External exposure needs an authenticated
reverse proxy and an explicit allowed frontend origin.

Storage I/O remains synchronous inside the worker. Snapshots, compaction, large
extractions, and common queries can block engine requests. Packed postings remain
memory-resident, with no disk spill or compressed on-disk query blocks. Backup export and snapshots also materialize JSON.
Measure the real corpus before assuming a document count implies a memory ceiling.

The next scale change would be compact on-disk postings and bounded analysis of
individual large documents. Replication changes this personal project's operating model.
