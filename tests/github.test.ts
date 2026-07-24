import { describe, it, expect } from "vitest";
import { parseGithubTarget } from "../src/ingest/github.js";

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
