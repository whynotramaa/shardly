# Hybrid API reference

Existing routes retain their contracts. New routes use the existing Fastify validation, request-size limit, errors, authentication and read scopes.

## Documents

`POST /documents` inserts a raw JSON document and returns `{id}` with HTTP 201. `POST /documents/bulk` retains its existing array-insert semantics.

`POST /documents/batch` accepts at most 10,000 JSON documents, uses existing source-identity upserts, and returns `{ids, added, updated, duplicates}` with HTTP 201. The operation can expose completed prefixes and is not an atomic transaction.

`PUT /documents/:id` replaces an existing document verbatim and returns `{id, replaced: true}`. A missing ID returns 404. The ID remains stable and the content revision changes. `DELETE /documents/:id` retains the existing durable tombstone behavior.

## Retrieval

`POST /search/lexical`, `/search/semantic`, `/search/hybrid` select the corresponding retrieval strategy. `POST /search` retains its `strategy` selector with values `lexical`, `dense`, `hybrid`. Scoped read tokens can use these search routes and `/retrieve`.

All search requests accept `query`, `limit`, existing metadata filters and matching options. Semantic and hybrid requests reject phrase, exclusion, all-term and literal matching semantics that cannot be guaranteed by ANN.

Additional parameters:

- `candidateLimit`: 10..200, default 100, independent pools before fusion.
- `efSearch`: 1..100000, default 128. Traversal uses at least the chunk candidate count, which is up to eight times the requested parent count.
- `exact`: boolean, default false, uses the exact vector baseline.
- `rrfConstant`: 1..10000, default 60.
- `weights`: two finite numbers in 0..100, default `[1,1]`, lexical then semantic. RRF adds weighted reciprocal ranks, never raw BM25 and cosine scores.
- `fusion`: `rrf` by default. The pre-existing `weighted` normalized-score fusion remains for API compatibility.
- `rerank`: boolean, default false.
- `rerankDepth`: 1..candidateLimit, default candidateLimit. Only the ranked prefix is reranked; the remaining candidates retain their relative order.
- `deadlineMs`: 10..30000, default 3000, propagated to inference. Synchronous graph traversal cannot be interrupted mid-loop.
- `maxBytes`: 4096..262144, default 32768, caps serialized response size.

Responses retain `schemaVersion`, `requestId`, `query`, `strategy`, `indexGeneration`, `retrievalState`, `total`, `totalRelation`, `tookMs`, `truncated`, `hits`, `warnings` and lexical continuation cursors. `diagnostics` adds lexical and semantic stage information. A hit contains `documentId`, `revision`, `title`, `source`, separate `scores.lexical`, `scores.dense`, `scores.fused`, optional `scores.reranker`, and `passages`. Passage references encode the parent ID, revision, field and UTF-16 offsets, and can be resolved with `/fetch`. Semantic candidates are grouped by parent before document-level fusion.

Unfiltered ANN traverses the graph and then checks current document versions. Deletions or many stale chunks can reduce its recall. Metadata and access-scope filters use prefiltered exact search to avoid ANN postfilter starvation. This preserves filter correctness at linear scan cost. ANN totals describe a candidate pool, not exhaustive matches.

`POST /retrieve` accepts the same fields plus `tokenBudget` in 1..32768, default 2048; `neighbors` in 0..3, default 0; and `ordering` as `rank` or `source`. It adds `context` with `tokenBudget`, `tokenUnit: unicode-words`, `tokens`, `text`, `citationGuarantee`, and `evidence`. Each evidence row includes `citation`, `documentId`, `revision`, `chunkId`, `field`, `start`, `end`, `text`, `reference`, `metadata`, `scores`, and `tokens`. Context chunk IDs are evidence references for the emitted ranges, including budget truncation. Unicode word counts are reproducible but are not a model-specific subword count. The budget excludes citation labels and punctuation. Response byte limits also apply to context.

If the generation changes during retrieval, results are discarded with `index_changed`. Reference fetching checks current authorization and revision independently. Reranker failure retains the original ranking and reports `degraded_retrieval`.

## Operations

`GET /index/stats` returns existing lexical/storage diagnostics, semantic vector and graph diagnostics, process memory, checkpoint bytes and recent indexing/inference durations. Storage diagnostics include WAL and checkpoint sequence positions. Memory reflects the process, not a precise graph object-size estimate.

`GET /index/health` returns availability, document generation, semantic completeness, generation lag, and semantic progress. Generation lag counts committed storage changes rather than pending documents. Failed-job count represents the single backfill job. These operations require administrator access when authentication is configured.

`POST /retrieval/semantic/index` starts or joins a backfill and returns HTTP 202. `DELETE` cancels it. The completed vector checkpoint stays visible until a replacement publishes. Status is available at `/retrieval/semantic`.
