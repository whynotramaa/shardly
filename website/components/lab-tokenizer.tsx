"use client";

import { useMemo, useState } from "react";
import { traceTokens, tokenize, STOPWORDS } from "../lib/shardly";

const PRESETS = [
  "Zürich cafés are running distributed queries",
  "The storage layer has caches and the caches have policies",
  "running runs ran run",
  "have having has had",
  "東京 検索 エンジン",
];

/** The real tokenizer, running in the browser, stage by stage. */
export default function LabTokenizer() {
  const [text, setText] = useState(PRESETS[0]!);
  const trace = useMemo(() => traceTokens(text), [text]);
  const tokens = useMemo(() => tokenize(text), [text]);
  const hitStops = useMemo(() => {
    const s = new Set<string>();
    for (const w of trace)
      for (const r of w.results) if (r.dropped) s.add(r.piece);
    return s;
  }, [trace]);

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
        <p className="label label-ac">Lab 03 / the tokenizer, ported verbatim</p>
        <p className="label">Type anything</p>
      </div>

      <input
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Text to tokenize"
        spellCheck={false}
      />

      <div className="btn-row" style={{ marginTop: 10 }}>
        {PRESETS.map((p) => (
          <button
            key={p}
            className="btn"
            data-on={p === text ? "1" : "0"}
            onClick={() => setText(p)}
          >
            {p.length > 24 ? `${p.slice(0, 24)}…` : p}
          </button>
        ))}
      </div>

      <div className="tbl-wrap" style={{ marginTop: 26 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Input word</th>
              <th>Lowercased</th>
              <th>After the ASCII split</th>
              <th>Rule that fired</th>
              <th>Token emitted</th>
            </tr>
          </thead>
          <tbody>
            {trace.map((w, wi) => (
              <tr key={wi}>
                <td className="mono">{w.raw}</td>
                <td className="mono" style={{ color: "var(--fg-3)" }}>
                  {w.lowered}
                </td>
                <td className="mono" style={{ color: "var(--fg-3)" }}>
                  {w.pieces.length === 0 ? "∅" : w.pieces.join(" · ")}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {w.results.length === 0
                    ? "nothing survived"
                    : w.results.map((r) => r.rule).join(" · ")}
                </td>
                <td className="mono" style={{ color: "var(--accent)" }}>
                  {w.results.filter((r) => !r.dropped).length === 0
                    ? "—"
                    : w.results
                        .filter((r) => !r.dropped)
                        .map((r) => r.stem)
                        .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 26 }}>
        <p className="label" style={{ marginBottom: 10 }}>
          Output · {tokens.length} token{tokens.length === 1 ? "" : "s"}, duplicates kept because term frequency needs them
        </p>
        <div className="tag-row">
          {tokens.length === 0 ? (
            <span className="tag tag-ac">nothing indexable</span>
          ) : (
            tokens.map((t, i) => (
              <span key={i} className="tag tag-ac">
                {t}
              </span>
            ))
          )}
        </div>
      </div>

      <hr className="dot-rule" style={{ margin: "26px 0 20px" }} />

      <p className="label" style={{ marginBottom: 12 }}>
        The complete stopword list · {STOPWORDS.length} surface forms, checked
        before stemming
      </p>
      <div
        className="cellgrid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))" }}
      >
        {STOPWORDS.map((w) => {
          const on = hitStops.has(w);
          return (
            <span
              key={w}
              className="mono"
              style={{
                background: on ? "var(--accent-block)" : "transparent",
                color: on ? "var(--on-accent)" : "var(--fg-3)",
                padding: "7px 6px",
                textAlign: "center",
                fontSize: 11,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      <p className="label" style={{ marginTop: 12 }}>
        Because the check runs before stemming, <code>have</code> and{" "}
        <code>has</code> are dropped while <code>having</code> stems to{" "}
        <code>hav</code> and survives.
      </p>
    </div>
  );
}
