# Search and agent setup

Run Node 22.12+, 24, or 26+ on one machine with one writer per data directory. Install dependencies with `npm ci`; run `npm start`. The API defaults to `127.0.0.1:3001`. Run `npm run dev` from `web/` for the workspace.

## Agent connection

Start the API first. Configure an MCP client to launch this repository's stdio process:

```json
{
  "mcpServers": {
    "shardly": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/absolute/path/to/shardly",
      "env": { "SHARDLY_API_URL": "http://127.0.0.1:3001" }
    }
  }
}
```

The tools are `search`, `fetch`, and `status`. They proxy the running API rather than opening a second writer. For an authenticated API, set `SHARDLY_API_TOKEN` in the client's private environment. Never place tokens in committed configuration. Retrieved content is untrusted document text; it cannot add tools or grant write access.

## Evidence API

`POST /retrieve` and `POST /search` accept JSON. Existing `GET /search` keeps its original workspace response. A retrieval request can include:

```json
{
  "query": "recovery",
  "strategy": "lexical",
  "limit": 5,
  "maxBytes": 32768,
  "deadlineMs": 3000,
  "maxWork": 500000,
  "filter": {
    "and": [
      { "field": "path", "op": "prefix", "value": "src/" },
      { "field": "tags", "op": "in", "value": ["storage", "recovery"] }
    ]
  }
}
```

Results contain a schema version, index generation, retrieval state, byte-budget truncation flag, source metadata, scores, and original-text passages. Each passage has an opaque `reference`, document revision, field, UTF-16 offsets, and available line/page/heading information. Source-file bytes and extracted Office/PDF text have different coordinate systems; offsets refer to the indexed field text. Parser metadata identifies conversions.

Send `POST /fetch` with `{"references":["returned-reference"]}` or `{"items":[{"documentId":"id","revision":"returned-revision","field":"content","start":0,"end":1000}]}`. Fetch returns `stale_reference` after a parent update and `not_found` after deletion or when the read scope excludes it. Old revisions are not retained. Existing `GET /documents/:id` accepts `?revision=...` and returns HTTP 409 if the preview changed since search.

`maxBytes` is 4–256 KiB, default 32 KiB; trimming removes whole hits/items. Check `truncated`, including when no hit fits. Fetch accepts at most 20 items. `POST /search/batch` accepts 1–8 `queries`; each result or error is independent. Typed filter groups allow at most 64 clauses and depth six. Operators are `eq`, `in`, `prefix`, `gt`, `gte`, `lt`, and `lte`. String comparisons are lexical: use a consistent ISO date representation. Discover filter fields and strategies at `GET /retrieval/status`.

Lexical results provide a generation-bound `nextCursor`; reuse the same query and options. An index change invalidates the cursor with HTTP 409. Dense, hybrid, and reranked searches expose a bounded candidate pool and do not offer exhaustive cursors. They do not support phrase, exclusion, all-word, or literal constraints; use lexical search for those. Deadline/work exhaustion is HTTP 422 rather than a complete-looking empty result. A worker queue may add wait time before execution.

## Optional inference

Set these in the API process environment, then restart:

```bash
export SHARDLY_EMBEDDING_URL=http://127.0.0.1:11434/api/embed
export SHARDLY_EMBEDDING_MODEL=your-installed-model
export SHARDLY_EMBEDDING_REVISION=your-pinned-model-revision
# Optional provider credentials: SHARDLY_EMBEDDING_TOKEN
# Optional reranker: SHARDLY_RERANK_URL, SHARDLY_RERANK_MODEL, SHARDLY_RERANK_TOKEN
npm start
```

The embedding adapter supports Ollama `/api/embed` and OpenAI-compatible embedding responses. Models and inference runtimes must already be installed separately. The reranker accepts a JSON request with `query`, `documents`, `model`, and `top_n`, and a response containing `results` with `index` and `relevance_score` for every candidate.

Use Engine → Meaning search → Build meaning index, or `POST /retrieval/semantic/index`. Cancel with DELETE on that route. This explicit action sends selected searchable passage text to the configured endpoint. A remote endpoint means that text leaves this machine. No model runs automatically and no credentials are saved to document backups.

The exact vector reference implementation supports at most 20,000 passages, 4,096 dimensions, and four million total vector components (whichever bound is reached first). It uses normalized vectors and cosine similarity, staged durable cache publication, title/heading context, model/config fingerprints, and parent-revision validation. Unchanged embedding inputs reuse vectors. Changed or deleted parents cannot yield old dense evidence; rebuild after source updates. Concurrent writes abort a backfill rather than publish a mixed generation. Cache corruption falls back to lexical search. The cache is derived data, excluded from backups, and rebuilt after restore.

