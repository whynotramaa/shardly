# WAL consistency and recovery

## Document commit

1. Validate the input and plan its segment offset.
2. Append a checksummed pending WAL record and fsync WAL.
3. Append the document record and newline; fsync the segment.
4. Append a checksummed committed WAL record and fsync WAL.
5. Update visible offsets, advance storage version, update lexical postings, and return acknowledgement.

A crash before acknowledgement may recover a complete pending write. This preserves existing behavior. Acknowledgement implies durable segment bytes and a committed log record. Batch ingestion is a sequence of durable writes, not a transaction. A partial batch can remain visible after failure. A tombstone is fsynced before a deleted document disappears from the live offset map.

New WAL records include a monotonic `sequence` inside the record checksum. Pending and committed records each consume a sequence. Offset snapshots carry `walSequence`. Recovery verifies the WAL checksum and only applies new records above that snapshot watermark. It sets the next writer sequence above both the snapshot and surviving log. This makes replay idempotent across a crash after offset snapshot rename but before WAL truncation. Legacy records without a sequence still use the existing ordered replay rules; the first successful checkpoint upgrades the snapshot. Storage version counts visible changes; WAL sequence counts log records. They are different positions.

Committed records with invalid segment bytes fail recovery. Malformed complete WAL lines and checksum failures fail recovery. Only a malformed final line without a trailing newline is treated as a torn tail. Recovery never silently drops a corrupt committed record.

## Semantic visibility

Semantic indexing is an asynchronous derived operation. An acknowledged write can be lexically visible while semantic indexing is pending. Document content and its revision are authoritative. A semantic hit is returned only if its stored parent revision equals the live authorized parent revision. Replacement immediately invalidates old chunks even when HNSW still contains their nodes. Deletion immediately hides all chunks for that document.

Backfill captures one document generation and constructs private chunk/vector/graph state. Inference batches contain at most 16 passages. It reuses matching input hashes from the prior complete snapshot and any verified progress checkpoint with the same model fingerprint. Manifest pages have an 8 MiB aggregate byte budget and up to 100 documents. One oversized document can occupy a page on its own. After a page it publishes a progress-vector file. An interrupted page can require inference again. A small checksummed job checkpoint persists the target generation, state, counts and failure message. A saved running state becomes interrupted on restart. Work is reconstructed from current documents and verified progress vectors on retry; a separate per-chunk embedding-job WAL is not introduced.

Failure or cancellation leaves the prior live semantic snapshot intact. On retry, the facade rebuilds a new graph and reuses available embeddings. The server retries incomplete generations every 30 seconds; embedded callers trigger retries explicitly. Indexing a continuously changing collection can starve completion because publication requires a stable generation. There is one backfill job, not one independently scheduled durable job per chunk.

## Checkpoint publication

Each binary file is encoded with a format version, lengths, generation and SHA-256. Semantic vector and graph checkpoints also carry the captured WAL sequence watermark. Publication creates a unique temporary file, writes and fsyncs it, rereads and validates it, renames it over the target, then fsyncs the containing directory. An incomplete temporary file is never loaded as a published checkpoint.

Vector and graph files are separate publications. Vectors publish first. A crash between them leaves a valid vector generation and a stale graph. The graph digest/generation binding rejects the stale graph and recovery rebuilds it from vectors. A crash before vector publication leaves the prior complete vector checkpoint. After both publications, the in-memory semantic index switches to the private replacement. If directory fsync or the graph write fails after vector rename, the running process can retain the older in-memory snapshot while restart loads the newer valid vectors. Both are revision-filtered; completeness follows the snapshot actually used.

The vector snapshot is derived, not an additional acknowledgement for externally supplied vectors. If both vector and progress checkpoints are lost, rebuilding requires the original embedding provider, locally cached model weights, or the externally supplied coordinates. Source documents remain durable independently. Documents and backup formats have not been silently enlarged with inference outputs.

## Concurrency

The document worker serializes writes and exposes committed prefixes to reads at existing batch yields. Its RPC queue is bounded to 32 calls. Graph construction and publication have one owner. Search holds a reference to the prior semantic snapshot across asynchronous query embedding; publication cannot mutate it. Retrieval checks document generation at the start and end of evidence construction and returns `index_changed` if it differs.

Local inference owns its sessions in a separate worker and serializes at most eight outstanding requests. Cancellation or timeout terminates the worker, rejects all its queued calls, and permits a fresh worker on the next request. HTTP inference uses abortable fetch. Injected providers receive a signal; the facade bounds the wait even if a provider ignores it, but cannot stop that provider's own background resources.

## Fault tests

`npm run crash-test:hybrid` kills child processes during WAL pending/commit writes, acknowledgement, chunk planning, embedding, vector insertion, graph insertion, checkpoint temporary publication, vector publication, graph publication and WAL replay. Tests verify acknowledged documents, replacements, tombstones, retry idempotence and complete rebuilds. A separate checkpoint-window test restores already-covered WAL bytes and confirms that versions and tombstones do not replay twice. `npm run crash-test -- 8` retains the original randomized storage crash test.

These tests simulate process failure. They do not certify kernel, filesystem or storage-device behavior under power loss. Filesystem durability still depends on fsync/rename guarantees of the target filesystem.
