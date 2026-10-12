export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface TermScore {
  term: string;
  termFrequency: number;
  idf: number;
  contribution: number;
}

export interface SearchHit {
  docId: string;
  score: number;
  doc: Record<string, unknown>;
  breakdown: TermScore[];
  snippet?: SearchSnippet;
  passages?: SearchSnippet[];
  groupKey?: string;
}
export interface SearchSnippet {
  text: string;
  field: string;
  start: number;
  end: number;
  matches: Array<{ start: number; end: number }>;
  page?: number;
  line?: number;
}

export interface FacetValue {
  value: string;
  count: number;
}
export interface SearchFacets {
  source?: FacetValue[];
  repo?: FacetValue[];
  type?: FacetValue[];
  language?: FacetValue[];
}
export interface SearchGroup {
  key: string;
  count: number;
  hits?: SearchHit[];
}
export interface Inspector {
  parsedQuery: string[];
  expansions: Record<string, string[]>;
  candidateCount: number;
  postingReads: number;
  documentReads: number;
  cacheHits?: number;
  documentSource?: "memory" | "storage" | "mixed";
  stageMs: Record<string, number>;
  scoreBreakdown: Record<string, TermScore[]>;
  stages?: Array<{ name: string; tookMs: number; count?: number }>;
}

export interface SearchResponse {
  query: string;
  terms: string[];
  tookMs: number;
  total: number;
  hits: SearchHit[];
  facets?: SearchFacets;
  groups?: SearchGroup[];
  inspector?: Inspector;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  mode?: "all" | "any";
  match?: "text" | "literal" | "substring";
  source?: string;
  repo?: string;
  type?: string;
  language?: string;
  docIds?: string[];
  groupBy?: "none" | "repo" | "source";
  prefix?: boolean;
  typos?: boolean;
  synonyms?: Record<string, string[]>;
  profile?: "baseline" | "tuned";
  inspect?: boolean;
}

export interface BenchmarkResponse {
  query: string;
  terms: string[];
  indexed: { tookMs: number; scanned: number; hits: number };
  naive: { tookMs: number; scanned: number; hits: number };
  speedup: number;
  topHitsMatch: boolean;
}

export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function ingestDocument(doc: unknown): Promise<{ id: string }> {
  return json(
    await fetch(`${API_BASE}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    }),
  );
}

export async function ingestBulk(
  docs: unknown[],
): Promise<{ ids: string[]; count: number }> {
  return json(
    await fetch(`${API_BASE}/documents/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(docs),
    }),
  );
}

export async function search(
  q: string,
  limitOrOptions: number | SearchOptions = 10,
  options?: SearchOptions,
): Promise<SearchResponse> {
  const selected =
    typeof limitOrOptions === "number"
      ? { ...options, limit: limitOrOptions }
      : limitOrOptions;
  const params = new URLSearchParams({ q });
  for (const [key, value] of Object.entries(selected)) {
    if (value === undefined || value === false || value === "") continue;
    params.set(
      key,
      key === "synonyms"
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? value.join(",")
          : String(value),
    );
  }
  return json(await fetch(`${API_BASE}/search?${params}`));
}

export async function suggest(q: string): Promise<string[]> {
  const result = await json<{ suggestions: string[] }>(
    await fetch(`${API_BASE}/suggest?q=${encodeURIComponent(q)}`),
  );
  return result.suggestions;
}

