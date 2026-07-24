import type { Document } from "../types.js";
import { TEXT_EXTENSIONS, extensionOf } from "./extract.js";

/**
 * Index a GitHub account into the document store.
 *
 * Two modes:
 *  - default: one document per repository (name, description, language, topics,
 *    stars, URL, README text) — cheap, ~2 API calls per repo.
 *  - deep: additionally index each repo's individual text/source files — far
 *    more searchable but many more API calls, so it's rate-limit gated and best
 *    used with a token.
 *
 * An optional personal access token raises the rate limit (60 → 5000 req/hr)
 * and unlocks private repos of the token owner.
 */

const API = "https://api.github.com";

export interface GithubOptions {
  user: string;
  token?: string;
  deep?: boolean;
  /** Safety caps so one call can't fan out unboundedly. */
  maxRepos?: number;
  maxFilesPerRepo?: number;
  maxTotalFiles?: number;
  maxFileBytes?: number;
}

export interface GithubSummary {
  user: string;
  reposFound: number;
  reposIndexed: number;
  filesIndexed: number;
  documents: number;
  rateRemaining: number | null;
  deep: boolean;
  errors: string[];
}

interface Repo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  updated_at: string;
  private: boolean;
  default_branch: string;
  fork: boolean;
}

interface GhResponse<T> {
  ok: boolean;
  status: number;
  data: T;
  rateRemaining: number | null;
}

async function gh<T>(
  path: string,
  token: string | undefined,
  accept = "application/vnd.github+json",
): Promise<GhResponse<T>> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "shardly",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    headers,
  });
  const remainingHeader = res.headers.get("x-ratelimit-remaining");
  const rateRemaining = remainingHeader === null ? null : Number(remainingHeader);

  const isJson = accept.includes("json") && !accept.includes("raw");
  const data = (isJson ? await res.json().catch(() => null) : await res.text()) as T;
  return { ok: res.ok, status: res.status, data, rateRemaining };
}

/** Run async `fn` over `items` with at most `limit` in flight — the difference
 * between GitHub ingestion feeling instant vs. crawling one request at a time. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

export interface GithubTarget {
  kind: "user" | "repo";
  /** For kind "user". */
  user?: string;
  /** For kind "repo". */
  owner?: string;
  repo?: string;
}

/** Accept a bare username, an `owner/repo`, or a full GitHub URL. */
export function parseGithubTarget(input: string): GithubTarget {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { kind: "repo", owner: parts[0], repo: parts[1] };
  }
  return { kind: "user", user: parts[0] ?? "" };
}

/** Resolve which listing endpoint to use: the token owner's own account can
 * list private repos via /user/repos; otherwise public repos via /users/{user}. */
async function repoListPath(
  user: string,
  token: string | undefined,
): Promise<{ base: string; ownAccount: boolean }> {
  if (token) {
    const me = await gh<{ login?: string }>("/user", token);
    if (me.ok && me.data?.login?.toLowerCase() === user.toLowerCase()) {
      return {
        base: "/user/repos?per_page=100&affiliation=owner&sort=updated",
        ownAccount: true,
      };
    }
  }
  return { base: `/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`, ownAccount: false };
}

async function listRepos(
  user: string,
  token: string | undefined,
  maxRepos: number,
): Promise<{ repos: Repo[]; rateRemaining: number | null }> {
  const { base } = await repoListPath(user, token);
  const repos: Repo[] = [];
  let rateRemaining: number | null = null;

  for (let page = 1; repos.length < maxRepos; page++) {
    const res = await gh<Repo[] | { message?: string }>(
      `${base}&page=${page}`,
      token,
    );
    rateRemaining = res.rateRemaining;

    if (!res.ok) {
      if (res.status === 404) throw new Error(`GitHub user "${user}" not found`);
      if (res.status === 401) throw new Error("invalid GitHub token");
      if (res.status === 403)
        throw new Error(
          "GitHub rate limit reached — add a personal access token to continue",
        );
      const msg = (res.data as { message?: string })?.message ?? `HTTP ${res.status}`;
      throw new Error(`GitHub error: ${msg}`);
    }

    const page_ = res.data as Repo[];
    if (!Array.isArray(page_) || page_.length === 0) break;
    repos.push(...page_);
    if (page_.length < 100) break; // last page
  }

  return { repos: repos.slice(0, maxRepos), rateRemaining };
}

async function fetchReadme(
  fullName: string,
  token: string | undefined,
): Promise<string | undefined> {
  const res = await gh<string>(
    `/repos/${fullName}/readme`,
    token,
    "application/vnd.github.raw",
  );
  if (!res.ok || typeof res.data !== "string") return undefined;
  return res.data.trim() || undefined;
}

