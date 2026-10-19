# Shardly search research and roadmap

Research date: 19 October 2026. Repository baseline: `b63d56f0574efe6fcbd8aed7d060e3fdb2006005`, including the uncommitted working-tree changes present during inspection.

This report treats Shardly as a document and code retrieval engine that people and search agents can use. It also covers what the landing page should demonstrate. This report records the pre-implementation research baseline. The subsequent implementation is tracked separately in [IMPLEMENTATION.md](IMPLEMENTATION.md), with setup in [AGENT_SEARCH.md](AGENT_SEARCH.md). Statements under “What already exists” describe the inspected baseline, not the expanded working tree.

The research covers 31 related products, projects, and frameworks, plus retrieval papers, model documentation, protocol specifications, and evaluation methods. Sources are first-party documentation, original repositories, or papers. This is a broad, selected survey, not a claim to have inspected every search project on the Internet. Competitor capabilities are documented capabilities, not independently benchmarked results. Availability can differ between local, hosted, and enterprise editions.

## Recommended direction

Build Shardly into a reliable local retrieval service with a small agent interface, strong exact search, optional hybrid search, and evidence that resolves to the original document version.

The highest-value additions are:

1. A read-only MCP interface and a concise, versioned retrieval API.
2. Durable passage identities, source versions, and citations that survive a search-to-fetch workflow.
3. Structure-aware parsing and chunking, followed by optional semantic retrieval and measured rank fusion.
4. A bounded reranking stage, with lexical fallback and separately reported latency.
5. A larger held-out evaluation set drawn from the document and code tasks Shardly is meant to solve.
6. Explicit field selection, structured filters, and source freshness reporting.
7. Measured improvements to candidate processing, original-text search, startup, and memory use.

Retain the hand-built lexical engine and storage system. They are useful functionality and central to the project's engineering purpose. Treat external parsers and inference runtimes as optional additions. Replacing the whole engine with an existing search database would change the project's premise.

"Best" needs a defined workload. A local code search tool, an OCR-heavy research library, and an enterprise knowledge service have different requirements. Feature parity with their combined catalogs is not a useful release criterion. Require better task success within a stated latency, memory, privacy, and operating-cost budget.

## Reading guide

