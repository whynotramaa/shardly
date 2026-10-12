import { describe, it, expect, afterEach, vi } from "vitest";
import { parseGithubTarget, fetchGithubDocuments } from "../src/ingest/github.js";

afterEach(() => vi.unstubAllGlobals());

describe("parseGithubTarget", () => {
  it("treats a bare name as a user/account", () => {
    expect(parseGithubTarget("octocat")).toEqual({ kind: "user", user: "octocat" });
  });

  it("treats owner/repo as a single repository", () => {
    expect(parseGithubTarget("octocat/Hello-World")).toEqual({
      kind: "repo",
      owner: "octocat",
      repo: "Hello-World",
    });
  });

  it("parses a full GitHub URL", () => {
    expect(parseGithubTarget("https://github.com/octocat/Spoon-Knife")).toEqual({
      kind: "repo",
      owner: "octocat",
      repo: "Spoon-Knife",
    });
  });

  it("strips a trailing .git and slashes", () => {
    expect(parseGithubTarget("https://github.com/facebook/react.git/")).toEqual({
      kind: "repo",
      owner: "facebook",
      repo: "react",
    });
  });

  it("handles a user URL", () => {
    expect(parseGithubTarget("https://github.com/torvalds")).toEqual({
      kind: "user",
      user: "torvalds",
    });
  });
});

describe("GitHub import identities", () => {
  it("uses canonical repository identities and case-sensitive file paths", async () => {
    const repo = { name: "Core", full_name: "Demo/Core", description: "demo", language: "TypeScript", stargazers_count: 3, forks_count: 1, html_url: "https://github.com/Demo/Core", updated_at: "2026-01-01", private: false, default_branch: "main", fork: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/readme")) return new Response("# Core guide");
      if (url.includes("/git/trees/")) return Response.json({ tree: [{ path: "src/Core.ts", type: "blob", size: 40, sha: "test-sha" }] });
      if (url.includes("/git/blobs/")) return Response.json({ content: Buffer.from("export const value = 1;").toString("base64") });
      return Response.json(repo);
    }));
    const { docs } = await fetchGithubDocuments({ user: "Demo/Core", deep: true });
    expect(docs.map(doc => doc.sourceId)).toEqual(["github:demo/core:repository", "github:demo/core:file:src/Core.ts"]);
    expect(docs.map(doc => doc.repo)).toEqual(["Demo/Core", "Demo/Core"]);
    expect(docs[1]?.language).toBe("TypeScript");
  });
});