function repoDoc(repo: Repo, readme: string | undefined): Document {
  return {
    source: "github",
    repo: repo.name,
    fullName: repo.full_name,
    description: repo.description ?? "",
    language: repo.language ?? "",
    topics: repo.topics ?? [],
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    url: repo.html_url,
    updatedAt: repo.updated_at,
    private: repo.private,
    ...(readme ? { readme } : {}),
  };
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

/** Index individual text/source files of a repo (deep mode). */
async function fetchRepoFiles(
  repo: Repo,
  token: string | undefined,
  maxFiles: number,
  maxFileBytes: number,
  errors: string[],
): Promise<Document[]> {
  const tree = await gh<{ tree?: TreeEntry[]; message?: string }>(
    `/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`,
    token,
  );
  if (!tree.ok || !Array.isArray(tree.data.tree)) return [];

  const candidates = tree.data.tree
    .filter(
      (e) =>
        e.type === "blob" &&
        (e.size ?? 0) <= maxFileBytes &&
        TEXT_EXTENSIONS.has(extensionOf(e.path)),
    )
    .slice(0, maxFiles);

  // Fetch blobs concurrently — the single biggest speedup for deep mode.
  const results = await mapLimit<TreeEntry, Document | null>(candidates, 8, async (entry) => {
    const blob = await gh<{ content?: string; encoding?: string }>(
      `/repos/${repo.full_name}/git/blobs/${entry.sha}`,
      token,
    );
    if (!blob.ok || !blob.data.content) return null;
    try {
      const content = Buffer.from(blob.data.content, "base64").toString("utf8");
      if (content.trim().length === 0) return null;
      return {
        source: "github",
        type: "file",
        repo: repo.name,
        path: entry.path,
        url: `${repo.html_url}/blob/${repo.default_branch}/${entry.path}`,
        content,
      } satisfies Document;
    } catch {
      errors.push(`failed to decode ${repo.full_name}/${entry.path}`);
      return null;
    }
  });

  return results.filter((d): d is Document => d !== null);
}

/** Fetch a single repository's metadata object. */
async function fetchRepo(
  owner: string,
  repo: string,
  token: string | undefined,
): Promise<{ repo: Repo; rateRemaining: number | null }> {
  const res = await gh<Repo | { message?: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token,
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error(`repository "${owner}/${repo}" not found`);
    if (res.status === 401) throw new Error("invalid GitHub token");
    if (res.status === 403)
      throw new Error("GitHub rate limit reached — add a personal access token");
    const msg = (res.data as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw new Error(`GitHub error: ${msg}`);
  }
  return { repo: res.data as Repo, rateRemaining: res.rateRemaining };
}

/** Build all documents for one repo: its metadata+README, plus source files in
 * deep mode (bounded by `fileBudget`). */
async function documentsForRepo(
  repo: Repo,
  token: string | undefined,
  deep: boolean,
  fileBudget: number,
  maxFilesPerRepo: number,
  maxFileBytes: number,
  errors: string[],
): Promise<Document[]> {
  const readme = await fetchReadme(repo.full_name, token).catch(() => undefined);
  const docs: Document[] = [repoDoc(repo, readme)];

  if (deep && fileBudget > 0) {
    const files = await fetchRepoFiles(
      repo,
      token,
      Math.min(maxFilesPerRepo, fileBudget),
      maxFileBytes,
      errors,
    ).catch((e) => {
      errors.push(`${repo.full_name}: ${e instanceof Error ? e.message : e}`);
      return [] as Document[];
    });
    docs.push(...files);
  }
  return docs;
}

/**
 * Fetch and build documents for a GitHub target — either a whole account
 * (`user`) or a single repository (`owner/repo` or a URL). Pure data-gathering;
 * the caller indexes the returned docs.
 */
export async function fetchGithubDocuments(
  opts: GithubOptions,
): Promise<{ docs: Document[]; summary: GithubSummary }> {
  const raw = opts.user.trim();
  if (!raw) throw new Error("a GitHub username or repository is required");

  const caps = {
    maxRepos: opts.maxRepos ?? 100,
    maxFilesPerRepo: opts.maxFilesPerRepo ?? 25,
    maxTotalFiles: opts.maxTotalFiles ?? 400,
    maxFileBytes: opts.maxFileBytes ?? 120_000,
  };
  const deep = opts.deep ?? false;
  const errors: string[] = [];

  const target = parseGithubTarget(raw);

  // Gather the repositories to index (one for a repo target, many for a user).
  let repos: Repo[];
  let rateRemaining: number | null;
  let label: string;
  if (target.kind === "repo") {
    const r = await fetchRepo(target.owner!, target.repo!, opts.token);
    repos = [r.repo];
    rateRemaining = r.rateRemaining;
    label = `${target.owner}/${target.repo}`;
  } else {
    const listed = await listRepos(target.user!, opts.token, caps.maxRepos);
    repos = listed.repos;
    rateRemaining = listed.rateRemaining;
    label = target.user!;
  }

  const docs: Document[] = [];
  let filesIndexed = 0;

  if (deep) {
    // Sequential across repos so the global file budget is honored exactly;
    // blobs within each repo are still fetched concurrently.
    for (const repo of repos) {
      const budget = caps.maxTotalFiles - filesIndexed;
      const repoDocs = await documentsForRepo(
        repo, opts.token, true, budget, caps.maxFilesPerRepo, caps.maxFileBytes, errors,
      );
      filesIndexed += repoDocs.filter((d) => d.type === "file").length;
      docs.push(...repoDocs);
    }
  } else {
    // No files to budget — fetch every repo's README concurrently.
    const perRepo = await mapLimit(repos, 8, (repo) =>
      documentsForRepo(repo, opts.token, false, 0, 0, caps.maxFileBytes, errors),
    );
    for (const ds of perRepo) docs.push(...ds);
  }

  const summary: GithubSummary = {
    user: label,
    reposFound: repos.length,
    reposIndexed: repos.length,
    filesIndexed,
    documents: docs.length,
    rateRemaining,
    deep,
    errors,
  };
  return { docs, summary };
}
