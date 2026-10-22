# Run local hybrid retrieval

## Install and start

Use Node.js 22.12 or newer with a version supported by `package.json`.

```sh
npm ci
npm run build
npm test
npm start
```

Lexical search and document storage require no model, API key or account. `npm ci --omit=optional` omits local inference. After building, use `npm run start:built` to run compiled JavaScript without the development loader. The existing HTTP embedding and reranking endpoints remain supported through `SHARDLY_EMBEDDING_URL`, `SHARDLY_EMBEDDING_MODEL`, `SHARDLY_EMBEDDING_REVISION`, and `SHARDLY_RERANK_URL`. Set `SHARDLY_EMBEDDING_DIMENSIONS` to validate a server model dimension explicitly, and `SHARDLY_RERANK_REVISION` to pin a custom local reranker.

For local embeddings, start with:

```sh
SHARDLY_LOCAL_EMBEDDINGS=1 SHARDLY_MODEL_CACHE="$PWD/.cache/models" npm start
```

Run `npm run models:check` to install and verify both embedding and reranking assets, including an offline repeat. The first inference downloads public model assets. The server retries incomplete semantic indexing every 30 seconds. Trigger it immediately with `POST /retrieval/semantic/index`. Check `/index/health` for completeness and errors. After downloading the assets, set `SHARDLY_MODEL_OFFLINE=1` to prohibit remote model downloads.

The optional `@huggingface/transformers@4.3.1` dependency uses precompiled ONNX Runtime binaries. Its npm dependency tree includes platform-specific ONNX Runtime and Sharp packages. Shardly adds no native source code, native search addon or external database. Runtime availability depends on the operating system, architecture and supported precompiled binaries. Installation can succeed while an optional runtime is absent; lexical operation still works. Model loading failures appear in indexing health or explicit retrieval fallback warnings.

The default embedding model is [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), pinned to `751bff37182d3f1213fa05d7196b954e230abad9`, with 384 dimensions, mean pooling, normalized output and q8 weights. The adapter downloads only the pinned config, tokenizer and q8 ONNX files, then loads their local directory with remote model access disabled. Custom local models must use this BERT-style asset layout and a 40-character commit SHA. Local reranking uses [Xenova/ms-marco-MiniLM-L-6-v2](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2), pinned to `a09144355adeed5f58c8ed011d209bf8ee5a1fec`. The model cards document Transformers.js compatibility. Both were run successfully online for asset installation and offline from the resulting cache during this change.

## Ingest and query

```sh
curl -s localhost:3001/documents/batch -H 'content-type: application/json' \
  -d '[{"sourceId":"storage-guide","title":"Storage","content":"Acknowledged writes survive crashes because the transaction log and segments are synchronized."}]'
curl -s -X POST localhost:3001/retrieval/semantic/index
curl -s localhost:3001/search/hybrid -H 'content-type: application/json' \
  -d '{"query":"durable document recovery","limit":5,"candidateLimit":100,"efSearch":256,"rrfConstant":60,"weights":[1,1]}'
curl -s localhost:3001/retrieve -H 'content-type: application/json' \
  -d '{"query":"durable document recovery","strategy":"hybrid","rerank":true,"rerankDepth":20,"deadlineMs":30000,"tokenBudget":512,"neighbors":1}'
```

Wait for `/index/health` to report `semanticComplete: true` if semantic completeness matters. A successful document write alone does not imply this state. Configure a larger deadline for cold model loading. Warm models are reused inside the inference worker.

## Use the TypeScript API

```ts
import { Engine } from "./src/engine.js";
import { SemanticIndex } from "./src/search/semantic.js";
import { Retrieval } from "./src/api/retrieval.js";

const directory = ".cache/my-index";
const engine = new Engine(directory);
const semantic = new SemanticIndex(engine, directory, {
  local: true,
  cacheDir: ".cache/models",
  chunks: { size: 160, overlap: 32 },
  hnsw: { M: 16, efConstruction: 128 },
});
try {
  engine.ingestDocuments([{ sourceId: "guide", content: "Your source text" }]);
  semantic.start();
  await semantic.settled();
  if (semantic.status().state !== "completed") throw new Error(semantic.status().error);
  const evidence = await new Retrieval(engine, semantic).retrieve({
    query: "Your question", strategy: "hybrid", tokenBudget: 1024,
  });
  console.log(evidence.context);
} finally {
  await semantic.close();
  engine.close();
}
```

The standalone `Engine` preserves its synchronous lexical API. Semantic integration is explicit through `SemanticIndex` and `Retrieval`. The server owns periodic refresh; an embedded application calls `start` after changes. Chunk size and overlap use Unicode word segmentation including stopwords, independent of BM25 stemming. Chunk IDs include parent ID, content revision, field offsets and chunk settings. Chunks retain offsets rather than duplicate full document bodies. Neighbor expansion uses the default evidence chunk layout and may differ from custom semantic chunk boundaries.

For external embeddings, implement `EmbeddingProvider` with a stable `identity`, `dimensions`, and asynchronous `embed(texts, signal)` returning `Float32Array[]`. The same model must embed documents and queries. The provider may look up precomputed vectors by input text. Retain its source vectors or model assets outside the derived index if rebuilding must work without inference. `MockEmbeddings` is available for reproducible tests; it hashes words and has no learned semantic understanding.

`VectorStore.insert`, `insertBatch`, `replace`, `delete` and `exact` also accept supplied coordinates directly without any embedding runtime. Its constructor accepts dimensions, model identity and `cosine`, `dot` or `l2`. After replacing coordinates in a store attached to HNSW, call `graph.rebuild()` before querying. Mutation of a graph and its store has one owner.

## Try the optional RAG example

```sh
npm run example:rag -- README.md "How are writes recovered?"
SHARDLY_MODEL_OFFLINE=1 npm run example:rag -- README.md "How are writes recovered?"
```

The example prints structured context with source ranges and citations. Generation is outside the database. For optional answer generation, set `SHARDLY_GENERATE_MODEL_DIR` to an already installed local ONNX text-generation model directory with q4 weights and a compatible chat template. The example runs Transformers.js in a separate worker with remote model access disabled. It neither downloads an LLM nor starts another inference service. Retrieval needs no LLM. Citation references identify source ranges; they do not prove generated claims.

## Diagnose problems

- `incomplete_index`: wait for indexing or trigger `POST /retrieval/semantic/index`. Repeated concurrent document changes can prevent publication of a stable generation.
- `degraded_retrieval`: inspect `/index/health`, inference configuration, model cache and the deadline. Hybrid returns lexical fallback. Dense mode returns an empty fallback if inference fails.
- `checkpointError`: vectors fail closed on corruption or model/configuration mismatch. A bad graph is rebuilt from verified vectors. Trigger indexing to replace a corrupt vector checkpoint.
- `failed`: the prior index remains usable with revision validation. Retry after restoring model availability or disk space. Completed progress pages reuse cached vectors after restart.
- `index_changed`: documents changed while evidence was being fetched. Repeat retrieval.
- Memory pressure: reduce batch size at ingestion, chunk overlap, dimensions or corpus size. Semantic construction holds the previous index and a private replacement simultaneously. Coordinates have a 512 MiB limit and each checkpoint a 1 GiB limit.
- Busy engine: the existing worker queue rejects requests beyond 32 outstanding calls; retry with backoff. Local inference rejects more than eight outstanding requests. Aborting one inference request terminates that worker and rejects its other queued requests; later calls create a new worker.
