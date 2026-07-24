"use client";

import { useState } from "react";
import { benchmark, type BenchmarkResponse } from "@/lib/api";

export default function BenchmarkView() {
  const [q, setQ] = useState("storage index recovery");
  const [res, setRes] = useState<BenchmarkResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await benchmark(q));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Benchmark failed");
      setRes(null);
    } finally {
      setBusy(false);
    }
  }

  // Bars are scaled to the slower (naive) time so the contrast is visible.
  const maxMs = res ? Math.max(res.naive.tookMs, res.indexed.tookMs) : 1;
  const pct = (ms: number) => Math.max((ms / maxMs) * 100, 4);

  return (
    <div>
      <div className="panel">
        <label htmlFor="bq">
          Run the same query two ways — inverted index vs. naive linear scan
        </label>
        <div className="row">
          <input
            id="bq"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? "Running…" : "Run benchmark"}
          </button>
        </div>
        <p className="hint">
          Both paths compute identical BM25 rankings. The naive path reads and
          tokenizes every document on disk; the indexed path jumps straight to
          the query terms&apos; posting lists.
        </p>
      </div>

      {err && <div className="notice err">{err}</div>}

      {res && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="bars">
            <div className="bar-row">
              <span className="bar-label">Naive scan</span>
              <div className="bar-track">
                <div
                  className="bar-fill naive"
                  style={{ width: `${pct(res.naive.tookMs)}%` }}
                >
                  {res.naive.tookMs.toFixed(1)} ms
                </div>
              </div>
            </div>
            <div className="bar-row">
              <span className="bar-label">Inverted index</span>
              <div className="bar-track">
                <div
                  className="bar-fill indexed"
                  style={{ width: `${pct(res.indexed.tookMs)}%` }}
                >
                  {res.indexed.tookMs.toFixed(2)} ms
                </div>
              </div>
            </div>
          </div>

          <div className="speedup-callout">
            <div className="speedup-number">{res.speedup.toFixed(0)}× faster</div>
            <div className="stat-pills" style={{ justifyContent: "center" }}>
              <span className="pill">
                naive scanned <b>{res.naive.scanned.toLocaleString()}</b> docs
              </span>
              <span className="pill">
                index examined <b>{res.indexed.scanned.toLocaleString()}</b>{" "}
                candidates
              </span>
              <span className="pill">
                top hit agrees:{" "}
                <b style={{ color: res.topHitsMatch ? "var(--good)" : "var(--bad)" }}>
                  {res.topHitsMatch ? "yes" : "no"}
                </b>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
