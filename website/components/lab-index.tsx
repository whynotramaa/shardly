"use client";

import { useMemo, useState } from "react";
import { buildIndex, rank, tokenize, type MiniDoc } from "../lib/shardly";

const CORPUS: MiniDoc[] = [
  {
    id: "D1",
    title: "Crash recovery",
    text: "A write-ahead log records intent before data. On restart the log replays and verifies each pending record against the segment bytes.",
  },
  {
    id: "D2",
    title: "Segment storage",
    text: "Segments are append-only files. Storage never rewrites a record in place, so a crash can only damage the tail of the newest segment.",
  },
  {
    id: "D3",
    title: "Ranking with BM25",
    text: "BM25 scores a document by term frequency, inverse document frequency, and length. Rare terms weigh more than common terms.",
  },
  {
    id: "D4",
    title: "Index deletion cost",
    text: "Deleting a document from an inverted index means visiting every posting list that document contributed a term to.",
  },
  {
    id: "D5",
    title: "Compaction",
    text: "Compaction rewrites live records into fresh segments and drops the tombstoned ones. The offset snapshot is the commit point.",
  },
];

export default function LabIndex() {
  const [q, setQ] = useState("segment crash recovery");
  const [shown, setShown] = useState(3);

  const index = useMemo(() => buildIndex(CORPUS), []);
  const terms = useMemo(() => [...new Set(tokenize(q))], [q]);
  const hits = useMemo(() => rank(index, terms), [index, terms]);

  const matched = new Set(terms.filter((t) => (index.postings.get(t) ?? []).length > 0));
  const sortedTerms = useMemo(
    () =>
      [...index.postings.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])),
    [index],
  );
  const candidateIds = new Set(hits.map((h) => h.docId));

  return (
    <div className="cut panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <p className="label label-ac">Lab 04 / a five-document index, live</p>
        <p className="label">Real tokenizer, real BM25</p>
      </div>

      <input
        className="field"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Type a query"
        aria-label="Query"
        spellCheck={false}
      />

      <div className="cols" style={{ marginTop: 24 }}>
        <div className="c-5">
          <p className="label" style={{ marginBottom: 12 }}>
            The corpus · every document that exists
          </p>
          {CORPUS.map((d) => {
            const lit = candidateIds.has(d.id);
            return (
              <div
                key={d.id}
                style={{
                  borderLeft: `2px solid ${lit ? "var(--accent)" : "var(--hair)"}`,
                  paddingLeft: 14,
                  marginBottom: 14,
                  opacity: lit ? 1 : 0.42,
                  transition: "opacity 0.2s linear",
                }}
              >
                <p className="label" style={{ color: lit ? "var(--accent)" : undefined }}>
                  {d.id} · {index.docLengths.get(d.id)} tokens
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--fg-2)" }}>
                  <strong style={{ color: "var(--fg)" }}>{d.title}.</strong> {d.text}
                </p>
              </div>
            );
          })}
        </div>

        <div className="c-7">
          <p className="label" style={{ marginBottom: 12 }}>
            Posting lists · {index.postings.size} terms, showing the{" "}
            {Math.min(shown * 12, index.postings.size)} most common
          </p>
          <div
            className="cellgrid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              maxHeight: 300,
              overflowY: "auto",
            }}
          >
            {sortedTerms.slice(0, shown * 12).map(([term, list]) => {
              const on = matched.has(term);
              return (
                <div
                  key={term}
                  style={{
                    background: on ? "var(--acc-16)" : "transparent",
                    padding: "8px 10px",
                    borderLeft: on ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  <p
                    className="mono"
                    style={{
                      margin: 0,
                      fontSize: 11.5,
                      color: on ? "var(--accent)" : "var(--fg)",
                    }}
                  >
                    {term}
                  </p>
                  <p className="mono" style={{ margin: "3px 0 0", fontSize: 10, color: "var(--fg-3)" }}>
                    {list.map((p) => `${p.docId}×${p.termFrequency}`).join("  ")}
                  </p>
                </div>
              );
            })}
          </div>
          {shown * 12 < index.postings.size ? (
            <button
              className="btn"
              style={{ marginTop: 10 }}
              onClick={() => setShown((s) => s + 3)}
            >
              Show more terms
            </button>
          ) : null}
        </div>
      </div>

      <hr className="dot-rule" style={{ margin: "26px 0 20px" }} />

      <div className="cols">
        <div className="c-4">
          <p className="label" style={{ marginBottom: 12 }}>What the engine did</p>
          <dl className="dl" style={{ margin: 0 }}>
            <div className="dl-row">
              <dt>Query terms</dt>
              <dd className="mono" style={{ color: "var(--accent)" }}>
                {terms.length ? terms.join(" · ") : "—"}
              </dd>
            </div>
            <div className="dl-row">
              <dt>Lists unioned</dt>
              <dd className="mono">{matched.size}</dd>
            </div>
            <div className="dl-row">
              <dt>Candidates</dt>
              <dd className="mono">{hits.length} of {CORPUS.length}</dd>
            </div>
            <div className="dl-row">
              <dt>Docs read</dt>
              <dd className="mono" style={{ color: "var(--accent)" }}>
                {hits.length} · only the winners
              </dd>
            </div>
            <div className="dl-row">
              <dt>Docs scanned</dt>
              <dd className="mono">0</dd>
            </div>
          </dl>
        </div>

        <div className="c-8">
          <p className="label" style={{ marginBottom: 12 }}>
            Ranked, with the score broken down term by term
          </p>
          {hits.length === 0 ? (
            <p className="mono" style={{ color: "var(--fg-3)" }}>
              No posting list contains any query term. Nothing was read from disk.
            </p>
          ) : (
            hits.map((h, i) => {
              const doc = CORPUS.find((d) => d.id === h.docId)!;
              const max = hits[0]!.score;
              return (
                <div
                  key={h.docId}
                  style={{
                    borderTop: "1px solid var(--hair)",
                    padding: "12px 0",
                  }}
                >
                  <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    <span className="label label-ac">{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ fontSize: 14, color: "var(--fg)" }}>{doc.title}</span>
                    <span
                      className="mono"
                      style={{ marginLeft: "auto", color: "var(--accent)" }}
                    >
                      {h.score.toFixed(3)}
                    </span>
                  </div>
                  <div style={{ display: "flex", height: 8, marginTop: 8, gap: 1 }}>
                    {h.breakdown.map((b) => (
                      <div
                        key={b.term}
                        title={`${b.term}: tf ${b.termFrequency}, idf ${b.idf.toFixed(2)}`}
                        style={{
                          width: `${(b.contribution / max) * 100}%`,
                          background: "var(--accent)",
                          opacity: 0.4 + 0.6 * (b.contribution / h.score),
                        }}
                      />
                    ))}
                    <div style={{ flex: 1, background: "var(--wash-6)" }} />
                  </div>
                  <p className="mono" style={{ margin: "8px 0 0", fontSize: 10.5, color: "var(--fg-3)" }}>
                    {h.breakdown
                      .map(
                        (b) =>
                          `${b.term} tf=${b.termFrequency} idf=${b.idf.toFixed(2)} → ${b.contribution.toFixed(3)}`,
                      )
                      .join("   ")}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
