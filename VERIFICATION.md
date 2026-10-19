# Verification

## Research implementation, 19 October 2026

All checks used temporary stores; normal `data/` was not used. See [raw retrieval verification](benchmarks/retrieval-2026-10-19.json), [setup and limits](AGENT_SEARCH.md), and the [complete recommendation ledger](IMPLEMENTATION.md). The earlier section below records the pre-expansion baseline.

- Engine TypeScript build and both Next.js production builds pass. The expanded suite has 204 tests across 25 files. The regression suite covers API compatibility, scoped retrieval and denied legacy routes, typed filters/cursors, batch policy validation, revisions across updates/deletes/restart, semantic cache/provider mappings/fallbacks, candidate-pool reranking, extraction isolation, structured formats, MCP SDK interaction, and streaming backup/workspace restore.
- Real format fixtures cover DOCX headings/table cells, PPTX slide/notes relationships, XLSX cells/formulas, visible HTML, quoted multiline CSV, MIME email, RTF, and EPUB spine order. A generated image-only PDF is skipped with OCR off and correctly recognized with actual installed Poppler/Tesseract when enabled. The OCR test is explicitly skipped on machines without those tools. This single-page fixture does not validate complex layout quality.
- Root `npm audit` reports zero vulnerabilities. Vitest was upgraded to 5.0.5; supported root Node versions are now 22.12+, 24, and 26+. Dependency updates do not prove the application has no security defects.
- Main API scoring now builds explanations only for returned hits; evidence-only requests omit that work unless inspection is requested. A captured before/after harness verified exact scores, breakdowns, facets, groups and pages across 288 combinations of the frozen queries, both profiles, three grouping modes and two offsets. This removes explanation allocation from losing candidates without approximate ranking. Window scans still visit all candidates.
- The 24 authored repository tasks reproduce BM25 MRR/nDCG/recall of 0.823/0.826/0.979 and tuned 0.889/0.861/0.979, with restart parity. All 300 SciFact queries reproduce baseline 0.641/0.675/0.811 and tuned 0.564/0.595/0.723. No new model-quality or market-superiority claim follows from adapter tests.
- Eight SIGKILL rounds preserved 178,369 acknowledged writes with zero missing/corrupt records. Physical power-loss behavior is not established by process kills.
- At 3,000 documents, 18 of 40 HTTP search replies completed before compaction resolved. Search p95 was 5.93 ms and max 20.49 ms. The benchmark now establishes its HTTP connection before posting maintenance: earlier cold-connection runs finished compaction before the first search arrived and failed the overlap assertion. Warm-connection measurements are not comparable to historical cold-start maxima.
- Concurrent 3,000-document import completed 40 searches while importing; 39 stats checks observed partial imports. Search p95 was 9.15 ms and health p95 3.88 ms. These are small loopback samples, not capacity guarantees.
- Chromium checks covered landing/Search/Sources/Library/Engine at 1440×1000 and 390×844 with no horizontal overflow or page JavaScript errors. Seeded search, strategy switching, visible semantic fallback, mobile scrollable options, and import identity/language controls passed. The Impeccable detector returned no findings for changed UI targets. Native preview snapshots timed out twice; the browser plugin reported no available browser, so smoke checks used installed Chromium/cached Playwright without adding dependencies. This is not a full accessibility audit.
- Models were not downloaded and remote inference was not enabled. Provider contracts use a deterministic local fixture service. OCR requires installed tools; semantic/reranker quality requires actual model evaluations. Scheduled connectors, full layout reconstruction, advanced graph/sparse/multimodal experiments and other partial items remain explicit in the ledger.

## Earlier baseline update, 19 October 2026

The following changes were checked in isolated stores on Linux x64 with Node v26.7.0. The existing `data/` directory was not used. [Raw measurements](benchmarks/improvements-2026-10-19.json).

- Tests: 180 across 20 files, including shared frequency tables, reads during compaction, queued worker writes, direct mutation rejection, async compaction failures before and after snapshot rename, and SIGKILL at a compaction yield.
- Builds: engine/API, `web/`, and `website/` production builds pass.
- Relevance: all 80 synthetic regressions pass. The new frozen repository evaluation covers 20 actual source/documentation files and 24 authored tasks. BM25 nDCG@10 is 0.826; fields and passages is 0.861. Both profiles preserve results after restart. [Per-query results](benchmarks/relevance-workspace.json).
- External relevance: all 300 SciFact queries retain exactly the previous MRR, nDCG, and recall for both profiles. BM25 still wins on that corpus. Repository-task judgments are provisional and do not substitute for real-user or private-document judgments.
- Memory: a 10,000-document allocation probe reports retained heap growth of 69.45 MB before and 60.99 MB after, about 12% lower. Packed frequency allocation falls from 1.44 MB to 0.72 MB by sharing identical field/window tables. Token offsets and long-passage frequencies remain separate where needed. Retained heap uses forced GC and excludes external allocations; the raw report includes external and array-buffer memory. These are single local samples.
- Maintenance: compaction now yields every 16 live records. In an ordered comparison, the original engine completed zero HTTP searches before compaction resolved; the revised engine completed four. Maximum observed search latency was 46.0 ms before and 28.6 ms after. The 40-sample p95 increased from 2.5 ms to 15.9 ms because the revised engine serves requests throughout maintenance. This demonstrates interleaving, not a general latency improvement. Snapshot commits and individual large records remain synchronous.
- Recovery: 82,740 acknowledged writes survived three SIGKILL rounds with no missing or corrupt records. A separate regression kills the process while async compaction is suspended and verifies recovery of every live record.
- Browser: local Chromium verified an empty library, a skipped upload, successful Markdown upload, refreshed counts, verified example links, keyboard navigation into results, idle-search examples, and an optional examples-request failure. Desktop 1440×1000 and mobile 390×844 layouts passed without horizontal overflow or page errors. Dark and light states were inspected. The T3 preview opened, but snapshot calls timed out twice, so verification used installed Chromium with the cached Playwright package. No dependency was added. The Impeccable detector reported no findings.
- Automation: push and pull-request workflows cover tests, builds, and both authored relevance suites. A manually triggered workflow runs the expensive benchmarks and uploads artifacts. The workflow jobs have not run on GitHub in this session.

The remaining sections record the 12 October baseline. The update above supersedes overlapping measurements and compaction limits.

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

Scientific relevance judgments do not establish personal-document or code-navigation quality. Live private GitHub credentials were not tested. SIGKILL tests do not simulate physical power loss. Backup restore is not transactional under disk failure, browser-only preferences are outside engine backups unless explicitly saved to the server, and a crashed lock-reclamation guard may need manual removal after checking for a live writer.

Optional OCR is now supported as described above. Generated answers remain excluded.
