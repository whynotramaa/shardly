# Verification

Verified on 12 October 2026, Linux x64, Node v26.7.0. Tests, benchmarks, folder fixtures, and demonstrations used isolated stores. The existing `data/` directory was not used. No commits or contributor attribution were added.

## Build and correctness checks

- `npm test`: 173 tests across 20 files.
- `npm run build`: engine/API TypeScript build. Compiled `node dist/src/api/server.js` verified worker boot, literal whitespace parity, isolated demo search and SIGKILL recovery, with the normal backup unchanged.
- `cd web && npm run build`: production app build and type checks.
- `cd website && npm run build`: illustrated engineering guide build.
- `npm run crash-test -- 8`: 225,141 acknowledged writes survived eight SIGKILL rounds with zero loss or corruption. [Raw crash report](benchmarks/crash-next.txt).
- `npm run evaluate`: 80 authored query/options regressions; baseline nDCG 0.826, field/passage nDCG 0.996. Restart result parity passed. [Raw report](benchmarks/relevance-next.json).

Tests cover packed posting updates and cache recovery, Unicode/symbol offsets, actual storage-read counts, cache eviction, bounded literal scans, missing-match reasons, shadow rebuild cancellation/failure/version checks, worker queue bounds and write serialization, folder ignore/rename/delete/read failures, and real isolated demo SIGKILL replay.

Independent review identified a partial-JSONL folder reconciliation bug and HTTP trimming of literal queries. Regression tests now verify last-good records survive malformed structured-file rescans and query whitespace remains identical across search, comparison, explanations, and demo routes.

## External relevance judgments

`npm run evaluate:fetch` verifies and caches the published BEIR SciFact archive. `npm run evaluate:real` uses all 5,183 real abstracts and 300 externally judged queries, with unchanged expert-authored labels.

| Ranking | MRR@10 | nDCG@10 | Recall@10 |
| --- | --- | --- | --- |
| BM25 | 0.641 | 0.675 | 0.811 |
| Fields and passages | 0.564 | 0.595 | 0.723 |

BM25 performs better on this scientific-abstract domain. The authored regression suite and this external benchmark measure different tasks; neither establishes a universal ranking advantage. The UI exposes both profiles. [Per-query results](benchmarks/scifact.json) and [dataset attribution/methodology](DATASETS.md).

## Performance and responsiveness

The deterministic short-document comparison uses identical documents and queries, three warmups, 20 samples, and a pre-tokenized linear scan that asserts baseline top-ten agreement. Python SQLite FTS5 receives identical pre-tokenized text and returns IDs; Shardly also returns documents, passages, and explanations. Ranking semantics and work differ.

| 100,000 documents | Previous version | Current version |
| --- | --- | --- |
| Ingestion + snapshot | 32.78 s | 4.69 s |
| Restart | 4.43 s | 3.99 s |
| Node heap growth after ingestion | 1757 MB | 815 MB |

The current ingest measurement additionally reports 46 MB external allocation, including typed arrays. Heap growth is GC-sensitive, excludes external allocations, and is not retained heap or peak total RAM. CPU contention and filesystem cache affect timings. Matching-query p95 for field/passage ranking was 47.2–50.3 ms.

[Previous 100k report](benchmarks/fts-100000.json) · [Current 100k report](benchmarks/fts-next-100000.json) · [Current 10k report](benchmarks/fts-next-10000.json). Reproduce with `npm run compare:fts -- 100000`.

`npm run bench:concurrent` imported 3,000 documents through real production-worker HTTP while 40 health and 40 search requests ran concurrently. 39 search streams observed partially indexed batches. Health p95 was 4.95 ms and search p95 was 9.46 ms. The reference document stayed searchable throughout. [Raw concurrent report](benchmarks/concurrent.json). This is a bounded local workload, not a multi-user capacity guarantee.

## Frontend verification

Production Chromium checks cover Search, Sources, Library, and Engine at desktop 1440×1000 and mobile 390×844, with light/dark search states and no horizontal overflow. Functional checks passed inline saved searches, named collection creation/rename and titled membership, URL/history, facets, comparison, late original-offset preview/document jumps, literal symbols, titled missing-match explanations, keyboard suggestions/result navigation, rebuilds, diagnostics, backup download, keyboard restore, and repeated same-file restore.

Folder UI checks passed creation, ignores, pause, forced rescan, resume, and ownership-scoped removal while leaving disk files untouched. The guided demo passed explicit seeding, separate search/ranking, repeated-import deduplication, and real SIGKILL recovery in an additional temporary store. A before/after backup proved normal documents unchanged. No page errors were observed.

The T3 preview host explicitly reported no automation host on this headless environment. Checks used the installed Chromium and cached Playwright package, without adding a dependency. A bounded independent visual review found four issues. After one correction batch and settled desktop/mobile recaptures, the reviewer scored the four fixes resolved in source; root separately verified keyboard restore live.

DESIGN.md records the finished composition and existing tokens. The design context loader reported no visual implementation or surface brief despite the verified production routes; its pre-existing configuration discrepancy was left unchanged.

## Remaining limits

The engine is local, single-writer and memory-resident. Packed arrays reduce overhead; analysis, metadata and interned terms still consume memory. Deleted interned vocabulary is reclaimed on rebuild/restart. Rebuilding temporarily holds two indexes. One large document, extraction, compaction or common-term query can block engine requests despite HTTP-thread isolation.

Original-text literal/substring scans are bounded to 2,000 documents and 8 MiB. Missing-match exact rank inspection stops at the first 1,000 results. Folder synchronization polls metadata every two seconds; explicit rescan rehashes. JSON identities use record ordinals, so array reordering updates those positions. Git is required when a watched folder contains ignore rules. Reset requires watched folders to be paused. Folder staging has a 256 MiB serialized-memory estimate budget, not a hard process heap limit; an oversized change batch fails safely and needs a narrower folder scope.

Scientific relevance judgments do not establish personal-document or code-navigation quality. Live private GitHub credentials were not tested. SIGKILL tests do not simulate physical power loss. Backup restore is not transactional under disk failure, browser preferences are outside engine backups, and a crashed lock-reclamation guard may need manual removal after checking for a live writer.

OCR and AI chat remain excluded.