export async function compareSearch(
  q: string,
  options: SearchOptions = {},
): Promise<{ baseline: SearchResponse; tuned: SearchResponse }> {
  return json(
    await fetch(`${API_BASE}/search/compare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, options }),
    }),
  );
}

export interface DiagnosticsResponse {
  documents?: number;
  vocabularySize?: number;
  postingCount?: number;
  indexBytes?: number;
  memoryBytes?: number;
  storage?: unknown;
  terms?: Array<{
    term: string;
    documentFrequency: number;
    postings: Array<{ docId: string; termFrequency: number }>;
  }>;
  [key: string]: unknown;
}
export async function diagnostics(term?: string): Promise<DiagnosticsResponse> {
  const suffix = term ? `?term=${encodeURIComponent(term)}` : "";
  return json(await fetch(`${API_BASE}/diagnostics${suffix}`));
}

export interface Job {
  id: string;
  request: { kind: "github" | "wikipedia"; user?: string; deep?: boolean };
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  createdAt: string;
  updatedAt: string;
  progress: { completed: number; total: number; indexed: number };
  error?: string;
  result?: Record<string, unknown>;
}
export async function listJobs(): Promise<Job[]> {
  const result = await json<{ jobs: Job[] }>(await fetch(`${API_BASE}/jobs`));
  return result.jobs;
}
export async function startJob(input: {
  kind: "github" | "wikipedia";
  user?: string;
  deep?: boolean;
  token?: string;
}): Promise<Job> {
  return json(
    await fetch(`${API_BASE}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}
export async function getJob(id: string): Promise<Job> {
  return json(await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}`));
}
export async function cancelJob(id: string): Promise<Job> {
  return json(
    await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),
  );
}
export async function retryJob(id: string, token?: string): Promise<Job> {
  return json(
    await fetch(`${API_BASE}/jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(token ? { token } : {}),
    }),
  );
}

export async function exportBackup(): Promise<{
  version: number;
  documents: Array<{ id: string; doc: Record<string, unknown> }>;
}> {
  return json(await fetch(`${API_BASE}/backup`));
}
export async function restoreBackup(
  backup: unknown,
): Promise<{ added: number; updated: number; duplicates: number }> {
  return json(
    await fetch(`${API_BASE}/backup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backup }),
    }),
  );
}

export async function benchmark(q: string): Promise<BenchmarkResponse> {
  return json(await fetch(`${API_BASE}/benchmark?q=${encodeURIComponent(q)}`));
}

export interface UploadResult {
  results: {
    filename: string;
    status: "indexed" | "skipped";
    reason?: string;
    documents: number;
    added?: number;
    updated?: number;
    duplicates?: number;
  }[];
  indexed: number;
  documents: number;
}

/** Upload raw files (PDF/text/code) as multipart; the server extracts text. */
export async function uploadFiles(files: File[]): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  return json(
    await fetch(`${API_BASE}/documents/upload`, { method: "POST", body: form }),
  );
}

export interface GithubResult {
  user: string;
  reposFound: number;
  reposIndexed: number;
  filesIndexed: number;
  documents: number;
  rateRemaining: number | null;
  deep: boolean;
  errors: string[];
  totalDocuments: number;
}

export async function ingestGithub(params: {
  user: string;
  token?: string;
  deep?: boolean;
}): Promise<GithubResult> {
  return json(
    await fetch(`${API_BASE}/ingest/github`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    }),
  );
}

export interface WikipediaStatus {
  available: number; // articles in the bundled corpus file
  indexed: number; // currently in the store
}

/** How many bundled Wikipedia articles exist vs. are currently indexed. */
export async function wikipediaStatus(): Promise<WikipediaStatus> {
  return json(await fetch(`${API_BASE}/corpus/wikipedia/status`));
}

export async function indexWikipedia(
  onProgress: (p: { indexed: number; total: number }) => void,
): Promise<{ indexed: number; documents: number }> {
  const res = await fetch(`${API_BASE}/corpus/wikipedia/index`, {
    method: "POST",
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final: { indexed: number; documents: number } | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as {
        type: string;
        indexed?: number;
        total?: number;
        documents?: number;
        error?: string;
      };
      if (msg.type === "progress") {
        onProgress({ indexed: msg.indexed ?? 0, total: msg.total ?? 0 });
      } else if (msg.type === "done") {
        final = { indexed: msg.indexed ?? 0, documents: msg.documents ?? 0 };
      } else if (msg.type === "error") {
        throw new Error(msg.error ?? "Wikipedia indexing failed");
      }
    }
  }
  if (!final) throw new Error("Stream ended before completion");
  return final;
}

/** Remove the Wikipedia corpus from the store (the saved file is kept). */
export async function deindexWikipedia(): Promise<{
  removed: number;
  documents: number;
}> {
  return json(
    await fetch(`${API_BASE}/corpus/wikipedia/deindex`, { method: "POST" }),
  );
}

export interface DocumentRecord {
  id: string;
  doc: Record<string, unknown>;
}

export interface DocumentList {
  total: number;
  offset: number;
  limit: number;
  items: DocumentRecord[];
}

export async function listDocuments(
  offset = 0,
  limit = 50,
): Promise<DocumentList> {
  return json(
    await fetch(`${API_BASE}/documents?offset=${offset}&limit=${limit}`),
  );
}

export async function getDocument(id: string): Promise<DocumentRecord> {
  return json(await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}`));
}

