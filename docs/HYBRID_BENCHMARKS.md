# Reproduce retrieval measurements

## Relevance

```sh
npm run evaluate:fetch
CANDIDATES=100 node --import tsx scripts/evaluate-real.ts > benchmarks/scifact-bm25-current.json
OFFLINE=1 npm run evaluate:hybrid > benchmarks/scifact-hybrid-local.json
```

Use `node --import tsx scripts/evaluate-hybrid.ts` when redirecting output if your npm wrapper writes command banners to stdout. Install both local models first with the RAG example or allow asset downloads by omitting `OFFLINE=1` on the first evaluation. The TypeScript downloader verifies BEIR's published SciFact archive MD5 as an identity check and extracts only known corpus/query/qrel paths. The old Python downloader remains historical; no Python is required by the new workflow.

The evaluation requires all 5,183 SciFact documents and 300 judged test queries. It uses the same corpus, query order, expert qrels and source IDs for all modes. It reports nDCG@10, Recall@10, Recall@100 and MRR@10, plus retrieval latency, query embedding latency, reranking latency and total reranked pipeline latency. Chunks map to parent IDs and are deduplicated before relevance scoring. The script uses the existing tuned lexical profile for every BM25 leg and records the exact local model identity. `evaluate:real` retains the historical baseline-versus-tuned comparison and its default top-10 behavior. Set `CANDIDATES=100` to additionally measure Recall@100. Compare hybrid against both lexical profiles; an improvement over the tuned profile can still regress against the original baseline.

A deterministic smoke test is available through `MOCK=1 RERANK_DEPTH=0 npm run evaluate:hybrid`. Its report explicitly identifies token-hash embeddings and must not be presented as learned semantic quality. `QUERY_LIMIT` can shorten a development run, but the report labels it incomplete. Default rerank depth is 20, with the rest of the 100-candidate ranking retained. Set `RERANK_DEPTH=0` to skip reranking, or choose up to 100. `.cache/evaluation-local` retains the document store and vector checkpoint to avoid re-embedding the corpus on reruns. Use a new `EVAL_DATA_DIR` for a clean build measurement.

Embedding time is excluded from exact/HNSW traversal timing by embedding each query once and reusing its coordinates across modes. Indexing time includes document embedding and graph construction on a cold index; a reused checkpoint records startup/reuse time instead. The reranked total assumes sequential BM25 and ANN execution, as implemented. No independent native or hosted retrieval system is involved.

## ANN

```sh
npm run bench:ann > benchmarks/ann-current.json
SIZES=10000,50000,100000 DIMENSIONS=32 M_VALUES=8,16 \
  CONSTRUCTION_VALUES=64,128 EF_VALUES=32,128,512 QUERIES=30 \
  node --import tsx scripts/bench-ann.ts > benchmarks/ann-sweep.json
```

Coordinates are seeded uniform random Float32 values. Query vectors are independent of index vectors. Each configuration uses the same seed. The script measures exact top-100 once per query, then HNSW at each exploration width, with a warm-up before timed traversal. It records Recall@1, @10 and @100, p50/p95/p99 latency, build rate, process memory and serialized vector/graph sizes. Since each query requests 100 neighbors, effective exploration is at least 100 even when a smaller `EF_VALUES` entry is specified; the report includes that effective value.

Process memory includes JavaScript runtime overhead. Configuration sweeps in one process can retain allocator/GC memory; use separate processes for clean memory comparisons. Small query counts make p99 unstable. Measurements taken while other workloads run are exploratory, not isolated capacity claims. Uniform random data does not predict retrieval quality on learned vectors.

## Profile

```sh
SIZES=2000 DIMENSIONS=64 QUERIES=10 node --cpu-prof \
  --cpu-prof-dir=/tmp --import tsx scripts/bench-ann.ts > /tmp/ann-profile.json
```

Inspect the resulting `.cpuprofile` with a V8 profile viewer before changing distance kernels, graph structures or worker ownership. Avoid interpreting model load time as graph query time. The first implementation retains readable Float32 kernels and object-based adjacency sets; it adds no native code.

## Recorded development-host results

The current learned-model run is [scifact-hybrid-local-v4.json](../benchmarks/scifact-hybrid-local-v4.json), with 5,183 documents, 15,036 passages and all 300 test queries. The embedding model is pinned MiniLM with Transformers.js 4.3.1; reranking uses the pinned MS MARCO MiniLM cross-encoder on the first 20 parent candidates. The evaluator reranks parent titles and abstracts, bounded to 12,000 characters and 512 model tokens. The API instead reranks its returned evidence passages, so these results are not a direct HTTP endpoint quality measurement.

Measured nDCG@10 / Recall@10 / Recall@100 / MRR@10:

- Original BM25 baseline: 0.67510 / 0.81128 / 0.91922 / 0.64053. See [the repeated lexical baseline run](../benchmarks/scifact-bm25-current.json).
- Existing tuned lexical profile used by the hybrid pipeline: 0.59507 / 0.72339 / 0.89756 / 0.56411.
- Exact dense: 0.65434 / 0.78906 / 0.92000 / 0.61600.
- HNSW dense: 0.65434 / 0.78906 / 0.92000 / 0.61600.
- Hybrid with the tuned lexical leg: 0.65550 / 0.80144 / 0.94933 / 0.61571.
- Hybrid with local reranking: 0.69037 / 0.83511 / 0.94933 / 0.65314.

Hybrid improves the tuned lexical profile but regresses nDCG@10 against the original BM25 baseline. Reranking improves nDCG@10 over both in this run. The identical exact/HNSW relevance metrics do not establish perfect neighbor recall; the synthetic ANN reports measure that separately. The older 3.8.1 runtime trial is retained in `scifact-hybrid-local-v3-trial.json` and is not the current dependency.

On the shared development host, dense retrieval p50 was 14.03 ms exact and 11.77 ms HNSW. Hybrid retrieval p50 was 34.59 ms. Query embedding p50 was 3.07 ms, reranking p50 was 1,420.72 ms, and total reranked pipeline p50 was 1,458.14 ms. Reranking has a substantial cost. Cold corpus embedding plus graph construction took 552.05 seconds; this includes inference, not just HNSW construction.

[The 10K-vector report](../benchmarks/ann-hybrid-10000.json) uses 64 dimensions, M=12 and efConstruction=80. Recall@10 rises from 0.92 at effective exploration 100 to 1.0 at exploration 512. The higher-recall configuration is slower than the exact scan on this small dataset.

[The scale report](../benchmarks/ann-hybrid-scale.json) uses 50K and 100K vectors, 32 dimensions, M=8 and efConstruction=64. At 100K and exploration 256, measured Recall@1/@10/@100 is 1.0/0.955/0.822, HNSW p50 is 4.37 ms, and exact p50 is 11.10 ms. With exploration 100, Recall@100 falls to 0.5645. The benchmark therefore does not support claiming high Recall@100 at the low setting.

[The CPU profile summary](../benchmarks/ann-profile-summary.json) attributes about 52% of sampled CPU frames to distance calculations in its small synthetic run. No native kernels were introduced. [The local model smoke report](../benchmarks/local-inference-smoke.json) records a fresh asset installation, semantic-pair assertions, cross-encoder ordering, and an offline repeat within 1e-6 for coordinates.
