"use client";

import { useEffect, useState } from "react";
import { ingestGithub, type GithubResult } from "@/lib/api";

function GithubProgress({ deep }: { deep: boolean }) {
  const stages = [
    "Resolving target",
    "Listing repositories",
    "Fetching READMEs & metadata",
    ...(deep ? ["Reading source files"] : []),
    "Tokenizing & indexing",
  ];
  const [active, setActive] = useState(0);

  useEffect(() => {
    // Advance through stages, then hold on the last until the request resolves.
    const id = setInterval(() => {
      setActive((a) => Math.min(a + 1, stages.length - 1));
    }, 2200);
    return () => clearInterval(id);
  }, [stages.length]);

  return (
    <div className="loader">
      <div className="loader-head">
        <span className="loader-spin" />
        Fetching from GitHub — this can take a moment for large accounts
      </div>
      <div className="loader-bar" />
      <div className="stages">
        {stages.map((label, i) => (
          <div
            key={label}
            className={`stage${i === active ? " active" : i < active ? " done" : ""}`}
          >
            <span className="stage-mark" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GitHubView({ onIngested }: { onIngested: () => void }) {
  const [user, setUser] = useState("");
  const [token, setToken] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GithubResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!user.trim()) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(
        await ingestGithub({
          user: user.trim(),
          token: token.trim() || undefined,
          deep,
        }),
      );
      onIngested();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "GitHub indexing failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <label htmlFor="ghuser">GitHub account or repository</label>
      <div className="row">
        <input
          id="ghuser"
          type="text"
          value={user}
          placeholder="octocat  ·  octocat/Hello-World  ·  https://github.com/user/repo"
          onChange={(e) => setUser(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
        />
        <button className="primary" onClick={run} disabled={busy || !user.trim()}>
          {busy ? "Fetching…" : "Fetch & index"}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Enter a whole account to index every repo, or a single{" "}
        <code>owner/repo</code> (or its URL) to index just that one.
      </p>

      <div style={{ marginTop: 14 }}>
        <label htmlFor="ghtoken">
          Personal access token{" "}
          <span style={{ color: "var(--muted)" }}>
            — optional, for private repos &amp; a higher rate limit (60 → 5000/hr)
          </span>
        </label>
        <input
          id="ghtoken"
          type="password"
          value={token}
          placeholder="ghp_… (never stored; used for this request only)"
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={deep}
          onChange={(e) => setDeep(e.target.checked)}
        />
        <span>
          <b>Deep index</b> — also index each repo&apos;s source files (many more
          API calls; a token is recommended)
        </span>
      </label>

      <p className="hint">
        Default mode indexes one document per repository (name, description,
        language, topics, stars, README). Then search across everything you
        indexed.
      </p>

      {busy && <GithubProgress deep={deep} />}

      {result && (
        <div className="notice ok">
          Indexed <b>{result.reposIndexed}</b> repositor
          {result.reposIndexed === 1 ? "y" : "ies"}
          {result.deep && (
            <>
              {" "}
              and <b>{result.filesIndexed}</b> source file
              {result.filesIndexed === 1 ? "" : "s"}
            </>
          )}{" "}
          for <b>{result.user}</b> — {result.documents} document
          {result.documents === 1 ? "" : "s"} added.
          {result.rateRemaining !== null && (
            <span style={{ color: "var(--muted)" }}>
              {" "}
              ({result.rateRemaining} API calls left this hour)
            </span>
          )}
          <div style={{ marginTop: 6 }}>Head to the <b>Search</b> tab.</div>
        </div>
      )}
      {result && result.errors.length > 0 && (
        <div className="file-report">
          {result.errors.slice(0, 5).map((msg, i) => (
            <div key={i} className="file-line skipped">
              <span className="badge skip">warn</span>
              <span className="reason">{msg}</span>
            </div>
          ))}
        </div>
      )}
      {err && <div className="notice err">{err}</div>}
    </div>
  );
}
