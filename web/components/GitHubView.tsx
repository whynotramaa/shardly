"use client";

import { useState } from "react";
import { ingestGithub, type GithubResult } from "@/lib/api";

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
      <label htmlFor="ghuser">GitHub username or organization</label>
      <div className="row">
        <input
          id="ghuser"
          type="text"
          value={user}
          placeholder="e.g. octocat"
          onChange={(e) => setUser(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
        />
        <button className="primary" onClick={run} disabled={busy || !user.trim()}>
          {busy ? "Fetching…" : "Fetch & index"}
        </button>
      </div>

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
        language, topics, stars, README). Then search across your whole account.
      </p>

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
