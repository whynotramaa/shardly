"use client";

import { useState } from "react";
import { benchmark, type BenchmarkResponse } from "@/lib/api";
import { Icon } from "@/components/ui";

export default function BenchmarkView() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<BenchmarkResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try { setRes(await benchmark(q)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Benchmark failed"); setRes(null); }
    finally { setBusy(false); }
  }

  const maxMs = res ? Math.max(res.naive.tookMs, res.indexed.tookMs) : 1;
  const pct = (ms: number) => Math.max((ms / maxMs) * 100, 1.5);

  return (
    <section className="source">
      <span className="source-icon"><Icon name="pulse" size={18} /></span>
      <div className="source-body">
        <h2>Benchmark</h2>
        <p className="hint">Run one query through the index and through a full scan. Both rank with BM25.</p>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="replication shard" aria-label="Benchmark query" spellCheck={false} />
          <button className="button small" disabled={busy || !q.trim()}>{busy ? "Running…" : "Run"}</button>
        </form>
        {err && <p className="alert" role="alert">{err}</p>}
        {res && (
          <div className="race" key={res.query + res.indexed.tookMs}>
            <div className="race-row">
              <span>Full scan</span>
              <span className="race-track"><span className="race-bar slow" style={{ width: `${pct(res.naive.tookMs)}%` }} /></span>
              <span className="mono">{res.naive.tookMs.toFixed(1)} ms</span>
            </div>
            <div className="race-row">
              <span>Index</span>
              <span className="race-track"><span className="race-bar" style={{ width: `${pct(res.indexed.tookMs)}%` }} /></span>
              <span className="mono">{res.indexed.tookMs.toFixed(2)} ms</span>
            </div>
            <p className="row-meta">
              <b className="accent">{res.speedup.toFixed(0)}× faster</b> · scanned {res.naive.scanned.toLocaleString()} docs vs {res.indexed.scanned.toLocaleString()} candidates · top hit {res.topHitsMatch ? "agrees" : "differs"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