- [What already exists](#what-already-exists)
- [What the evaluations establish](#what-the-evaluations-establish)
- [Related projects and what to adapt](#related-projects-and-what-to-adapt)
- [Detailed recommendations](#detailed-recommendations)
- [Proposed retrieval architecture](#proposed-retrieval-architecture)
- [Agent API contract](#agent-api-contract)
- [Evaluation and release criteria](#evaluation-and-release-criteria)
- [Implementation sequence](#implementation-sequence)
- [Landing page and documentation](#landing-page-and-documentation)
- [Choices to postpone](#choices-to-postpone)
- [Evidence and limitations](#evidence-and-limitations)

## What already exists

These are code-inspection findings, not assumptions based on competitor checklists.

| Area | Existing implementation | Relevant evidence |
| --- | --- | --- |
| Storage | Append-only segments, checksummed records, WAL recovery, direct offset reads, tombstones, snapshots, single-writer locking, backup and restore | [Storage](src/storage/storage.ts), [WAL](src/storage/wal.ts), [hardening tests](tests/storage-hardening.test.ts) |
| Lexical retrieval | Packed postings, BM25, baseline and tuned ranking, field weights, overlapping passage windows, bounded top-result heaps | [Engine](src/engine.ts), [index](src/search/index.ts), [ranker](src/search/rank.ts) |
| Query controls | Quoted phrases, exclusions, all/any matching, four metadata filters, document scopes, prefix expansion, bounded one-edit typos, query-scoped synonyms | `Engine.search`, `parseQuery`, [API validation](src/api/validation.ts) |
| Original-text search | Case-sensitive literal and case-insensitive substring modes, with original UTF-16 offsets | `searchLiteral` in [engine](src/engine.ts), [engine tests](tests/engine-next.test.ts) |
| Evidence display | Snippets, multiple passages, match offsets, line information, PDF page information, per-term score explanations, missing-match inspection | [Types](src/types.ts), `makePassages`, `explainMissing` |
| Result navigation | Facets, source/repository grouping, split preview, query URLs, saved searches, browser-local collections | [Search view](web/components/SearchView.tsx), [workspace](web/app/app/page.tsx), [web API](web/lib/api.ts) |
| Ingestion | JSON, JSONL, UTF-8 text/code, embedded-text PDF extraction, GitHub imports, offline Wikipedia, stable source upserts and content deduplication | [Extraction](src/ingest/extract.ts), [GitHub](src/ingest/github.ts), `ingestDocuments` |
| Folder synchronization | Polling, Git ignore evaluation, containment checks, symlink avoidance, staged reconciliation, last-good records on parsing failure, source-owned deletion | [Folders](src/ingest/folders.ts), [folder tests](tests/folders.test.ts) |
| Runtime | Worker-owned engine, bounded RPC queue, serialized mutations, import batching, shadow rebuilds, cancellation and version checks | [Runtime](src/runtime/engine.ts), [worker](src/runtime/worker.ts), `rebuildIndex` |
| Compaction | Current checkout has cooperative compaction that yields between record batches, plus an HTTP concurrency benchmark | `compactAsync` in [storage](src/storage/storage.ts), [maintenance benchmark](scripts/bench-maintenance.ts) |
| Evaluation | Synthetic regressions, a frozen repository task set, external SciFact judgments, restart parity, SQLite FTS5 comparison, crash and concurrency scripts | [Dataset methods](DATASETS.md), [scripts](scripts/), [verification](VERIFICATION.md) |
| Automation | Current working tree includes correctness/build CI, workspace evaluation, and manually triggered benchmarks | [.github workflows](.github/workflows/) |

Important current boundaries:

- There is no embedding index, semantic retriever, neural reranker, or MCP server in the inspected implementation.
- PDF extraction preserves pages but does not provide OCR, layout analysis, table structure, or source-image coordinates.
- Most other text formats enter as raw UTF-8. Listing `.html`, `.rtf`, or `.csv` as text extensions does not mean that Shardly understands their structure.
- `documentFields` recursively flattens JSON values into top-level fields. Internal metadata and content do not have separate indexing policies.
- The four indexed metadata dimensions are `source`, `repo`, `type`, and `language`. Arbitrary typed filters and nested Boolean expressions are absent.
- Ordinary text search defaults to the tuned profile unless `profile: "baseline"` is selected. That default is not evidence that tuned ranking is best for every corpus.
- Full lexical scoring still visits matching candidates. A top-result heap limits sorting work; it does not make candidate processing sublinear.
- The index is memory-resident. The current `docs` map retains selected metadata, not every full document. A separate bounded cache retains full documents. Startup still reads live documents to rebuild analysis and metadata.
- Literal/substring search has a 2,000-document and 8 MiB scope budget. Exact rank inspection is bounded to the first 1,000 matches.
- Folder scans reject more than 10,000 supported files and limit changed-file staging to 256 MiB.
- The supported deployment is one local writer. The API has origin restrictions and a loopback default, but no user authentication or document-level authorization.
- Saved searches and collections live in browser storage and are absent from engine backups.

These boundaries identify what to extend. Existing phrase search, facets, deduplication, compaction, tests, and synchronization should not appear in a backlog as wholly missing features.

## What the evaluations establish

Both commands below were rerun successfully on 19 October 2026. They use temporary stores and leave the user's document store untouched.

```bash
npm run evaluate:workspace
npm run evaluate:real
```

| Dataset | Profile | MRR@10 | nDCG@10 | Recall@10 |
| --- | --- | ---: | ---: | ---: |
| Repository tasks, 20 frozen files and 24 authored queries | BM25 | 0.823 | 0.826 | 0.979 |
| Repository tasks | Fields and passages | 0.889 | 0.861 | 0.979 |
| SciFact, 5,183 abstracts and 300 externally judged queries | BM25 | 0.641 | 0.675 | 0.811 |
| SciFact | Fields and passages | 0.564 | 0.595 | 0.723 |

The workspace evaluator also verified restart ranking parity. These results reproduce the domain distinction documented in [DATASETS.md](DATASETS.md).

Interpretation:

- Keep both ranking profiles. The repository tasks support retaining tuned ranking for developer search.
- The SciFact nDCG difference is approximately 0.080 in BM25's favor. A blanket "improved ranker" claim would be wrong.
- The repository task judgments are provisional authored labels over a small corpus. They do not establish personal-document or real-user superiority.
- SciFact measures scientific-claim retrieval. It does not establish code navigation, scanned-PDF quality, or agent task completion.
- The existing external labels are useful evaluation data. Do not repeatedly tune against the same test labels and continue calling the result held out.

The original BEIR paper also found BM25 a strong baseline and described quality/cost tradeoffs for reranking and late interaction. That supports benchmarking several retrieval strategies rather than assuming dense search wins. [BEIR paper](https://arxiv.org/abs/2104.08663).

## Related projects and what to adapt

The final column is a recommendation for Shardly, not a claim that another project's implementation can be copied without changes. Product editions, models, and dependencies need their own license and deployment review before adoption.

### Local search and embedded engines

| Project and primary source | Relevant documented capability | What Shardly should adapt |
| --- | --- | --- |
| [QMD](https://github.com/tobi/qmd) | Local BM25, vector search, query expansion, rank fusion, reranking, CLI and MCP retrieval | Study the agent workflow and concise document fetches. Compare quality and total resource use on the same corpus. This is one of the closest product references. |
| [Recoll](https://recoll.org/pages/features.html) | Desktop full-text search with many document handlers and document-oriented navigation | Treat format coverage, explicit extraction dependencies, and opening the original document as product requirements. |
| [Orama](https://github.com/oramasearch/orama) | JavaScript full-text, vector, and hybrid retrieval | Use as a relevant JavaScript comparison. Learn its integration ergonomics without replacing the hand-built engine by default. |
| [SQLite FTS5](https://www.sqlite.org/fts5.html) | Full-text indexing, BM25, phrases, prefix indexes, trigram tokenizer | Extend the existing comparison and study a verified trigram candidate index for substring search. |
| [Tantivy](https://github.com/quickwit-oss/tantivy) | Lucene-inspired indexing, compressed postings, mmap, analyzers, fast fields | Study disk-backed segments and typed filter indexes when memory and startup measurements justify them. |
| [LanceDB](https://docs.lancedb.com/search/hybrid-search) | Combined full-text/vector search and configurable reranking | Consider an optional vector-side experiment. Its existing retrieval should not silently replace Shardly's lexical results. |
| [LEANN](https://github.com/StarTrail-org/LEANN) | Local vector retrieval with selective embedding recomputation to reduce stored vectors | Evaluate storage-versus-inference tradeoffs only after a conventional embedding baseline. Vendor storage savings are not transferable to Shardly without measurement. |

### Search platforms and vector systems

| Project and primary source | Relevant documented capability | What Shardly should adapt |
| --- | --- | --- |
| [Meilisearch](https://www.meilisearch.com/docs/capabilities/hybrid_search/getting_started) | Embedder configuration, cached embedding generation, keyword/semantic retrieval | Make semantic indexing incremental and observable. Expose progress and remaining lexical coverage during embedding backfill. |
| [Typesense](https://typesense.org/docs/30.1/api/vector-search.html) | Keyword/vector rank fusion and automatic or externally supplied embeddings | Keep query controls understandable. Expose retriever contributions and evaluate exact technical queries separately. |
| [Elasticsearch](https://www.elastic.co/docs/solutions/search/hybrid-search) | Hybrid retrieval with reciprocal rank fusion | Add a small fusion stage, with explicit candidate depths and evaluation. Do not add cluster infrastructure just to obtain fusion. |
| [OpenSearch](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/index/) | Search pipelines with score normalization or rank-based fusion | Record the retrieval plan and compare fusion strategies. Keep mandatory filters consistent across retrieval legs. |
| [Vespa](https://docs.vespa.ai/en/ranking/phased-ranking.html) | Cheap retrieval followed by more expensive bounded ranking phases | Separate candidate generation from expensive final scoring. This applies before adding AI models too. |
| [Qdrant](https://qdrant.tech/documentation/search/hybrid-queries/) | Query API with prefetches and multistage retrieval | Learn candidate-budget and filter behavior. It is an optional vector backend, not a requirement for the first prototype. |
| [Weaviate](https://docs.weaviate.io/weaviate/concepts/search/hybrid-search) | Keyword/vector fusion with rank-based or relative-score methods | Compare fusion methods on held-out labels; do not sum unrelated raw score scales. |
| [pgvector](https://github.com/pgvector/pgvector) | Exact and approximate vector search; documented selective-filter and ANN tradeoffs | Use exact filtered vector search as a correctness reference. A Postgres dependency belongs to a deliberate operating-model change. |
| [Chroma Search API](https://docs.trychroma.com/cloud/search-api/overview) | Field selection, ranking expressions, batching, hybrid retrieval | Adapt response projection and request clarity. The cited Search API is documented as Cloud-only; do not assume local edition parity. |
| [Algolia](https://www.algolia.com/doc/guides/managing-results/optimize-search-results/typo-tolerance) | Configurable typo handling and exact-versus-typo ranking | Refine Shardly's existing typo behavior with identifier protection and visible expansion reasons. |
| [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview) | Document-level access control patterns for retrieval | If Shardly becomes shared, enforce access before evidence reaches a model or user. Check the availability of individual native ACL mechanisms separately. |

### Agent retrieval, code search, and knowledge products

| Project and primary source | Relevant documented capability | What Shardly should adapt |
| --- | --- | --- |
| [Sourcegraph](https://sourcegraph.com/docs/code-search/queries) | Rich code query syntax, exact and regular-expression search, code navigation | Add path/symbol awareness in stages. Keep source locations tied to repository revisions. |
| [Claude Context](https://github.com/zilliztech/claude-context) | Agent-facing code search using hybrid retrieval | Evaluate code-aware chunks and natural-language code discovery. Do not inherit its infrastructure choices without a need. |
| [Onyx](https://docs.onyx.app/welcome) | Search over connected organizational content, agents, and chat | Study ingestion administration and search observability. Shardly can remain a retrieval service used by external agents. |
| [Glean](https://docs.glean.com/connectors/about) | Connector-driven indexing with source permission maps | A connector must synchronize deletions, identity, freshness, and permissions, not merely fetch text. |
| [RAGFlow](https://github.com/infiniflow/ragflow) | Document understanding, template-based chunking, citation-oriented RAG | Give parsing and evidence inspection equal weight with ranking. Expose which document parts entered the index. |
| [Haystack](https://docs.haystack.deepset.ai/docs/retriever) | Explicit retrieval components and combinations of retrievers | Provide a small integration example and inspectable retrieval stages. A framework dependency is unnecessary inside the engine. |
| [LlamaIndex ingestion](https://developers.llamaindex.ai/python/framework/module_guides/loading/ingestion_pipeline/) | Document IDs, hashes, cached transformations, and update processing | Extend Shardly's existing source upserts to parser, chunker, and model versions. Do not present deduplication as missing. |

### Parsing and advanced retrieval

| Project and primary source | Relevant documented capability | What Shardly should adapt |
| --- | --- | --- |
| [Docling](https://github.com/docling-project/docling) | Multiple document formats, layout, reading order, tables, OCR-related processing, structured document representation | First candidate to test for complex PDFs and Office files. Run it as an optional isolated parser with explicit resource limits. |
| [Unstructured](https://github.com/Unstructured-IO/unstructured) | Partitioning documents into typed elements across many formats | Compare extraction fidelity against Docling on the same fixtures. Choose one initial integration. |
| [MarkItDown](https://github.com/microsoft/markitdown) | Conversion of Office and other formats to Markdown | Test as a simpler conversion option when text and headings suffice. Markdown conversion alone does not prove citation fidelity. |
| [Microsoft GraphRAG](https://microsoft.github.io/graphrag/get_started/) | Graph-based local and global retrieval/summarization | Consider only for questions requiring relationships across documents or corpus-wide themes. |
| [LightRAG](https://github.com/HKUDS/LightRAG) | Entity/relationship retrieval combined with chunk retrieval | Study graph update/delete costs as well as query quality. Keep graph extraction experimental. |
| [PageIndex](https://github.com/VectifyAI/PageIndex) | Hierarchical document indexes and reasoning-guided tree retrieval | Add navigable document outlines first. Evaluate reasoning over long-document sections as an optional route. "Local mode" does not by itself establish local model inference. |

No cross-product speed or quality ranking follows from this table. The engines differ in input format, durability, hardware, indexing policy, output payload, and deployment model.

## Detailed recommendations

Priority meanings:

- P0 is the first release aimed at dependable agent retrieval.
- P1 is the next release for broad document quality and stronger relevance.
- P2 is conditional work triggered by real workloads or a shared deployment.
- Experimental work requires an evaluation result before becoming a default.

Effort estimates describe relative scope for this repository: S is a contained change, M crosses a few existing components, and L introduces a substantial lifecycle or subsystem. They are not calendar promises.

### Agent access and evidence

#### R01. Expose a small read-only MCP server

Priority P0. Effort M.

Expose `search`, `fetch`, and `status` first. Let `fetch` accept a bounded array of document or passage references so the agent can inspect several hits without repeated calls. Use input schemas and structured outputs. Keep destructive routes outside this initial tool set. MCP's tool specification defines schemas and structured results. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

Reuse `Engine.search`, `getDocument`, the worker runtime, and validation. The adapter should not open a second writer for a directory already owned by the HTTP server. Support either the running service or one explicitly owned local engine. Start with stdio; add remote transport only with an actual deployment need.

Accept when an agent can discover the tools, search, fetch supporting text, and return a correct citation. Verify protocol framing stays clean when logs are enabled and that closing the client does not close an engine owned by another process.

#### R02. Add a concise retrieval response and POST search

Priority P0. Effort M.

The engine builds full hit documents and explanations, while the HTTP route trims document strings afterward. Add an opt-in evidence response that avoids building or transferring unrequested fields. A POST search route also avoids putting structured filters and synonym maps into increasingly long URLs.

Return title, source reference, revision, relevant passages, score metadata, and explicit truncation information. Leave the existing GET contract available for the UI. Expensive explanations belong behind `inspect` or an equivalent projection request. Token-efficient tools are an established agent design concern. [Anthropic tool design](https://www.anthropic.com/engineering/writing-tools-for-agents).

Accept when response size drops on long documents, source fetch remains exact, and current UI requests retain their behavior.

#### R03. Make passage references versioned and durable

Priority P0. Effort M.

Existing offsets are useful, but they refer to the document text that existed during search. Return a document revision or content hash with every passage reference. Fetch must either return that revision or report `stale_reference`; it must not silently slice a new version at old offsets.

A passage reference should identify the parent document, revision, field or block, and original-text span. It should also carry available page, line, heading, and source URI metadata. Decide whether old revisions are retained. The smallest version can reject stale references without retaining all history.

Accept when modifying a file between search and fetch cannot produce a misleading citation, and backup/restart preserves valid current references.

#### R04. Return context under a declared budget

Priority P0. Effort M.

Add bounded context assembly over retrieved passages. Merge overlapping spans, cap evidence from a single parent, include nearby headings, and optionally fetch neighboring blocks. Never cut halfway through a citation structure or claim that omitted text was absent from the document.

Use a byte or character ceiling initially. If a request names a supported tokenizer, enforce its token limit. Otherwise label token estimates as estimates and retain a hard byte ceiling. Test multibyte text, tiny budgets, large tables, and one document dominating all top hits.

Accept when every response fits its declared hard limit and each excerpt resolves to its source revision.

#### R05. Add bounded batch search

Priority P1. Effort S to M.

Agents often search several phrasings or subquestions. Accept a small array of independent queries, apply the same hard scope to all, and report per-query results and failures. Enforce a combined work budget and avoid flooding the 32-entry worker queue.

Reuse the existing search path. Add a framework example before building a framework-specific integration package. Accept when batched and individual results agree and overload produces a documented retryable response.

#### R06. Report retrieval state explicitly

Priority P0. Effort S to M.

Distinguish `no_matches`, `incomplete_index`, `scope_limit`, `timeout`, and `degraded_retrieval`. Include which strategy ran, which optional stages failed, and whether counts are exact. A model should not infer "the document does not exist" from an incomplete import or failed semantic backend.

Extend existing error and inspector structures. Accept when source failures and retrieval limits remain distinguishable in HTTP and MCP responses.

### Parsing, structure, and source identity

#### R07. Introduce a versioned parsed-document representation

Priority P0 foundation, P1 format coverage. Effort L.

Preserve blocks with a kind, heading path, source span, page/slide/sheet location where available, and extraction metadata. Keep raw source references separate from normalized searchable text. Maintain a compatibility path for existing arbitrary JSON documents.

Start with Markdown headings, code blocks, and existing PDF page boundaries. This supplies structure without requiring a model. Preserve original text for exact matches and citations. Accept when normalized retrieval text can be mapped back to source evidence, or explicitly reports that exact original mapping is unavailable.

#### R08. Add structure-aware chunks

Priority P1. Effort M after R07.

The current 120-position windows with 90-position steps are lexical ranking windows. They are not yet durable, model-token-aware semantic chunks. Add section-aware chunks with parent IDs, source spans, and bounded fallback splits. Keep code blocks and table rows intact where practical.

Test several sizes on development queries. Do not adopt a universal "optimal" chunk size. Store the chunker version, avoid duplicate evidence from overlap, and keep parent-document ranking available. Accept when chunk changes can be reproduced and evaluated independently of model changes.

#### R09. Add OCR and richer PDF extraction

Priority P1. Effort L.

Keep `unpdf` for simple embedded-text PDFs. Route scanned or complex pages to one optional parser selected through fixture-based comparison. Test Docling and Unstructured for text order, headings, tables, OCR errors, and resource use. [Docling](https://github.com/docling-project/docling), [Unstructured](https://github.com/Unstructured-IO/unstructured).

Preserve page numbers and coordinates where the parser supplies them. Record parser/model versions and warnings. Run heavy parsing outside the search worker, with time, memory, page, and pixel limits. Accept when a scanned phrase becomes searchable and its page evidence is correct. Do not present OCR text as a byte-exact quote from embedded PDF text.

#### R10. Add Office and email formats deliberately

Priority P1 for DOCX/PPTX/XLSX, P2 for email/EPUB. Effort L.

For DOCX preserve headings and table cells. For PPTX retain slide numbers and distinguish speaker notes. For XLSX retain sheet and cell references, displayed values, and formula text as different fields. For email retain sender, date, subject, body, and attachment boundaries.

Compare a simple MarkItDown conversion with the richer parser before choosing. Add actual fixtures for every advertised format. Accept when a result can identify the slide, sheet range, or document section that contains its evidence. [MarkItDown](https://github.com/microsoft/markitdown).

#### R11. Parse HTML, CSV, and RTF instead of indexing their syntax

Priority P1. Effort M.

Raw HTML currently exposes markup to the analyzer. Extract visible article text, remove script/style content, and preserve headings and links. CSV needs headers and quoted-field handling; multiline cells cannot be treated as independent lines. Decode RTF through a real parser when support is advertised.

Store the original input or its stable source reference. Accept when script identifiers cannot dominate an HTML article's relevance and a CSV cell result points to its row and column.

#### R12. Add parser and extraction diagnostics

Priority P0 for explicit failures, P1 for coverage UI. Effort M.

Show detected type, extraction status, parser version, extracted pages/blocks, warnings, and why content was skipped. Current upload responses already report skips; extend that behavior rather than replacing it with a generic success state.

The current README says malformed NDJSON lines are skipped, while `extractNdjson` rejects the extraction on a malformed line. Reconcile that documentation with the code's last-good-data policy. Accept when every input file is accounted for as indexed, skipped, pending, or failed.

#### R13. Fix source identity ambiguities before adding connectors

Priority P0. Effort M.

Uploads currently identify records by filename and ordinal. Two unrelated `notes.md` files can target the same upload identity. Make import namespace and replace-versus-add behavior explicit. For structured records, accept a stable record key when users need identity to survive row reordering.

Retain content hashes for deduplication, but do not assume identical bytes imply identical source identity or permissions. Accept when same-name files from separate imports remain distinct unless replacement was requested.

#### R14. Synchronize derived data with parent revisions

Priority P0 before vectors. Effort L.

Track parser, chunker, analyzer, and embedding versions alongside the parent content revision. A changed file must invalidate obsolete passages, embeddings, summaries, and future graph edges. A deleted document must become unavailable immediately across every retriever, even if physical cleanup is asynchronous.

Stage new derived records and activate a consistent revision. Reuse shadow-rebuild and storage-version patterns. Accept when restart during reindexing cannot expose a mix of old citations and new content.

#### R15. Extend source freshness and connector state

Priority P1. Effort M.

Report last attempted sync, last successful sync, indexed source revision, pending changes, and last error separately. Store resumable cursors for incremental connectors. Start with scheduled GitHub refresh and one connector selected by actual users, such as Drive or a website crawl.

Each connector needs delete detection, stable identity, rate-limit handling, retries, and scope boundaries. If shared, it also needs permission synchronization. Glean's documentation makes source permissions part of indexing. [Glean connector requirements](https://docs.glean.com/connectors/about).

Accept when interrupted synchronization resumes without resurrecting deleted data or treating partial scans as complete.

#### R16. Add safe website ingestion only when required

Priority P2. Effort L.

Support canonical URLs, content extraction, conditional fetches, crawl scope, and a bounded sitemap. Enforce network destination policy, redirect checks, response-size limits, and per-host budgets. Website content must remain untrusted input.

A crawler is a separate source lifecycle, not a single `fetch(url)` call. Accept when redirects and resolved destinations cannot escape the configured network policy and repeated crawls update existing documents.

### Retrieval and relevance

#### R17. Add optional dense retrieval with an exact reference path

Priority P1. Effort L.

Semantic retrieval addresses vocabulary mismatch, such as a query about "ending a subscription" and a document about "account cancellation." Embed structured passages and retain parent identity. Keep lexical retrieval available without models, credentials, or a network connection.

Begin with exact cosine or dot-product search over a deliberately small vector corpus. Measure where it becomes too slow before selecting ANN. Validate dimensions, finite values, model compatibility, and normalization. Reject mixed embedding spaces even when dimensions match.

Accept when semantic-only matches improve held-out task recall and exact technical queries retain their lexical route. Record total query cost, including query embedding.

#### R18. Select one embedding runtime and a small model shortlist

Priority P1. Effort M after the representation work.

Test one compact multilingual model and one higher-quality candidate on the actual corpus and hardware. Qwen3 Embedding and BGE-M3 are documented candidates, not declared winners. Their model cards and papers describe different capabilities and resource requirements. [Qwen3 Embedding paper](https://arxiv.org/abs/2506.05176), [BGE-M3 paper](https://arxiv.org/abs/2402.03216).

Persist model identifier/revision, dimension, text preparation, query instruction, and normalization policy. Cache by text hash plus the complete embedding configuration. Exclude credentials from job history, backups, and logs. Make hosted inference an explicit data-transfer choice.

Accept when repeated unchanged imports do not re-embed, model changes trigger a controlled backfill, and lexical search continues during model failure.

#### R19. Fuse lexical and semantic candidates

Priority P1. Effort M.

Take the union of independently retrieved lexical and dense candidates. Reranking a BM25-only candidate list cannot recover a relevant document BM25 never retrieved. Apply the same mandatory scope to both legs.

Use reciprocal rank fusion as the first reference method:

```text
fused_score(document) = sum over retrieval lists of 1 / (k + rank(document))
```

Ranks start at one. A document absent from a list contributes zero. Deduplicate within each list before fusion. Treat `k = 60` and candidate depths around 100 per leg as experimental starting settings, not optimal constants.

Compare RRF with a normalized weighted combination on held-out queries. Elastic recommends RRF, while Weaviate documents both rank and score approaches, and research identifies tradeoffs. [Elastic hybrid search](https://www.elastic.co/docs/solutions/search/hybrid-search), [Weaviate fusion](https://docs.weaviate.io/weaviate/concepts/search/hybrid-search), [fusion analysis](https://arxiv.org/abs/2210.11934).

Accept when contributions are inspectable, exact and semantic cases both benefit, and no mandatory filter is bypassed.

#### R20. Add a bounded neural reranker

Priority P1. Effort M to L.

Rerank a bounded union of candidates, using passage text and limited document context. Start with a small depth such as 30 to 50 candidates, then tune quality and latency together. Compare a compact model with the no-reranker baseline. Sentence Transformers documents this retrieve-then-rerank pattern. [Retrieve and rerank](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html).

Use a separate inference process or service. Add timeouts, cancellation, maximum passage length, model/version reporting, and a clear fallback to fused results. A reranker score is not a calibrated probability of correctness.

Accept when held-out ranking improves within the chosen resource budget. Report candidate recall before reranking so failure to retrieve evidence is not mistaken for a reranker defect.

#### R21. Preserve context during indexing

Priority P1 for extracted headings, experimental for generated context. Effort M.

Include document title, heading path, source context, and relevant structured labels in passage retrieval text. Preserve the raw passage separately. This helps distinguish a sentence about "the company" across several reports.

Only then test model-generated contextual text. Anthropic reports benefits from contextual embeddings and contextual BM25 on its own datasets. Those numbers are not a prediction for Shardly. Generated context introduces cost and possible factual errors. Never use generated text as the cited source quote. [Contextual retrieval methodology](https://www.anthropic.com/engineering/contextual-retrieval).

Accept when context improves held-out retrieval and citations still contain only source evidence.

#### R22. Add explicit query strategy controls

Priority P1. Effort M.

Support clear strategies such as lexical, literal, and hybrid. Keep punctuation-sensitive code queries on exact-capable paths. A simple deterministic "auto" policy can be tested later, but it should expose its choice and permit override.

Separate hard requirements from soft preferences. A requested repository or language filter is a constraint; semantic similarity must not relax it. Accept when identifiers, natural-language questions, and mixed queries have predictable behavior and the selected plan appears in diagnostics.

#### R23. Extend typed filters and query grammar

Priority P1. Effort M to L.

Add a small structured filter representation with `and`, `or`, equality, set membership, and numeric/date comparisons. Start with actual needs such as path, modified date, tags, and collection. Bound depth, clause count, values, and payload size.

Keep the current short query syntax working. Parse quoted filter values correctly before expanding the grammar. Index frequent typed fields rather than scanning all documents for each filter. Accept when HTTP, MCP, facets, lexical retrieval, and vectors agree on filter meaning.

#### R24. Separate searchable, filterable, and stored fields

Priority P0 before new internal metadata. Effort M.

`documentFields` currently indexes primitive values recursively. Adding ACL lists, hashes, coordinates, or model bookkeeping to document JSON would make those values searchable too. Define an indexing policy for ingestion metadata and allow callers to select content fields.

Preserve arbitrary-JSON behavior for existing data until a versioned migration is requested. An allowlist for embedding input is especially important because excluded metadata must not be sent to a model provider. Accept when internal IDs and control fields do not affect content relevance or appear in evidence unexpectedly.

#### R25. Improve language analysis explicitly

Priority P1 for a chosen language set. Effort L.

The existing Unicode word matcher and English suffix rules are not multilingual linguistic analysis. Add language metadata that distinguishes content language from programming language. Choose segmentation/stemming by content language and preserve an unstemmed exact representation.

Test CJK segmentation, combining marks, Turkish casing, Hindi text, mixed scripts, and accented forms for the languages actually supported. Use cross-language embeddings only after evaluation. MMTEB provides broad multilingual evaluation work; a global average does not replace language-specific tests. [MMTEB paper](https://arxiv.org/abs/2502.13595).

Accept when each advertised language has a judged query slice and offsets still resolve correctly.

#### R26. Refine existing typos, suggestions, and synonyms

Priority P1. Effort M.

Protect short tokens, numbers, IDs, paths, and quoted text from overexpansion. Test transpositions such as `stroage`. Shardly's current one-edit implementation handles insertion/deletion/substitution; a swap is a separate case worth testing. Rank exact matches above equivalent fuzzy alternatives unless relevance evidence justifies another policy.

Use corpus-backed suggestions and expose any expansion limit. Add a persistent source-scoped glossary only if query-scoped synonyms prove insufficient. Avoid replacing a user's query without showing the change. Algolia's documentation provides a concrete typo-behavior reference. [Algolia typo tolerance](https://www.algolia.com/doc/guides/managing-results/optimize-search-results/typo-tolerance).

Accept when typo recall improves without turning exact error codes or symbol searches into unrelated results.

#### R27. Add diversity beyond source grouping

Priority P1. Effort M.

Existing repository/source grouping already provides a useful diversification control. Add overlap deduplication, a bounded number of passages per parent, and optional similarity-aware selection when evidence repeats across copied documents.

An algorithm such as maximal marginal relevance balances relevance with novelty; evaluate whether it removes necessary corroboration. Keep a way to retrieve all matching passages from one document. Weaviate documents diversity selection for hybrid results. [Weaviate hybrid search](https://docs.weaviate.io/weaviate/search/hybrid).

Accept when a context budget covers more distinct supporting facts without reducing evidence recall.

#### R28. Add code-aware retrieval in stages

Priority P1 for paths and blocks, P2 for symbol graphs. Effort L.

Start with path/basename weighting, language-aware block boundaries, and repository revision metadata. Then evaluate syntax-based chunks for functions, classes, and imports. Keep literal and substring search available for punctuation, stack traces, and incomplete code.

Add symbol definitions/references only for a small supported language set with a tested indexer. Do not describe heuristic matches as compiler-accurate references. Sourcegraph distinguishes search-based and precise navigation. [Sourcegraph code navigation](https://sourcegraph.com/docs/code-navigation).

Accept when a natural-language task locates the relevant function and a symbol citation points to the indexed revision's correct lines.

#### R29. Add freshness and authority as visible soft signals

Priority P2. Effort M.

Support optional recency or trusted-source preferences for workloads with outdated duplicates. Use source modification time rather than import time where available. Keep historical queries able to retrieve older versions and expose applied boosts in inspection.

Do not make popularity or recency a universal relevance rule. Accept when dated-policy queries and current-policy queries both find the right evidence in separate test cases.

#### R30. Support bounded query expansion and iterative retrieval

Priority P2, experimental. Effort M to L.

An external agent can already search again after reading evidence once R01 exists. Start there. Only add server-side expansion when task evaluations show a repeated failure pattern that deterministic retrieval cannot address.

For an optional research route, retain the original query, generate a small number of subqueries, run them under the same scope, deduplicate, and stop at a strict call/time/context budget. Hypothetical text belongs only in retrieval input, never in returned source evidence.

Use reasoning-intensive benchmarks such as BRIGHT as an additional stress test, not proof of product quality. Accept when the extra steps improve task success enough to justify their cost. [BRIGHT](https://github.com/xlang-ai/BRIGHT).

### Performance, consistency, and operation

#### R31. Split cheap candidate ranking from expensive evidence work

Priority P0 measurement and bounded scoring, P1 deeper optimization. Effort M to L.

The shared `Engine.search` builds term contributions and scans field windows for every candidate. The separate `rankBM25` helper's winner-only explanation strategy does not establish that the main API path does the same work.

First measure common-term, selective-filter, long-document, and expanded queries. Move explanation construction to winners, make facets/groups optional for agent responses, and use a cheaper first-stage score before full passage scoring where evaluation permits. Vespa's phased ranking documents the broader pattern. [Vespa phased ranking](https://docs.vespa.ai/en/ranking/phased-ranking.html).

Accept when top results remain equivalent for an exact optimization, or when quality/latency tradeoffs are reported for a staged approximation.

#### R32. Add cancellation and work accounting

Priority P0. Effort M to L.

The bounded worker queue limits queued requests, but a single synchronous query can still occupy the worker. Add deadlines, query-work counters, and cooperative checks in long loops. A cancellation message cannot interrupt a loop that never yields.

Return explicit partial or timeout state, not a complete-looking result. Test queue wait separately from execution. Reuse batching/yield patterns already present in imports, rebuilds, and cooperative compaction. Accept when an expensive query cannot indefinitely delay unrelated bounded work.

#### R33. Index substring candidates before raising scan limits

Priority P1. Effort L.

Keep the current bounded scan as a correct reference. For larger corpora, test a trigram index over selected original-text fields. Intersect candidate postings, then verify the exact literal/substring against original text to prevent false positives.

Queries shorter than the gram length need a defined bounded fallback. Case-insensitive matching needs offset mapping when case folding changes string length. Arbitrary JavaScript regular expressions should not be added without predictable execution limits. FTS5 documents a useful trigram design reference. [SQLite FTS5](https://www.sqlite.org/fts5.html).

Accept when the indexed path matches scan results, including Unicode and symbols, at larger scopes with measured index overhead.

#### R34. Move toward disk-backed indexes only after profiling

Priority P2. Effort L.

The current packed arrays and metadata-only document map already reduce memory. Profile retained heap, typed-array allocations, RSS, and peak rebuild memory on representative long files before the next rewrite.

If required, add immutable disk index segments, a small mutable recent-write segment, compressed postings, and persisted analysis needed for startup. Treat on-disk index format changes as a versioned migration. Tantivy provides a mature reference. [Tantivy](https://github.com/quickwit-oss/tantivy).

Accept when a stated corpus fits a memory budget and cold startup improves, without weakening WAL durability or exact retrieval.

#### R35. Add consistent pagination for mutable indexes

Priority P1 for agents exporting results, P2 otherwise. Effort M to L.

Current offset pagination can shift if documents change between requests, and deep offsets increase retained heap work. Add a cursor tied to index generation and stable score/ID ordering, or explicitly reject a cursor after the generation changes.

Grouped search and hybrid candidate truncation need their own documented cursor semantics. Do not imply that a bounded hybrid candidate pool enumerates all possible matches. Accept when traversal neither repeats nor skips hits in an unchanged generation and reports concurrent changes explicitly.

#### R36. Stream large backup and restore operations

Priority P1. Effort L.

The current backup and full index snapshot materialize JSON. For larger corpora, add a versioned streaming backup format and checksummed manifest. Preserve the existing conflict-validation guarantee by validating/spooling an import before writes where necessary.

Document partial-write semantics on I/O failure and whether derived indexes are included or rebuildable. Include server-owned saved collections if R43 is adopted. Accept when a large export has bounded memory and a restore drill recovers all acknowledged documents and metadata.

#### R37. Separate heavy parsing and inference from engine scheduling

Priority P1. Effort L.

The current worker isolates HTTP responsiveness, but PDF extraction shares that worker. Give heavy parsing and inference their own bounded execution. Keep the storage writer serialized; adding more workers must not create concurrent writers to one directory.

Bound file bytes, decompressed bytes, image pixels, pages, runtime, and concurrency. Stage extraction results before activating them. Accept when OCR or embedding backfill runs without consuming the entire search latency budget and failed tasks retain the last good revision.

#### R38. Expand operational diagnostics

Priority P0 for retrieval state, P1 for history. Effort M.

Add request IDs, queue delay, stage time, candidate counts, response bytes, parser/inference time, memory, and source freshness. Report histograms or distributions, not a single average. Separate liveness from readiness and degraded inference health.

Reuse the current inspector and diagnostics rather than adding a second measurement path. Avoid storing document text or secrets in logs by default. Accept when a slow request can be attributed to queueing, retrieval, storage, parsing, or inference.

### Privacy and deployment boundaries

#### R39. Make indexing exclusions explicit

Priority P0 before agent/model access to broad folders. Effort M.

The text extension set includes `env`, and folder ingestion follows Git ignore rules but has no independent secret-file policy. Show selected roots and exclusions; provide default exclusions for common secret files, private keys, and generated dependency trees, with deliberate user overrides.

Do not claim filename exclusions detect every secret. Apply the same policy before text reaches an embedder. Test nested ignored directories, explicit overrides, and untracked `.env` files. Accept when an ordinary folder import does not unexpectedly expose common credential files through search.

#### R40. Define local and shared authentication modes

Priority P0 for remote MCP/hosted deployment, P2 for a strictly local private tool. Effort M to L.

Keep the loopback default. If the API becomes network-accessible, require authentication and distinguish search/read credentials from ingestion/maintenance credentials. Origin restrictions are not authentication. Protect backup, reset, document fetch, and source configuration as well as search.

For a local agent adapter, document its trust boundary and configured roots. Accept when a read-only agent cannot mutate sources or export arbitrary documents outside its authorized scope.

#### R41. Add document authorization before shared connectors

Priority P0 gate for shared deployment, P2 for local single-user scope. Effort L.

Store tenant/principal scope independently of user-supplied query filters. Enforce it on candidate retrieval, vector retrieval, snippets, fetch, facets, suggestions, caches, diagnostics, and backups. Key caches by the relevant authorization state. Permission revocations need prompt invalidation.

Filtering only final hits leaks through other outputs and can damage recall. Azure documents document-level retrieval controls. [Azure access control](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview).

Accept when adversarial cross-user tests find no unauthorized text, IDs, counts, or evidence after a revocation.

#### R42. Treat retrieved instructions as untrusted content

Priority P0 for agent integration. Effort M.

A document can contain "ignore prior instructions" or requests to run commands. Return it as quoted source content with provenance. Search results must not become executable tool definitions or privileged instructions. Keep the initial MCP tools read-only and enforce access outside the model.

Content filters and delimiters are defense in depth, not a complete solution. OWASP documents indirect prompt injection and RAG-specific risks. [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), [OWASP RAG guidance](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html).

Accept when malicious document content cannot cause the retrieval service to execute a command, broaden scope, or reveal another user's data.

### Workspace and product experience

#### R43. Persist useful workspace state beyond one browser

Priority P1. Effort M.

Saved searches and collections already exist in local storage. Add export/import first. If agents need named collections, store those collections server-side with stable IDs and include them in backup/restore.

Do not confuse collections of selected documents with source collections, authorization scopes, or semantic clusters. Accept when a saved collection can be used consistently by the UI and an agent after browser storage is cleared.

#### R44. Show extraction coverage and freshness beside results

Priority P1. Effort M.

Show whether the source is current, partially indexed, OCR-derived, or awaiting embeddings. Provide a source preview with page/line context, headings, and a clear way to open the original. Warn about stale citations through a specific state rather than silently jumping to the wrong text.

Extend `SourcesView`, document preview, and the existing inspector. Accept when users can explain why a known file is absent without inspecting server logs.

#### R45. Separate search evidence from optional generated answers

Priority P2. Effort L if included.

A search agent can generate answers itself. Prioritize evidence delivery before adding a chat interface. If Shardly adds answers, retain a first-class search-results view, cite each material claim, identify unsupported questions, and expose the evidence used.

Do not label a raw BM25, cosine, or reranker score as answer confidence. Evaluate citation support and abstention separately from retrieval relevance. Accept when unsupported answers abstain and each citation resolves to a supporting source revision.

#### R46. Preserve accessibility and keyboard workflows as tools expand

Priority P1. Effort M.

The current workspace already has keyboard navigation and responsive verification documented. Extend those checks to new filters, extraction diagnostics, parser previews, and strategy controls. Keep focus predictable, result counts announced appropriately, and status messages understandable without color.

Generated document HTML and Markdown must use safe rendering. Accept when users can search, inspect evidence, change scope, and recover from failed imports using only the keyboard.

### Evaluation and advanced experiments

#### R47. Build a held-out task set from intended users

Priority P0. Effort M, followed by ongoing judgment work.

Collect code-navigation and personal-document queries, with frozen source snapshots and evidence spans. Include natural-language questions, identifiers, table lookups, scanned text, multilingual cases, stale versions, duplicates, and unanswerable questions.

Split development and test queries before tuning. Obtain additional human judgments, record grader disagreement, and pool candidates from several retrieval methods so labels do not favor the current engine's results. Keep existing authored regressions and SciFact as separate tracks.

Accept when improvements survive the held-out set and per-category failures remain visible.

#### R48. Compare the complete retrieval system fairly

Priority P0 for methodology, P1 for a broader run. Effort M to L.

Compare Shardly BM25, tuned lexical, dense-only, hybrid, and hybrid plus reranking. Include the existing SQLite FTS5 reference and at least one close product such as QMD. Add Typesense or Meilisearch if service-level comparisons are relevant.

Use identical content, queries, filters, and output depth. Record differences in analyzers, durability, indexing, and payload. Measure retrieval-only and end-to-end latency separately. Accept when published numbers include hardware, versions, corpus hashes, and reproducible commands.

#### R49. Add agent task evaluations

Priority P0 after MCP. Effort M.

Measure whether an agent finds supporting evidence and completes a task, not merely whether it calls a tool. Use a fixed model/configuration for comparisons, plus a scripted client for protocol invariants.

Record completion rate, evidence recall, citation correctness, tool calls, bytes/tokens returned, elapsed time, and unsupported-answer behavior. Avoid using a single model judge as unquestioned ground truth. Accept when the adapter saves context without reducing task success.

#### R50. Evaluate learned sparse retrieval and late interaction

Priority experimental. Effort L.

SPLADE learns sparse term weights and expansions. ColBERT uses token-level late interaction. Both are distinct from current BM25 and single-vector dense search. They may improve difficult retrieval but add inference, indexing, and storage costs. [SPLADE](https://github.com/naver/splade), [ColBERT paper](https://people.eecs.berkeley.edu/~matei/papers/2020/sigir_colbert.pdf).

Add them only as benchmarked candidates after lexical/dense hybrid retrieval is stable. Accept when measured quality gains justify their full resource cost and delete/update behavior remains correct.

#### R51. Evaluate tree and graph retrieval on matching tasks

Priority experimental. Effort L.

Document outlines can help navigate long manuals. Entity graphs can help answer relationship questions across documents. Neither should become a mandatory step for finding an exact code symbol or phrase.

Test tree reasoning, GraphRAG, or LightRAG on a dedicated query slice. Measure graph construction, refresh, deletion, source permissions, inference calls, and final evidence recall. Treat generated entities and summaries as derived data. [PageIndex](https://github.com/VectifyAI/PageIndex), [GraphRAG](https://microsoft.github.io/graphrag/get_started/), [LightRAG](https://github.com/HKUDS/LightRAG).

Accept when they solve demonstrated cross-section or relationship failures better than simpler retrieval at an acceptable cost.

#### R52. Add multimodal retrieval only after text and OCR coverage

Priority experimental. Effort L.

For diagram-heavy documents, test page-image or image/text retrieval with evidence regions. Store image/page identity and compare against OCR plus text retrieval. Require clear data-transfer controls for hosted vision inference.

Do not add audio/video ingestion merely to expand a feature list. Start with actual document diagrams that text extraction cannot represent. Accept when visual evidence improves a judged task slice and each returned region resolves to the correct page revision.

## Proposed retrieval architecture

This is a target design, not the current implementation.

```text
Source or upload
  -> source identity + revision + ingestion policy
  -> bounded extraction outside the search worker
  -> normalized blocks with source locations
  -> versioned passages
      -> Shardly lexical index
      -> optional embedding generation and vector index
  -> activate one consistent document revision

Search request
  -> validate query, hard scope, work budget, and output budget
  -> resolve authorization when deployment requires it
  -> lexical candidates + optional filtered vector candidates
  -> deduplicate and fuse
  -> optional bounded reranking
  -> select diverse supporting passages
  -> fetch/verify the active source revision
  -> return concise evidence and explicit retrieval state
```

Keep storage authoritative. Derived lexical/vector/structure indexes should be rebuildable. "Rebuildable" does not mean that inconsistent derived state can be returned during an update. Activation must identify which parent revision each index represents.

Do not force the entire architecture into one release. A lexical MCP adapter can deliver immediate value before semantic retrieval exists. Structure and revision handling should precede vectors because retrofitting citation consistency after several derived indexes is harder.

### Engineering decisions to make early

| Decision | Recommended first choice | Revisit when |
| --- | --- | --- |
| Main engine | Keep TypeScript storage and lexical index | A product decision changes the hand-built-engine requirement |
| Agent interface | Three read-only MCP tools backed by existing engine/service | Actual agent traces show a missing operation |
| Embedding execution | One optional local inference process/runtime | A measured hosted or accelerated need exists |
| Vector correctness reference | Exact search over a bounded corpus | Latency requires ANN and its recall can be measured |
| Fusion | RRF reference plus one evaluated alternative | Development labels justify another method |
| Chunk input | Extracted title/heading and raw passage | Generated context proves additional benefit |
| Reranking | Optional bounded stage | Held-out gains justify enabling it for a query class |
| Complex parsing | One optional parser integration | Fixtures demonstrate a specific coverage gap |
| Query rewriting | External agent retries and explicit user controls | Repeated task failures justify server-side expansion |
| Shared access | Explicit authenticated mode with enforced scope | Never infer sharing safety from a loopback prototype |

### Vector memory is a passage-count problem

For float32 embeddings, raw vector bytes equal `passage_count × dimensions × 4`.

| Passages | Dimensions | Raw vector memory |
| ---: | ---: | ---: |
| 100,000 | 384 | About 146 MiB |
| 100,000 | 768 | About 293 MiB |
| 1,000,000 | 768 | About 2.86 GiB |

These are arithmetic examples, not Shardly measurements. They exclude lexical indexes, ANN links, IDs, source text, model memory, caches, and process overhead. A corpus of 100,000 documents can contain far more than 100,000 passages. Quantization or recomputation may reduce vector storage but needs its own recall and latency evaluation.

## Agent API contract

The following illustrates a proposed contract. None of these new fields or tools should be described as shipped until implemented and tested.

Keep tool names few and descriptions concrete:

| Tool | Purpose | Essential limits |
| --- | --- | --- |
| `search` | Find evidence within a selected source/collection scope | Query length, filter complexity, candidate work, deadline, result count, response bytes |
| `fetch` | Read current, version-checked evidence for one or several references | Reference count, expected revision, span size, total response bytes |
| `status` | Discover available strategies, source coverage, and indexing state | Scope-aware metadata; no unbounded corpus dump |

Example search response:

```json
{
	"schemaVersion": 1,
	"requestId": "req-example-1",
	"query": "how are writes recovered after a crash?",
	"strategy": "lexical",
	"indexGeneration": 42,
	"retrievalState": "complete",
	"truncated": false,
	"hits": [
		{
			"documentId": "doc-example-1",
			"revision": "revision-example-7",
			"title": "Storage recovery",
			"source": {
				"kind": "folder",
				"path": "notes/recovery.md"
			},
			"passages": [
				{
					"reference": "passage-example-1",
					"field": "content",
					"start": 0,
					"end": 29,
					"offsetUnit": "utf16",
					"text": "Recovery replays the WAL log."
				}
			],
			"scores": {
				"lexical": 6.2
			}
		}
	],
	"warnings": []
}
```

The example text and IDs are illustrative. Scores retain their type and are not probabilities. A stable reference can be opaque; the server should validate it and never interpret it as a caller-selected filesystem path.

Required behavior:

- `fetch` verifies the requested revision. A changed source produces `stale_reference` or an explicitly retained older revision.
- Offsets identify the stated text field and unit. UTF-16 offsets are compatible with the existing JavaScript UI, but byte offsets and OCR coordinates must use separate fields.
- `retrievalState: "complete"` describes completion of the declared retrieval plan. It does not mean that all relevant knowledge exists in the indexed corpus.
- When optional semantic search fails, a lexical response can say `degraded_retrieval` and identify the failed stage.
- If a budget omits hits or text, disclose truncation. Distinguish an estimated hybrid candidate count from an exact lexical match count.
- Hard filters are invariant across retries, expansions, and optional inference. Server-enforced authorization is separate from caller-controlled filters.
- The response must not include credentials, unrelated file paths, generated context presented as a quote, or debug internals unless explicitly requested and authorized.

Provide a short CLI with JSON output if the packaging effort is small after the adapter exists. It should use the same service/engine path. Avoid a parallel implementation of search semantics.

## Evaluation and release criteria

### Define the supported workload

Publish a workload card for each release. State document types, supported languages, source size distribution, passage count, source refresh frequency, hardware, Node/runtime versions, and whether inference is local or hosted.

Use three initial workload groups:

1. A developer workspace with source files, Markdown, identifiers, errors, and repository questions.
2. A personal document library with PDFs, Office documents, tables, duplicated versions, and some scans.
3. A public retrieval benchmark track for external comparison, with SciFact retained and a second different domain if its licensing and resource needs fit.

Add enterprise permission workloads only if shared deployment is selected. Use BRIGHT for a separate reasoning-intensive experiment and multilingual benchmarks for the languages advertised. Do not average unrelated tasks into a single marketing score.

### Build judgments that do not favor one method

Freeze source versions, split development/test queries, and judge pooled candidates from lexical, dense, and hybrid methods. Record both relevant parent documents and supporting evidence spans. A relevant document with the wrong excerpt is a retrieval failure for an agent that consumes excerpts.

Use the existing 24 authored repository queries as regressions, not as the complete test set. A practical next collection is 150 to 300 target-task queries across the two product workloads. That is a proposed starting size, not a statistical guarantee. Include enough examples per failure category to inspect results individually.

Include unanswerable questions, adversarial instructions in documents, update/delete races, copied files, metadata-only matches, punctuation-sensitive strings, and evidence beyond the first page. Where human judges disagree, keep the disagreement instead of forcing false certainty.

### Measure quality, costs, and failures together

| Dimension | Metrics or checks |
| --- | --- |
| Candidate retrieval | Relevant-document recall at candidate depth; supporting-passage recall; ANN agreement with exact filtered search |
| Final ranking | nDCG@10, MRR@10, Recall@10; per-query and per-workload results |
| Evidence | Source-span correctness, stale-reference rejection, quote support, duplicate evidence rate |
| Agent usefulness | Task completion, correct citations, tool calls, response tokens/bytes, unsupported-answer behavior |
| Responsiveness | End-to-end p50/p95/p99, queue wait, timeouts, overload responses; cold and warm runs |
| Indexing | Documents and bytes per second, parsing time, embedding time, update-to-search delay, delete visibility |
| Resource use | Retained heap, external/array-buffer memory, RSS, peak rebuild/inference memory, disk bytes per source byte |
| Reliability | Crash recovery, source failure recovery, restart parity, backup/restore drills, interrupted derived-index activation |
| Shared-access correctness | No unauthorized hits, snippets, facets, suggestions, fetches, cache reuse, or metadata counts |

### Compare systems under equal conditions

The existing SQLite comparison is useful, but different output payloads and analyzers prevent a simple equal-work speed claim. Publish both ID-only retrieval timings and full evidence-response timings. Separate indexing from parsing and embedding, then report the total too.

For each run record corpus hashes, query/judgment hashes, versions, model revisions, candidate depths, chunk settings, ranking constants, thread counts, hardware, cache state, and output projection. Avoid repeated tuning on the final test split. Use paired per-query analysis and uncertainty intervals rather than declaring victory from a small aggregate change.

Keep CI deterministic. Small lexical/contract regressions can run on every change. Large public datasets, model downloads, inference benchmarks, crash loops, and full competitor runs belong in a scheduled or manually triggered workflow with pinned inputs.

### Proposed release gates

These are proposed acceptance rules, not current performance claims:

- Existing lexical behavior, storage durability, and source synchronization regressions pass.
- Every returned evidence span resolves to the specified revision or produces an explicit stale state.
- No unauthorized evidence appears in the shared-deployment test suite, if that mode ships.
- An optional retrieval stage improves its declared held-out task slice, with no unexplained regression in protected exact-query cases.
- A documented workload fits the chosen latency and memory budget. Set numerical budgets after baseline runs on the target hardware.
- Inference failure, worker overload, canceled requests, incomplete imports, and empty results have distinct client-visible behavior.
- Crash and interrupted-update tests cover parent documents together with derived passage/vector state.
- Installation and a search-to-citation example work from a clean environment without private credentials for the lexical path.

## Implementation sequence

These phases are dependency groups, not promises to ship all 52 recommendations at once.

| Phase | Concrete deliverable | Recommendations | Exit condition |
| --- | --- | --- | --- |
| 1 | Establish current evidence and input policies | R12, R13, R24, R39, R47, R48 methodology | Baselines reproducible; source replacement and indexed fields explicit; extraction failures accurately documented |
| 2 | Agent-ready lexical retrieval | R01 through R06, R38 basic diagnostics, R42, R49 | An agent searches and fetches correct version-checked evidence under a response budget |
| 3 | Structured documents and consistent derived data | R07 through R11, R14, R37, R44 | Chosen formats produce traceable blocks/passages; updates invalidate obsolete evidence |
| 4 | Optional hybrid retrieval | R17 through R22, R27 | Dense, hybrid, and reranked variants beat the relevant held-out baselines within the selected budget |
| 5 | Query depth and measured performance | R23, R25, R26, R28 initial scope, R31 through R36, R43, R46 | Filters/languages have tested semantics; bottleneck fixes preserve relevance and consistency |
| 6 | Workload-driven expansion | R15, R16, R29, R30, R40, R41, R45, R50 through R52 | Each expansion addresses a demonstrated user task and includes its operating cost |

R31 and R32 performance/work-budget checks should begin in phase 2 if agent traces show expensive common queries. R40 and R41 move ahead of any network sharing or permission-bearing connector release. The numbering of phases does not override these gates.

### Suggested first implementation batch

The smallest useful next batch is:

1. Record the current two relevance baselines and extend target-task judgments without changing their old grades.
2. Add opt-in concise POST search and version-checked bounded fetch.
3. Expose those operations through a read-only MCP adapter that respects current engine ownership.
4. Clarify upload identity, metadata indexing, and folder exclusions before more data reaches agents or models.
5. Add one end-to-end agent evaluation that searches, fetches, and cites evidence after an update race.

This batch improves usefulness to search agents without waiting for models or a new database. The following batch should introduce structure-aware passages and the optional semantic experiment.

### Where implementation changes must reach

This map identifies affected callers and contracts. It is not a request to split every item into a new abstraction.

| Change family | Code and callers | Tests, fixtures, and documentation |
| --- | --- | --- |
| Search contract and projection | `src/types.ts`, `src/engine.ts`, `src/api/routes.ts`, `src/api/validation.ts`, worker allowlist, `web/lib/api.ts`, search/preview consumers, new MCP adapter | API/search/runtime tests, schema fixtures, agent contract tests, README examples |
| Revision and passage references | Storage state integration, ingestion identity, `indexDoc`, passage generation, fetch routes, preview jumps, backup format if persisted metadata changes | Update/delete/restart/restore tests, Unicode and stale-reference fixtures, migration instructions |
| Parsing and chunks | `src/ingest/extract.ts`, upload route, folder scanner supported types, extraction workers, GitHub ingestion as applicable, source status UI | Real PDF/Office/HTML fixtures, last-good-data regressions, format coverage docs |
| Hybrid retrieval | Engine candidate generation, derived-index lifecycle, model process, source updates/deletes, query validation, worker budget accounting | Exact-vector reference checks, fusion/reranker mapping tests, inference failure fixtures, evaluation scripts |
| Filters and authorization | Search scopes, fetch/list routes, suggestions, facets, backup, source configuration, all caches, MCP context | Cross-path filter consistency and shared-user isolation tests, API scope documentation |
| Performance | Main `Engine.search` path, packed postings, full-text verification, compaction/snapshot/startup where measured | Ranking parity checks, existing profiler and concurrency scripts, benchmark reports |
| Saved state | `web/lib/workspace.ts` and consumers, collections/saved-search API if added, backup schema | Workspace migration and round-trip tests, user export/import instructions |
| Product claims | `web/app/page.tsx`, engineering page, `website/`, README, FEATURES, VERIFICATION, DATASETS | Published benchmark methods and clean-install walkthrough |

Before implementation, inspect every current caller of the affected symbol. Preserve user changes already present in the working tree. Do not revise unrelated storage semantics while adding agent access.

## Landing page and documentation

The landing page should explain the supported task, show working evidence, and link to reproducible evaluation. It should distinguish shipped capabilities from roadmap items.

The current [landing page](web/app/page.tsx) displays the historical 50,000-document comparison, including 747.4 ms for a full scan and 5.98 ms for Shardly. The README labels those figures as historical, but the landing copy does not carry that qualification. Its statement about never reading the whole corpus also needs mode-specific wording because literal and substring modes use bounded scans.

Recommended content changes:

1. Keep a concrete task example such as finding a line or relevant passage in local documents. Explain code and document support separately.
2. Replace the unqualified historical speed panel with a current reproducible benchmark, or clearly date and qualify the old one. State corpus, query, profile, payload, hardware, and cold/warm methodology.
3. Show a result with its source, page/line, and matching text. Let readers open the evidence. A working result is more persuasive than a diagram of future semantic retrieval.
4. Add an agent integration example once MCP ships. Demonstrate search, fetch, and citation with a normal local document.
5. Publish a format coverage table distinguishing raw text, structured parsing, embedded PDF text, and OCR. Do not advertise Office parsing through a general "documents" label before it works.
6. Link a small public evaluation table that includes both ranking profiles and their domain differences. Avoid "best," "instant," or fixed-millisecond claims without a bounded workload.
7. Explain local data storage and inference destinations. Core local indexing does not imply future hosted embedding requests stay on the machine.
8. Keep the engineering material about WAL, checksums, and score breakdowns. It explains the project's inspectability and provides evidence for its implementation claims.
9. Consolidate overlapping product/engineering claims across `web/`, `website/`, and root documentation. Preserve separate presentations if useful, but give benchmark facts one maintained source.
10. Keep a short roadmap separate from the supported feature list. Users should not need to infer what is already implemented from this research report.

Do not redesign the page before the core claims and intended audience are settled. A search benchmark linked to inspectable raw results matters more than adding another visual effect.

## Choices to postpone

- Distributed sharding, consensus, and multi-region replication until one-machine capacity and a real availability requirement justify them.
- A general plugin framework before a second concrete parser or inference integration needs one.
- Several competing vector backends in the initial release. Select one experiment after the exact reference path.
- A full chat/agent orchestration product while external agents can consume good retrieval tools.
- Graph extraction, tree reasoning, learned sparse retrieval, and multimodal indexing as default processing for every file.
- Arbitrary regular expressions executed in an uninterruptible JavaScript loop.
- Behavioral personalization or click-based learning before enough consented, representative usage exists.
- Geospatial search, commerce merchandising rules, recommendation systems, and other search-platform features unrelated to document evidence.
- A universal numeric confidence score derived directly from retrieval scores.
- Claims of supporting every document, every language, or every search agent without a tested compatibility and coverage definition.

These are conditional capabilities, not permanent exclusions. Promote them when a specific task fails and a measured experiment supports the added complexity.

## Evidence and limitations

### What was inspected and rerun

Inspected the README, ENGINEERING, FEATURES, VERIFICATION, DATASETS, current API/types, lexical analysis/index/ranking, main search path, ingestion and folders, worker scheduling, compaction, frontend contracts, landing copy, test inventory, evaluation scripts, profiler, and workflow definitions.

Reran `evaluate:workspace` and `evaluate:real` successfully against isolated temporary stores. Exact metrics are in this report. Reviewed the existing verification and benchmark artifacts for context; historical crash, memory, throughput, and UI claims were not rerun during this research task.

No application implementation was changed, no dependencies were installed, and the user's document store was not used. Existing working-tree edits were retained. Only this report and its HTML overview were added for the task.

### How to read the outside evidence

Every external capability in the comparison links to a primary source. Recommendations are engineering judgments based on those capabilities and the inspected Shardly implementation. They are not vendor endorsements or independently reproduced competitor benchmarks.

The protocol specification, benchmark papers, and model papers provide additional technical references:

- [MCP tool schemas and structured results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
- [BEIR](https://arxiv.org/abs/2104.08663), [BRIGHT](https://github.com/xlang-ai/BRIGHT), and [MMTEB](https://arxiv.org/abs/2502.13595).
- [Hybrid fusion analysis](https://arxiv.org/abs/2210.11934) and [contextual retrieval methodology](https://www.anthropic.com/engineering/contextual-retrieval).
- [BGE-M3](https://arxiv.org/abs/2402.03216), [Qwen3 Embedding and reranking](https://arxiv.org/abs/2506.05176), [SPLADE](https://github.com/naver/splade), and [ColBERT](https://people.eecs.berkeley.edu/~matei/papers/2020/sigir_colbert.pdf).
- [Token-efficient agent tools](https://www.anthropic.com/engineering/writing-tools-for-agents) and [OWASP RAG security](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html).

Model/provider pricing, commercial feature entitlements, exhaustive license compatibility, and competitor deployments were not audited. Check the exact release and artifact license before integrating code, weights, or a hosted service. A documentation page can describe capabilities that require a different edition than a local deployment.

The remaining product decision is the target workload: local developer/personal search, or shared organizational search. The proposed first batch works for the former and gives the latter a foundation. Shared access adds mandatory authorization and operational work before deployment.
