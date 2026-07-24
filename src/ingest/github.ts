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

  const docs: Document[] = [];
  for (const entry of candidates) {
    const blob = await gh<{ content?: string; encoding?: string }>(
      `/repos/${repo.full_name}/git/blobs/${entry.sha}`,
      token,
    );
    if (!blob.ok || !blob.data.content) continue;
    try {
      const content = Buffer.from(blob.data.content, "base64").toString("utf8");
      if (content.trim().length === 0) continue;
      docs.push({
        source: "github",
        type: "file",
        repo: repo.name,
        path: entry.path,
        url: `${repo.html_url}/blob/${repo.default_branch}/${entry.path}`,
        content,
      });
    } catch {
      errors.push(`failed to decode ${repo.full_name}/${entry.path}`);
    }
  }
  return docs;
}

/**
 * Fetch and build all documents for a GitHub account. Pure data-gathering — the
 * caller indexes the returned docs. Never leaves the store half-updated.
 */
export async function fetchGithubDocuments(
  opts: GithubOptions,
): Promise<{ docs: Document[]; summary: GithubSummary }> {
  const user = opts.user.trim();
  if (!user) throw new Error("a GitHub username is required");

  const maxRepos = opts.maxRepos ?? 100;
  const maxFilesPerRepo = opts.maxFilesPerRepo ?? 25;
  const maxTotalFiles = opts.maxTotalFiles ?? 400;
  const maxFileBytes = opts.maxFileBytes ?? 120_000;
  const deep = opts.deep ?? false;
  const errors: string[] = [];

  const { repos, rateRemaining: listRate } = await listRepos(
    user,
    opts.token,
    maxRepos,
  );

  const docs: Document[] = [];
  let filesIndexed = 0;
  let rateRemaining = listRate;

  for (const repo of repos) {
    const readme = await fetchReadme(repo.full_name, opts.token).catch(() => undefined);
    docs.push(repoDoc(repo, readme));

    if (deep && filesIndexed < maxTotalFiles) {
      const remaining = maxTotalFiles - filesIndexed;
      const fileDocs = await fetchRepoFiles(
        repo,
        opts.token,
        Math.min(maxFilesPerRepo, remaining),
        maxFileBytes,
        errors,
      ).catch((e) => {
        errors.push(`${repo.full_name}: ${e instanceof Error ? e.message : e}`);
        return [] as Document[];
      });
      filesIndexed += fileDocs.length;
      docs.push(...fileDocs);
    }
  }

  const summary: GithubSummary = {
    user,
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
