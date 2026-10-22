# HNSW implementation notes

`src/vector/hnsw.ts` implements graph construction and traversal in TypeScript. It uses no ANN library. `VectorStore` owns Float32 coordinates and parent/chunk mappings; graph nodes hold IDs and per-layer neighbor sets.

## Construction invariants

A seeded xorshift generator assigns geometric levels with probability approximately `M^-level`, capped at 32. Insertions greedily descend layers above the new node, explore each shared layer with `efConstruction`, select diverse neighbors, and add reciprocal links. Pruning retains at most `2M` base neighbors and `M` neighbors on upper layers. Neighbor diversity favors candidates that are farther from already selected neighbors than from the query. Unfilled slots use remaining nearest candidates.

Base-layer edges between consecutive insertion ordinals are protected. Reciprocal pruning otherwise disconnects some equal-vector datasets when every tie selects the earliest IDs. The chain guarantees base connectivity while consuming at most two neighbor slots per node. This is a deliberate variation on the original HNSW pruning policy. It can reduce the space available for proximity edges. Benchmarks must measure that tradeoff.

Every edge is reciprocal, has a valid target on the same layer, and is not a self-edge. The entry node has the highest layer. Tombstoned nodes remain traversable but are excluded from returned results. Rebuild removes tombstones. Coordinate replacement requires a rebuild so graph geometry matches the stored coordinates.

## Search and queues

Search greedily descends upper layers, then explores the base layer. Comparisons use ascending distance and bytewise ID order for deterministic ties. Exact search uses the same comparator. Cosine distance is `1 - cosine`, dot distance is negative dot product, and L2 distance is squared Euclidean distance. Returned semantic scores are cosine similarity or negative distance, kept separate from fusion and reranker scores.

The retained result heap has capacity `efSearch`. The candidate frontier is a bounded double-ended heap with capacity `2 * M * efSearch`, implemented with two binary heaps and shared active entries. Lazy deletions are compacted when either heap exceeds twice its bound. Insert/remove operations are logarithmic with occasional linear rebuilds. Traversal uses a visited-ID set. It never sorts the complete candidate frontier at each step.

The semantic facade oversamples chunks by up to eight times the desired parent-document count before grouping. Metadata and authorization filters select exact prefiltered search. Unfiltered graph search removes stale revisions after candidate generation, so updates/deletions can reduce recall until refresh. The exact parent-document baseline groups the best chunk per parent before selecting top K.

## Complexity and memory

HNSW has no unconditional logarithmic search guarantee. Typical exploration depends on graph degree, dimension and exploration width; in adverse distributions traversal can approach the entire graph. A distance calculation costs O(dimensions). Stored coordinates need `4 * dimensions * vectorCount` bytes. Neighbor sets, strings, metadata maps, heaps and visited sets add JavaScript object overhead. Memory diagnostics report coordinate bytes and process usage rather than an invented exact graph allocation count.

Higher `M` increases graph memory and distance work. Higher `efConstruction` increases build cost and can improve neighborhood quality. Higher `efSearch` increases traversal work and usually improves recall. In small indexes, exact search can be faster than high-recall HNSW. High-dimensional uniform random data is harder than many clustered learned embedding distributions.

## Persistence

Vectors and graphs use the versioned `SHRDV001` envelope with descriptor and payload lengths and SHA-256 over the complete body. Coordinates are little-endian Float32. Graph payloads contain UInt32 layer counts, degrees and neighbor ordinals. Metadata carries IDs, entry node, generator state, construction configuration, generation and a digest binding the graph to its exact vector snapshot. Readers check lengths, dimensions, finite coordinates, IDs, degrees, reciprocal edges and the binding digest. Corruption is an error at the low-level API.

The semantic facade treats graph files as derived: missing, stale or corrupt graphs rebuild from verified vectors. Invalid vectors are excluded and require a backfill. Unpublished temporary files are ignored. Construction is single-owner and synchronous between facade yields. Encoding and recovery graph rebuilding can block the caller thread; this remains a scaling limitation for large indexes.
