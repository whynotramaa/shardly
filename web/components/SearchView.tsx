"use client";

import { useState } from "react";
import { search, type SearchResponse, type SearchHit } from "@/lib/api";

export default function SearchView() {
  const [q, setQ] = useState("storage index recovery");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await search(q, 10));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
      setRes(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="panel">
        <label htmlFor="q">Full-text query</label>
        <div className="row">
          <input
            id="q"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. distributed storage recovery"
          />
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
        {res && (
          <div className="stat-pills">
            <span className="pill">
              <b>{res.total.toLocaleString()}</b> matches
            </span>
            <span className="pill">
              ranked in <b>{res.tookMs.toFixed(2)} ms</b>
            </span>
            <span className="pill">
              terms:{" "}
              {res.terms.map((t) => (
                <span key={t} className="term-chip" style={{ marginLeft: 4 }}>
                  {t}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>

      {err && <div className="notice err">{err}</div>}

      {res && res.hits.length === 0 && !err && (
        <p className="meta">No documents matched.</p>
      )}

      {res?.hits.map((hit, i) => (
        <HitCard key={hit.docId} hit={hit} rank={i + 1} />
      ))}
    </div>
  );
}

/** A human title + a source badge derived from the document's shape. */
function describe(doc: Record<string, unknown>): { title: string; badge: string } {
  if (doc.source === "github") {
    if (doc.type === "file") {
      return { title: `${doc.repo}/${doc.path}`, badge: "github file" };
    }
    return { title: String(doc.fullName ?? doc.repo ?? "repo"), badge: "github repo" };
  }
  if (doc.type === "pdf") {
    return { title: String(doc.filename ?? "document.pdf"), badge: "pdf" };
  }
  if (typeof doc.filename === "string") {
    return { title: doc.filename, badge: "file" };
  }
  return {
    title: String(doc.title ?? doc.name ?? "Document"),
    badge: "json",
  };
}

function HitCard({ hit, rank }: { hit: SearchHit; rank: number }) {
  const { title, badge } = describe(hit.doc);
  return (
    <div className="hit">
      <div className="hit-head">
        <div>
          <span className={`badge src-${badge.split(" ")[0]}`}>{badge}</span>{" "}
          <span style={{ fontWeight: 600 }}>
            {rank}. {title}
          </span>
          <div className="docid">
            {typeof hit.doc.url === "string" ? (
              <a href={hit.doc.url} target="_blank" rel="noreferrer">
                {hit.doc.url}
              </a>
            ) : (
              hit.docId
            )}
          </div>
        </div>
        <span className="score">{hit.score.toFixed(4)}</span>
      </div>

      <div className="breakdown">
        <table>
          <thead>
            <tr>
              <th>term</th>
              <th>tf</th>
              <th>idf</th>
              <th>contribution</th>
            </tr>
          </thead>
          <tbody>
            {hit.breakdown.map((b) => (
              <tr key={b.term}>
                <td>
                  <span className="term-chip">{b.term}</span>
                </td>
                <td>{b.termFrequency}</td>
                <td>{b.idf.toFixed(3)}</td>
                <td>{b.contribution.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <pre className="doc-json">{JSON.stringify(hit.doc, null, 2)}</pre>
    </div>
  );
}
