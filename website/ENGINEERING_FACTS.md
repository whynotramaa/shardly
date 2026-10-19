# Engineering facts for the website

Checked against the working tree on 19 October 2026. This is the source ledger for the rewritten guide. The site describes shipped behavior, not every research recommendation. The full root suite passed 206 tests across 26 files before this rewrite.

| Published fact | Source and qualification |
| --- | --- |
| Storage and lexical search are hand-built TypeScript. | `src/storage/*`, `src/search/*`, `src/engine.ts`. Fastify, React, parsers and the MCP SDK are external dependencies. No whole-project zero-dependency or line-count claim. |
| One writer owns each data directory. | Storage lock and recovery tests. No replication or distributed consensus. |
| Records append to segment files; offsets identify exact byte ranges. | `Storage.planRecords`, `readAt`, `OffsetEntry`. A map lookup is constant time; reading/checking bytes scales with record size. |
| Segment rotation is 64 MiB. | `SEGMENT_MAX_BYTES` in `src/config.ts`. A MiB is 1,048,576 bytes. |
| Write order is pending WAL sync, segment sync, committed WAL sync, then publication/acknowledgement. | `Storage.writeWithId`, `writeBatch`, WAL methods. Batches share phase syncs, not one total sync per batch. |
| Pending intact writes can be recovered without a prior acknowledgement. | Storage recovery tests. Torn pending writes are discarded; corrupted committed data fails closed. |
| Checksums cover new records and snapshots retain record checksums. | Storage/WAL code. Legacy records may lack checksums until rewritten. Process kills are not physical power-loss tests. |
| Compaction copies live records to new segments and publishes a replacement offset snapshot. | `compactSteps`. Snapshot rename is the commit point; directory sync and rollback preserve consistency. Compaction yields every 16 live records. |
| Derived lexical snapshots rebuild when incompatible; a shadow rebuild checks storage generation before publication. | `Engine.hydrateIndex`, `rebuildIndex`, index analyzer marker. Rebuild holds both indexes temporarily. |
| English analysis has Unicode normalization, stopwords, simple stemming, identifier parts and original UTF-16 offsets. | `tokenizer.ts`. Ten explicit content locales use platform segmentation; no measured multilingual relevance claim. |
| Packed in-memory postings and field windows support baseline BM25 and tuned field/passage ranking. | `index.ts`, `Engine.search`. BM25 defaults k1=1.5, b=0.75. Explanations are built for selected hits; scoring still visits candidates. |
| Literal/substring scans stay bounded to 2,000 scoped documents and 8 MiB of UTF-16 text. | `Engine.searchLiteral`. This is not an indexed substring implementation. |
| Full-document cache caps are 128 records and an 8 MiB serialized-text estimate. | `Engine` fields. Metadata and postings remain memory-resident; these are not whole-process RAM caps. |
| Evidence references bind a document revision, field and UTF-16 span. | `evidence.ts`, `fetchEvidence`. Stale references cannot fetch old revisions; original field text differs from original Office/PDF bytes. |
| Retrieval search/fetch has 4–256 KiB response budgets, default 32 KiB. | `api/retrieval.ts`. Whole hits/items are dropped with truncation; search batch max 8, fetch max 20. Lexical cursors bind query/scope/generation. |
| Dense retrieval and reranking need configured endpoints and installed models. | `semantic.ts`. Exact cosine reference path, RRF/weighted fusion, bounded candidate reranking and fallback. No measured model-quality improvement. |
| Semantic limits are 20,000 passages, 4,096 dimensions, four million total vector components and a 128 MiB cache file. | `semantic.ts`. Whichever bound is reached first applies. Changed/deleted parent revisions are excluded. Backfill is explicit and staged. |
| Office, HTML, CSV/TSV, RTF, EML, EPUB and embedded PDF text have actual parser paths. | `ingest/extract.ts`, `formats.ts`, format tests. DOCX heading/table boundaries, slide/notes, sheet/cell/formula metadata; attachments need separate import. |
| Blank-page OCR is optional through installed Poppler/Tesseract tools. | `SHARDLY_OCR=1`, max 50 OCR pages. No confidence/bounding boxes or full complex-layout reconstruction. |
| Folder sources poll every two seconds, obey Git ignore rules, skip symlinks, and retain last-good data on failed preflight. | `folders.ts`. 10,000 supported files and 256 MiB staging budget. API-server paths, not browser file-system access. |
| Add/replace upload modes, namespaces, and stable record keys make identity explicit. | Upload routes/folders. Legacy API default replace; workspace default add. Upload replacement does not remove missing rows; folder sync does. Malformed NDJSON rejects extraction. |
| Engine worker RPC is bounded to 32 outstanding calls; bulk work yields every 16 documents. | `runtime/engine.ts`, `worker.ts`. Long synchronous queries can still occupy the worker. Queue wait is outside execution deadline. |
| Production extraction uses separate workers, concurrency 2, 256 MiB old-generation heap limit and 120-second timeout. | `runtime/extraction.ts`. Heap limit excludes some external allocations; OCR subprocess timeouts are independent. Inference HTTP runs outside the engine worker. |
| Optional admin/read tokens provide static server-owned scopes. | `api/auth.ts`, filters. Reader access is restricted to scoped POST retrieval and GET status/ready. Legacy GET search is administrator-only. No account system or connector ACL synchronization. |
| Read-only MCP exposes search/fetch/status over the running API. | `src/mcp.ts`, SDK integration test. It does not open a second writer or execute source instructions. |
| Portable browser workspace state can explicitly save/load on the server. | Workspace API/UI. Server-owned state is included in backups; browser-only preferences are not automatically shared. |
| Streaming backup has checksummed NDJSON, complete preflight and merge semantics. | `stream-backup.ts`. Restore cap 256 MiB/100,000 documents; I/O failure or racing conflicts can leave completed additions. Derived vectors are rebuilt. |
| Repository tuned nDCG@10=.861; baseline=.826. SciFact baseline=.675; tuned=.595. | `benchmarks/retrieval-2026-10-19.json`. 24 authored repository tasks; 300 external SciFact judgments. Different domains, not universal superiority. |
| 178,369 acknowledged writes survived eight SIGKILL rounds in the recorded drill. | Same report and `VERIFICATION.md`. A recorded run, not a new hardware guarantee. |
| The concurrent-import sample used 3,000 documents and 40 searches; search p95 was 9.15 ms. | Same report. Loopback, bounded single-machine sample, not capacity. p95 means 95% of samples finished within that duration. |
| Graph, learned-sparse, late-interaction, multimodal search, scheduled connectors and full layout extraction remain unshipped or partial. | `IMPLEMENTATION.md`. The guide must not imply otherwise. |

## Editorial and visual direction

The reader follows a document from ingestion to durable bytes, then to search and revision-checked evidence. Definitions arrive when used. Figures use illustrative data and clearly label slowed playback. Recorded benchmark numbers come from the checked-in report. The approved mockup replaces Newsreader with local Coconat while preserving Syne, Geist Mono, warm paper/charcoal, blue/peach accents and technical line drawings. The sidebar is a slim tick rail with chapter previews on hover or keyboard focus. Header text is 2 px smaller than the initial mockup. Backgrounds are plain; reading text is larger and constrained to a readable measure. Motion is bounded, pausable, offscreen-aware and reduced-motion safe. No new video runtime or image dependency is needed for interactive SVG illustrations.

Writing follows `/home/banana/Work/blogs/WRITING-DNA.md`. The public site links source files and documents without exposing that local path.