export async function stats(): Promise<{ documents: number }> {
  return json(await fetch(`${API_BASE}/stats`));
}

export async function resetStore(): Promise<{
  ok: boolean;
  documents: number;
}> {
  return json(await fetch(`${API_BASE}/reset`, { method: "POST" }));
}

export interface FolderSource {
  id: string;
  path: string;
  status: "idle" | "syncing" | "paused" | "error";
  paused: boolean;
  createdAt: string;
  lastSyncedAt?: string;
  error?: string;
  ignoreMode: "git" | "safe-fallback";
  progress: { scanned: number; indexed: number; removed: number };
  files: number;
}
export async function listFolders(): Promise<FolderSource[]> {
  return (await json<{ sources: FolderSource[] }>(await fetch(`${API_BASE}/sources/folders`))).sources;
}
export async function createFolder(path: string): Promise<FolderSource> {
  return json(await fetch(`${API_BASE}/sources/folders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) }));
}
export async function folderAction(id: string, action: "pause" | "resume" | "rescan" | "remove"): Promise<FolderSource | { removed: number }> {
  const path = `${API_BASE}/sources/folders/${encodeURIComponent(id)}`;
  return json(await fetch(action === "remove" ? path : `${path}/${action}`, { method: action === "remove" ? "DELETE" : "POST" }));
}
export interface RebuildProgress {
  state: "idle" | "running" | "completed" | "failed" | "cancelled" | "stale";
  processed: number;
  total: number;
  error?: string;
}
export async function rebuildIndex(start = false): Promise<RebuildProgress> {
  return json(await fetch(`${API_BASE}/maintenance/rebuild`, { method: start ? "POST" : "GET" }));
}
export async function cancelRebuild(): Promise<{ cancelled: boolean }> {
  return json(await fetch(`${API_BASE}/maintenance/rebuild/cancel`, { method: "POST" }));
}
export interface MissingExplanation {
  docId: string;
  query: string;
  matched: boolean;
  returned: boolean;
  reasons: Array<{ code: string; detail: string }>;
  rank?: number;
  total: number;
  expansions: Record<string, string[]>;
}
export async function explainMissing(query: string, id: string, options: SearchOptions): Promise<MissingExplanation> {
  return json(await fetch(`${API_BASE}/search/explain-missing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, id, options }) }));
}

export interface DemoSeed { documents: number; ids: string[] }
export interface DemoImport { added: number; updated: number; duplicates: number; documents: number }
export interface DemoDurability { verified: boolean; before: number; after: number; detail?: string }
export async function seedDemo(): Promise<DemoSeed> {
  return json(await fetch(`${API_BASE}/demo/seed`, { method: "POST" }));
}
export async function importDemo(): Promise<DemoImport> {
  return json(await fetch(`${API_BASE}/demo/import`, { method: "POST" }));
}
export async function demoDurability(): Promise<DemoDurability> {
  return json(await fetch(`${API_BASE}/demo/durability`, { method: "POST" }));
}
