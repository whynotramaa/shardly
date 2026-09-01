"use client";

import { useState } from "react";
import Link from "next/link";
import { search, type SearchResponse, type SearchHit } from "@/lib/api";
import { describe, snippet } from "@/lib/docmeta";

/** A column heading with an ⓘ hover tooltip explaining the metric. */
function Tip({
  label,
  tip,
  align = "center",
}: {
  label: string;
  tip: string;
  align?: "left" | "center" | "right";
}) {
  const cls =
    align === "left" ? "tip tip-left" : align === "right" ? "tip tip-right" : "tip";
  return (
    <span className={cls} data-tip={tip}>
      {label}
      <i className="tip-i">i</i>
    </span>
  );
}

export default function SearchView() {
  const [q, setQ] = useState("");
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
            placeholder="Search your indexed documents — e.g. storage crash recovery"
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
        <HitCard key={hit.docId} hit={hit} rank={i + 1} query={res.query} />
      ))}
    </div>
  );
}

function HitCard({
  hit,
  rank,
  query,
}: {
  hit: SearchHit;
  rank: number;
  query: string;
}) {
  const { title, badge } = describe(hit.doc);
  // Scale each term's contribution bar against the largest one in this hit.
  const maxContribution = Math.max(...hit.breakdown.map((b) => b.contribution), 1e-9);
  const href = `/document/${hit.docId}?q=${encodeURIComponent(query)}`;

  return (
    <div className="hit">
      <Link href={href} className="hit-open">
        <div className="hit-head">
          <div>
            <span className={`badge src-${badge.split(" ")[0]}`}>{badge}</span>{" "}
            <span style={{ fontWeight: 600 }}>
              {rank}. {title}
            </span>
            <div className="hit-snippet">{snippet(hit.doc)}</div>
          </div>
          <div className="hit-score-wrap">
            <span className="score">{hit.score.toFixed(4)}</span>
            <span className="open-hint">open →</span>
          </div>
        </div>
      </Link>

      <details className="breakdown-details">
        <summary>Why this ranked here — BM25 breakdown</summary>
        <p className="breakdown-intro">
          BM25 scores each match by combining three signals per query term —
          term frequency (<code>tf</code>), inverse document frequency (
          <code>idf</code>), and document-length normalization. Hover a column
          heading for what it means.
        </p>
        <div className="breakdown">
          <table>
            <thead>
              <tr>
                <th>
                  <Tip
                    label="term"
                    tip="A query word after tokenizing + stemming. Each term contributes to the score independently."
                    align="left"
                  />
                </th>
                <th>
                  <Tip
                    label="tf"
                    tip="Term frequency — how many times this term appears in the document. BM25 saturates it: the 10th occurrence adds far less than the 2nd (controlled by k1 = 1.5)."
                  />
                </th>
                <th>
                  <Tip
                    label="idf"
                    tip="Inverse document frequency — how rare the term is across the whole corpus. Rare terms weigh heavily; a term in every document weighs almost nothing."
                  />
                </th>
                <th>
                  <Tip
                    label="contribution"
                    tip="This term's share of the final score = idf × saturated tf × length normalization (b = 0.75)."
                  />
                </th>
                <th>
                  <Tip
                    label="weight"
                    tip="The contribution as a fraction of this document's single largest term contribution — the bars are relative, not absolute."
                    align="right"
                  />
                </th>
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
                  <td className="weight-cell">
                    <span
                      className="weight-bar"
                      style={{ width: `${(b.contribution / maxContribution) * 100}%` }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>total score</td>
                <td>{hit.score.toFixed(4)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </details>
    </div>
  );
}
