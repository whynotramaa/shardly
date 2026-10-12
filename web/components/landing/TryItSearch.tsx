"use client";

import { useState } from "react";
import Link from "next/link";
import { search, type SearchResponse } from "@/lib/api";
import { describe, snippet } from "@/lib/docmeta";
import { Icon } from "@/components/ui";

export default function TryItSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try { setRes(await search(q, 5)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Search failed"); setRes(null); }
    finally { setBusy(false); }
  }

  return (
    <div className="tryit">
      <form className={`searchbox${busy ? " busy" : ""}`} role="search" onSubmit={(e) => { e.preventDefault(); if (!busy) void run(); }}>
        <Icon name="search" size={18} />
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “crash recovery”" aria-label="Search the live index" spellCheck={false} />
        <button className="button solid search-go" disabled={busy || !q.trim()}>{busy ? "Searching" : "Search"}</button>
        <span className="scanline" aria-hidden />
      </form>
      {err && <p className="hint">The engine is not reachable. Start the API, then try again.</p>}
      {res && (
        <div className="tryit-results" key={res.query}>
          <p className="row-meta"><b>{res.total.toLocaleString()}</b> matches <span className="mono">{res.tookMs.toFixed(1)} ms</span></p>
          {res.hits.length === 0 ? (
            <p className="hint">Nothing matched. Add documents in the app, then search again.</p>
          ) : (
            <ol className="hits">
              {res.hits.map((hit, i) => {
                const { title, badge } = describe(hit.doc);
                return (
                  <li key={hit.docId} className="hit" style={{ "--i": i } as React.CSSProperties}>
                    <Link className="hit-open" href={`/document/${encodeURIComponent(hit.docId)}?q=${encodeURIComponent(res.query)}`}>
                      <span className="hit-title"><span className="tag">{badge}</span>{title}</span>
                      <span className="hit-snippet">{hit.snippet?.text ?? snippet(hit.doc, 160)}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
          <Link href={`/app?q=${encodeURIComponent(res.query)}`} className="text-button">See all results in the app<Icon name="arrow" size={14} /></Link>
        </div>
      )}
    </div>
  );
}
