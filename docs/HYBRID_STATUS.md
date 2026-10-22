# Hybrid implementation status

Work is in `/home/banana/Work/shardly`. The original session directory was Kactus; that project was not modified.

## Implemented phases

1. Foundation: storage/WAL/compaction/retrieval/worker/API audit, architecture diagrams, Float32 vector storage, cosine/dot/squared-L2 distances, exact search, metadata mappings, replacement/deletion and binary checkpoints.
2. Semantic index: seeded multilayer HNSW, reciprocal bounded edges, diversity pruning, protected base connectivity, greedy descent, bounded candidate/result queues, graph validation, binary snapshots and deterministic exact-recall tests.
3. Documents: Unicode-word chunks with sentence cuts, overlap, stable parent/revision IDs and source offsets; model-independent provider and reranker interfaces; optional pinned local inference workers; incremental embedding reuse and resumable progress pages.
4. Hybrid: independent lexical/dense candidate pools, configurable weighted RRF, existing fusion compatibility, parent grouping, revision filtering, prefiltered exact search for metadata/access scopes, score provenance and bounded local reranking with fallback.
5. Durability: WAL sequence numbers and snapshot watermarks, idempotent checkpoint-window replay, verified vector publication, vector-bound graph snapshots, graph rebuilding, incomplete-file rejection, and child-process failure injection.
6. RAG: context builder with evidence references, citation IDs, deduplication, neighboring expansion, source ordering, metadata and a word budget; an optional local-generation example outside the engine.
7. Operations: existing bounded document-worker queue, bounded inference queue, cancellation and shutdown, periodic semantic refresh, replacement and batch APIs, mode-specific retrieval routes, index health/stats and compatibility tests.
8. Evaluation: TypeScript SciFact fetcher, five-mode relevance evaluation, exact-versus-ANN scaling harness, CPU profile summary, existing regression/crash suites retained. Measured reports are under `benchmarks/`.

## Verification

Before implementation, all 207 existing tests passed. The expanded suite covers vector metrics, graph invariants and recall, model assets, chunk boundaries, metadata, filters, context budgets, worker shutdown, embedding-progress resume, checkpoint watermarks and fault recovery. Final verification: `npm run build` passed, and `npm test` passed all 250 tests in 31 files. `git diff --check` passed.

Local MiniLM embeddings and cross-encoder reranking both ran with real q8 weights. Offline operation was verified using the pinned cache. Transformers.js was upgraded from the initial 3.8.1 trial to 4.3.1 after dependency audit findings; the updated optional runtime passes local/offline smoke checks, and npm audit reports zero known vulnerabilities for the installed tree. This is a point-in-time advisory check, not a security certification.

The original crash harness preserved all 149,691 acknowledged writes across eight SIGKILL cycles in `benchmarks/crash-hybrid-regression.txt`. The new fault tests cover 12 SIGKILL stages plus the already-covered-WAL checkpoint window. The compiled server/worker/context path and the offline RAG example also passed smoke checks.

The full current-runtime SciFact run completed all 300 queries. Original BM25 nDCG@10 is 0.67510, hybrid with the existing tuned lexical leg is 0.65550, and hybrid with local reranking is 0.69037. Hybrid Recall@100 is 0.94933 versus original BM25 0.91922. The original baseline therefore beats unreranked hybrid on nDCG@10. ANN runs completed at 10K, 50K and 100K vectors. See [measured results and methodology](HYBRID_BENCHMARKS.md).

## Remaining limits and acceptance gates

This is a substantial implementation, not a claim that every production acceptance criterion has been independently certified.

- Document durability and semantic visibility are separate. A stable generation is required for backfill publication. A continuously changing corpus can repeatedly stale a backfill. Embeddings are reused incrementally, but each successful refresh constructs a replacement graph rather than applying a durable per-chunk mutation queue.
- Graph building, graph recovery, exact filtering, and binary serialization still run on the facade's thread between cooperative yields. Large jobs can delay unrelated requests. The document engine and local model inference have separate workers; large graph ownership still needs a measured worker migration before strict latency SLOs.
- Progress checkpoints persist completed embedding pages, and a checksummed job checkpoint retains failures and interrupted status. Restart reconstructs pending work from current documents and verified progress vectors. There is one durable backfill job rather than a per-chunk scheduler. The interrupted page can be regenerated.
- Vector/progress snapshots are derived. Rebuilding after their loss requires the original provider, cached model assets or original externally supplied coordinates. External vectors are accepted by the core vector store/provider interfaces, not through a new transactional vector-upload HTTP endpoint.
- Context budgets count Unicode words, excluding citation markers and punctuation, rather than a particular LLM's subword tokens. Neighbor expansion uses default chunk boundaries. Provider-specific token budgets and arbitrary custom chunk layouts need an application adapter.
- Metadata/access filtering uses exact vector scan, with correct filter semantics and linear cost. Unfiltered ANN postfilters live revisions and can return fewer parent documents when many candidates are stale or concentrated in one parent.
- The local adapter supports pinned BERT-style q8 repositories with config, tokenizer and `onnx/model_quantized.onnx` assets. Other model layouts need an `EmbeddingProvider` or a deliberate adapter extension. ONNX binaries are optional and platform-specific.
- Cancellation stops local model workers. Synchronous graph loops cannot service cancellation mid-loop. Injected providers can ignore cancellation internally even though the facade stops awaiting them.
- Benchmarks run on one shared development host. Query counts in ANN runs are small and p99 is exploratory. Cross-platform tests, power-loss testing, long-duration mixed read/write soak tests and an isolated capacity/performance campaign remain necessary before a production readiness claim.
- The optional Transformers.js generation path is an example and was not validated against installed local LLM weights. Source citations do not prove generated statements.

## Continue safely

Run `npm run build` and `npm test`. Run `npm run crash-test:hybrid` for deterministic interruption checks and `npm run crash-test -- 8` for the retained randomized harness. See `HYBRID_BENCHMARKS.md` for exact commands. Keep the same model identity and dataset split when comparing reports. Use a new evaluation directory when switching inference runtime/model identity; do not relabel old coordinates as a new model.
