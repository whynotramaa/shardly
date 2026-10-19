export const chapters = [
  ["ingest", "Receive a document", "Extract text and useful structure from a file. Attach a stable record key and a source namespace before storing it."],
  ["record", "Put its bytes on disk", "Append records to segment files. An offset map identifies the exact byte range for each current document."],
  ["wal", "Make the write durable", "Synchronize the pending log, the segment bytes, and the commit record before acknowledging the write."],
  ["compact", "Maintain the store", "Copy live records during compaction. Rebuild derived search indexes without treating them as the only copy of the documents."],
  ["token", "Build the search index", "Analyze words into searchable terms. Postings connect each term to documents and positions for ranking."],
  ["bm25", "Choose the results", "Score matching candidates with BM25 or field and passage ranking. Retain the best results and explain their scores."],
  ["evidence", "Fetch the evidence", "Bind a passage to its document revision. Fetch checks the current revision and access scope before returning the text."],
  ["hybrid", "Add model retrieval", "Optionally combine lexical and dense candidates. Fuse their ranks and rerank a bounded result set with a configured endpoint."],
  ["runtime", "Keep work bounded", "Separate HTTP, storage, and parsing responsibilities. Limit queued requests and yield between bulk operations."],
  ["access", "Control access", "Use server-owned read scopes to restrict retrieval. Static tokens do not provide an account system or connector permission sync."],
  ["workspace", "Keep the workspace", "Save workspace state explicitly. Back up documents with checksummed streaming records and validate a restore before applying it."],
  ["bench", "Read the measurements", "Compare judged retrieval quality, recorded latency, and crash recovery. Understand which conclusions each test can support."],
] as const;
