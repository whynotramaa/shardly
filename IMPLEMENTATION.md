# Research implementation status

Updated 19 October 2026. This ledger follows [SEARCH_RESEARCH.md](SEARCH_RESEARCH.md). The research explicitly gates several expensive directions on workloads and measured improvements. Those gates are preserved here. This working tree does **not** implement every experiment in that report and does **not** establish market superiority.

Read [AGENT_SEARCH.md](AGENT_SEARCH.md) for configuration, API contracts, privacy, and operating limits. Existing user edits were preserved; no commit or deployment was made.

“Implemented” means a working path with regression or integration coverage. “Partial” names a concrete remaining part. “Gated” means the report requires evidence or a selected workload before implementation. Provider-contract tests are not model-quality evaluations.

| Recommendation | Status | Delivered behavior and remaining work |
| --- | --- | --- |
| R01 MCP | Implemented | Official SDK stdio server; read-only search/fetch/status tools proxy the existing API. Real SDK client integration test. No second writer. |
| R02 concise search | Implemented | POST search/retrieve, evidence projection, source metadata, per-stage ranking scores, schema version. Existing GET response remains compatible. |
| R03 durable references | Implemented | Parent revision + field/span reference, UTF-16 offsets, original field-text fetch, stale/deleted/version race checks, restart coverage. Old versions are not retained. |
| R04 context budget | Implemented | Hard serialized byte budget, bounded evidence hits, whole-item truncation, overlap/text deduplication, truncation flag. Character-bounded snippets, not model-token accounting. |
| R05 batch search | Implemented | At most eight searches; independent errors and scope enforcement. |
| R06 explicit state | Implemented | Complete/no matches, incomplete generation/import, index changed, degraded inference, stale/not-found fetch states. Readiness and strategy discovery. |
| R07 parsed structure | Partial | Versioned Markdown heading/fence blocks, original field spans, PDF pages, Office conversion metadata. Full layout trees and complex table/source-image coordinates remain absent. |
| R08 structured chunks | Partial | Reproducible heading-aware character-bounded chunks, parent identities, parser/chunker/model fingerprints, Unicode-safe boundaries. Model-token sizing and held-out chunk-size comparisons remain. |
| R09 OCR/PDF | Partial | Optional Poppler/Tesseract blank-page OCR, page coordinates in extracted text, explicit parser mapping, subprocess limits. Docling/Unstructured comparison, confidence and bounding boxes remain. |
| R10 Office/email | Partial | DOCX/PPTX/XLSX, MIME EML, EPUB; DOCX heading levels and table-cell boundaries; slide/notes, sheet/cell/value/formula, sender/date/subject/attachment metadata. Fixtures cover each format. No attachment recursion, MSG, or complete Office layout reconstruction. |
| R11 HTML/CSV/RTF | Implemented core | Visible HTML text excludes executable/hidden markup; multiline quoted delimited records retain headers/rows; actual RTF parser. RTF tables and HTML link graph are not preserved. |
| R12 diagnostics | Implemented core | Upload parser/status/reason/warnings; conversion metadata; source scan status; NDJSON failure documentation corrected. Detailed OCR per-page confidence unavailable. |
| R13 source identities | Implemented core | Add/replace upload mode, import namespaces, stable record keys with batch preflight, folder reconciliation. Browser defaults to adding same-name variants; legacy API replacement default retained. Upload replace does not delete missing rows. |
| R14 derived revisions | Implemented | Semantic staging/version checks, changed/deleted parent rejection, compatible-input reuse, cache fingerprints, restart behavior. Backfill is explicit rather than automatic. |
| R15 connector freshness | Partial | Folder attempted/successful sync status, last-good behavior and modification metadata; existing restartable import jobs. Scheduled GitHub mirroring, resumable incremental connectors and permission sync remain. |
| R16 website ingestion | Gated | No crawler added. The report requires a selected website workload, bounded source lifecycle and destination-policy tests first. One-off unsafe URL fetching was not substituted. |
| R17 dense reference | Implemented adapter | Exact normalized-vector retrieval, bounded passage/component/dimension/cache budgets, scope/revision intersection, persistent derived cache. Real model quality is unmeasured. |
| R18 runtime/model choice | Configuration required | Ollama and OpenAI-compatible embedding adapters; explicit model/revision config; provider credentials remain private environment values. No model downloaded or chosen without corpus evaluation. |
| R19 hybrid fusion | Implemented | RRF and normalized weighted fusion, bounded independent candidate sets, semantic-only candidates, deterministic deduplication. |
| R20 reranker | Implemented adapter | Bounded candidate-pool reranking before final page selection, candidate mapping validation, timeout and initial-ranking fallback. Real inference quality/cost requires configured service. |
| R21 context | Implemented core | Title and heading context added to embedding inputs; indexed source text remains the returned evidence. No generated contextual summaries. |
| R22 strategies | Implemented | Lexical/dense/hybrid API and UI, explicit rerank option, exact/literal constraints stay lexical, discoverable status and fallback warnings. |
| R23 typed filters | Implemented | Nested Boolean allowlisted metadata filters, typed comparisons, prefixes, arrays; quoted inline metadata values; bounded validation. |
| R24 field policy | Implemented core | Reserved searchable-field allowlist; policy/access/extraction metadata excluded from tokenization; fixed filterable metadata allowlist; complete documents retained in storage. Whole-batch policy validation precedes writes. |
| R25 language analysis | Partial | Ten explicit locales, platform word segmentation, no English stemming on other locales, original UTF-16 offsets, Chinese/Unicode regression coverage. No multilingual quality benchmark or morphological analyzers. |
| R26 query expansion | Implemented core | Adjacent-transposition typo support, minimum four-character alphabetic typo terms, existing bounded prefix/synonym paths. No broad fuzzy-query expansion. |
| R27 diversity | Partial | Existing repository/source round-robin grouping plus evidence overlap/text deduplication and parent-level dense ranking. No semantic MMR or duplicate-document clustering. |
| R28 code retrieval | Partial | Existing identifier/path/line-aware lexical search, Markdown fenced blocks, exact symbol text, version-checked citations. Compiler/AST symbol definitions and references remain gated on a chosen language. |
| R29 authority/recency | Gated | Source modification metadata is filterable and visible. No universal recency or popularity boost was introduced without dated/current-policy task judgments. |
| R30 iterative search | Implemented external-agent path | MCP search/fetch can be repeated under the same scope; bounded batch API. Server-generated subqueries remain gated as recommended. |
| R31 candidate performance | Partial | Evidence-only payloads, optional facets, bounded top heaps, scalar candidate scoring and winner-only explanation construction. Exact scoring/explanation parity checked over 288 query/profile/group/page combinations. Every candidate still scans its field windows; approximate staged ranking remains gated on quality measurements. |
| R32 budgets/cancel | Partial | Query work/deadline checks, bounded RPC queue, explicit 422 failures; inference abort signals; indexing cancellation. Synchronous searches are not cooperatively interruptible by a later cancellation message; queue delay is outside execution deadline. |
| R33 substring index | Gated | Correct bounded original-text scan retained (2,000 documents / 8 MiB). No trigram index or raised limits before index-memory and Unicode-parity measurements. |
| R34 disk index | Gated | Existing packed postings, selected-metadata document map, bounded full-document cache and profiling script retained. No disk-index migration without demonstrated memory/startup need. |
| R35 pagination | Implemented | Lexical generation/query/scope-bound cursors, stale-generation rejection; bounded candidate strategies explicitly lack exhaustive cursors. |
| R36 streaming backup | Implemented | Checksummed NDJSON export, bounded-page reads, complete stream validation/spooling before restore, id conflict checks, server workspace inclusion, retry-safe merge semantics. 256 MiB restore cap is explicit. |
| R37 runtime isolation | Implemented | Production file parsing in separate bounded workers, provider HTTP inference outside engine worker; engine mutation ordering retained. External OCR subprocesses have independent timeouts. |
| R38 diagnostics | Partial | Request IDs, rolling bounded HTTP p50/p95/p99/error sample, memory, readiness, semantic generation/progress and existing engine stage timings. No durable tracing, RPC queue histogram or inference billing telemetry. |
| R39 exclusions | Implemented | Default secret/key/generated-directory exclusions on uploads/folders/deep GitHub, explicit trusted-local override for uploads/folders, test coverage. |
| R40 authentication | Implemented local/shared-token boundary | Optional admin bearer token, scoped reader keys, loopback default and non-loopback startup guard, origin controls, browser session token entry. No accounts or multi-user administration. |
| R41 authorization | Implemented static document scopes | Server-owned tenant/principal/source scopes intersect lexical, literal, dense and fetch paths; secondary admin endpoints denied to readers. Connector ACL sync and revocation events are not implemented. |
| R42 untrusted text | Implemented | Read-only MCP annotations/tool set, explicit evidence warnings, no execution/evaluation of document instructions, SDK integration with adversarial text. No claim of an LLM-level injection defense. |
| R43 workspace | Implemented | Validated portable browser export/import, explicit durable server save/load, collection search and backup inclusion, restart/roundtrip tests. No cross-device automatic conflict resolution. |
| R44 coverage UI | Partial | Parser/warning details in imports, folder freshness, meaning-index state/progress, result fallback warnings and revision-checked previews. Per-page extraction coverage and source-image preview overlays remain. |
| R45 answers | Search boundary implemented | Source evidence remains separate and usable by an external agent. No generated answers, claim verifier or answer-evaluation pipeline is advertised. |
| R46 accessibility | Implemented core verification | Existing keyboard/search controls preserved, labeled strategy/language/access controls, status/error announcements, desktop/mobile overflow and browser runtime checks. No full screen-reader audit. |
| R47 judgments | Partial | Frozen 24 authored repository tasks plus 300 external SciFact judgments retained and rerun. Human held-out personal-document tasks require users; authored labels are not presented as human feedback. |
| R48 comparisons | Partial | Reproducible baseline/tuned evaluations and existing SQLite FTS5 harness. No newly run Tantivy/Lucene/vector-system end-to-end comparison or broad superiority claim. |
| R49 agent evaluation | Partial | Real SDK search→fetch/status, revision changes, scopes and untrusted content contract tests. No model-driven task-completion/answer-faithfulness benchmark. |
| R50 sparse/late interaction | Gated experiment | Requires held-out comparisons and storage/latency measurements after the dense baseline; not shipped as an untested retriever. |
| R51 tree/graph | Gated experiment | Requires multihop workload, evidence-preserving graph construction and measured task gains. No graph database or generated hierarchy added. |
| R52 multimodal | Gated experiment | Requires image/table tasks, privacy decisions and a selected model after OCR evaluation. No speculative image embedding path added. |

## Verification for this working tree

The regression suite, TypeScript build, frontend builds, format fixtures, MCP SDK, access scopes, source/version races and backup roundtrips are recorded in [VERIFICATION.md](VERIFICATION.md). Relevance measurements reproduce the existing domain distinction: tuned ranking wins on the small authored repository set; baseline BM25 wins on SciFact. Inference adapters use a deterministic fake provider in tests and must be evaluated with an actual model before claiming relevance improvements.

Remaining work is explicit above. In particular, automatic connectors, full PDF/Office layout recovery, query-interruptible execution, larger substring indexes, human judgments, and advanced model experiments are not complete. These are meaningful additions, not interchangeable checkboxes that can be honestly marked done without their data, models and release gates.