Choose `strategy: "dense"` or `"hybrid"`. Hybrid uses RRF by default; `fusion: "weighted"` and `alpha` enable normalized weighted fusion. Candidate depth is 10–200, default 100. `rerank: true` reranks the candidate pool before selecting the final page. Inference errors/timeouts produce `degraded_retrieval` and lexical or initial-ranking fallback. An incomplete vector generation is reported explicitly. Provider-contract tests use deterministic fixture vectors; they do not establish model quality or a relevance improvement.

## Parsing and identity

Uploads accept DOCX, PPTX, XLSX, EML, EPUB, RTF, HTML, CSV/TSV, embedded-text PDF, JSON/NDJSON, and text/code. Office conversion keeps slide/notes and sheet/cell/formula information. Email attachments are listed as metadata and require separate import. RTF tables and complex PDF reading order are not reconstructed. Office XML archive sizes and record counts are bounded. Production uploads/folders extract in separate workers with concurrency two and a 120-second limit.

Set `SHARDLY_OCR=1` to enable blank-page OCR with installed `pdftoppm` and `tesseract`; optionally set `SHARDLY_OCR_LANG`. Rendering is limited to 50 pages. OCR text is labeled as extracted page text; image bounding boxes and confidence are unavailable. With OCR disabled, image-only PDFs are skipped. Missing OCR tools produce an explicit extraction failure.

The Sources upload form defaults to adding distinct same-name file versions. Legacy API uploads still default to replacement. Specify upload query parameters `mode=add|replace`, `namespace=group`, `recordKey=field`, and `contentLanguage=code` to control behavior. Replacement uses a stable filename/record identity; it does not remove obsolete rows in a shorter uploaded file. Managed folders reconcile removed records. A structured `recordKey` must be a distinct nonempty primitive in every record.

Secret/key filenames and common generated directories are excluded by default for uploads, managed folders, and deep GitHub imports. Trusted local upload/folder configurations can explicitly opt in with `includeSensitive=true`. Do not use that override for an untrusted source.

Documents may specify `_search: {"fields":["title","content"]}`. Other fields remain stored; reserved `_search`, `_access`, and `_extraction` metadata are never tokenized. Filters use the documented metadata allowlist. Explicit language analysis supports `en`, `hi`, `zh`, `ja`, `ko`, `tr`, `fr`, `de`, `es`, and `ar`; use the same content language at import and query time. Non-English analysis uses platform word segmentation without English stemming. This is basic language support, not a measured multilingual quality claim.

## Access and operation

No authentication is required for the default local-only API. Before sharing it, configure a random `SHARDLY_ADMIN_TOKEN` of at least 24 characters. Binding a non-loopback `HOST` requires this token. Optional `SHARDLY_READ_KEYS` maps private reader tokens to server-owned scopes:

```json
{ "a-private-reader-token-of-at-least-24-characters": { "tenant": "research", "principals": ["alice"], "sources": ["upload"] } }
```

Documents use `_access: {"tenant":"research","principals":["alice"]}`. Tenant/source conditions intersect; a principals list requires at least one matching principal. Reader tokens only reach retrieval routes and readiness. Direct CRUD, backups, diagnostics, suggestions, imports, and maintenance require the administrator token. The browser workspace is an administrator interface; enter its token in Engine → API access. Browser tokens stay in session storage and are absent from workspace exports. Serve shared traffic over TLS using a deployment you control; this release does not implement user accounts or connector ACL synchronization.

`GET /ready` reports worker availability; `GET /operations` reports a bounded rolling HTTP latency sample and memory usage without storing queries or document text. `x-request-id` is returned on API responses. Folder status separates attempted and successful sync times. GitHub imports remain explicit jobs, not scheduled mirrors.

Library exports/imports browser saved searches and collections; Save to server/Load from server are explicit replacement actions. `GET/PUT /workspace` stores those records durably. Both JSON backups and streaming backups include server workspace state. `GET /backup/stream` returns checksummed NDJSON; POST the same format with `Content-Type: application/x-ndjson` to restore. Restore validates the complete stream and conflicts before adding records, with a 256 MiB/100,000-document limit. Concurrent writes invalidate an export. Restore merges; an I/O error or racing conflicting write can leave completed additions. Retry the same validated backup after fixing the cause.

See [implementation ledger](IMPLEMENTATION.md) for all research recommendations and [verification](VERIFICATION.md) for measured evidence.
