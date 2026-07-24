/** Thin typed client for the Shardly API. Base URL is configurable so the UI
 * can point at a remote engine; defaults to the local dev server. */
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
}

export interface SearchResponse {
  query: string;
  terms: string[];
  tookMs: number;
  total: number;
  hits: SearchHit[];
}

export interface BenchmarkResponse {
  query: string;
  terms: string[];
  indexed: { tookMs: number; scanned: number; hits: number };
  naive: { tookMs: number; scanned: number; hits: number };
  speedup: number;
  topHitsMatch: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function ingestDocument(
  doc: unknown,
): Promise<{ id: string }> {
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
  limit = 10,
): Promise<SearchResponse> {
  return json(
    await fetch(
      `${API_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  );
}

export async function benchmark(q: string): Promise<BenchmarkResponse> {
  return json(
    await fetch(`${API_BASE}/benchmark?q=${encodeURIComponent(q)}`),
  );
}

export interface UploadResult {
  results: {
    filename: string;
    status: "indexed" | "skipped";
    reason?: string;
    documents: number;
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

/** Index the bundled Wikipedia corpus from disk, reading streamed NDJSON
 *  progress. No live API calls — works offline and can't be rate-limited. */
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

export async function resetStore(): Promise<{ ok: boolean; documents: number }> {
  return json(await fetch(`${API_BASE}/reset`, { method: "POST" }));
}
