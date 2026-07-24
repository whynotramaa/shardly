"use client";

import { useState } from "react";
import Link from "next/link";
import { search, type SearchResponse } from "@/lib/api";
import { describe } from "@/lib/docmeta";


export default function TryItSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await search(q, 6));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
      setRes(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="tryit-box">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
          placeholder="query the live index ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â e.g. storage recovery"
          aria-label="Live search query"
        />
        <button onClick={run} disabled={busy || !q.trim()}>
          {busy ? "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦" : "Search"}
        </button>
      </div>

      {err && <div className="tryit-empty">Engine unreachable ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â {err}</div>}

      {res && (
        <>
          <div className="tryit-meta">
            {res.total.toLocaleString()} matches ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ranked in{" "}
            {res.tookMs.toFixed(2)} ms ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· terms [{res.terms.join(" ")}]
          </div>
          {res.hits.length === 0 ? (
            <div className="tryit-empty">
              Nothing indexed matched. Add documents in the workspace, then try
              again.
            </div>
          ) : (
            <div className="tryit-results">
              {res.hits.map((hit, i) => {
                const { title } = describe(hit.doc);
                return (
                  <Link
                    key={hit.docId}
                    href={`/document/${hit.docId}?q=${encodeURIComponent(res.query)}`}
                    className="tryit-row"
                  >
                    <span className="tryit-rank">{i + 1}</span>
                    <span className="tryit-title">{title}</span>
                    <span className="tryit-score">{hit.score.toFixed(3)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}







