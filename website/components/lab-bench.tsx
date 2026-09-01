"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Replays the recorded benchmark at 1/175 speed. Both bars advance on the same
 * clock, so the gap you see is the gap that was measured.
 */

interface Row {
  q: string;
  indexed: number;
  naive: number;
  /** The ratio the run recorded, not one recomputed from rounded numbers. */
  ratio: number;
}

const RUNS: Record<string, { docs: string; note: string; rows: Row[] }> = {
  "20k": {
    docs: "20,000 seeded documents",
    note: "npm run bench -- /tmp/shardly-demo · warm-up discarded, five runs averaged",
    rows: [
      { q: "vector", indexed: 2.2, naive: 372.3, ratio: 172 },
      { q: "checksum integrity corruption", indexed: 3.3, naive: 404.0, ratio: 121 },
      { q: "distributed replication shard", indexed: 4.3, naive: 385.5, ratio: 89 },
      { q: "crash recovery latency", indexed: 4.4, naive: 415.2, ratio: 94 },
      { q: "storage index", indexed: 4.8, naive: 423.1, ratio: 87 },
    ],
  },
  "50k": {
    docs: "50,000 seeded documents",
    note: "the run recorded in README.md · five-run averages",
    rows: [
      { q: "vector", indexed: 5.98, naive: 747.4, ratio: 125 },
      { q: "checksum integrity corruption", indexed: 15.47, naive: 797.5, ratio: 52 },
      { q: "storage index", indexed: 17.41, naive: 815.9, ratio: 47 },
      { q: "crash recovery latency", indexed: 20.61, naive: 840.8, ratio: 41 },
    ],
  },
};

const DURATION = 2600; // ms of wall clock for the slowest bar

export default function LabBench() {
  const [size, setSize] = useState<"20k" | "50k">("20k");
  const [pick, setPick] = useState(0);
  const [t, setT] = useState(1);
  const raf = useRef(0);

  const run = RUNS[size]!;
  const row = run.rows[Math.min(pick, run.rows.length - 1)]!;
  const speedup = row.ratio;

  const start = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min((performance.now() - t0) / DURATION, 1);
      setT(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    setT(0);
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const naiveMs = row.naive * t;
  const indexedMs = Math.min(row.indexed, row.naive * t);
  const indexedDone = row.naive * t >= row.indexed;

  return (
    <div className="cut panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <p className="label label-ac">Lab 06 / the same query, both ways</p>
        <p className="label">{run.note}</p>
      </div>

      <div className="btn-row" style={{ marginBottom: 10 }}>
        {(["20k", "50k"] as const).map((s) => (
          <button
            key={s}
            className="btn"
            data-on={size === s ? "1" : "0"}
            onClick={() => {
              setSize(s);
              setPick(0);
              setT(1);
            }}
          >
            {RUNS[s]!.docs}
          </button>
        ))}
      </div>

      <div className="btn-row" style={{ marginBottom: 24 }}>
        {run.rows.map((r, i) => (
          <button
            key={r.q}
            className="btn"
            data-on={i === pick ? "1" : "0"}
            onClick={() => {
              setPick(i);
              setT(1);
            }}
          >
            {r.q}
          </button>
        ))}
        <button className="btn btn-solid" onClick={start}>
          Run it
        </button>
      </div>

      {[
        {
          k: "Indexed",
          sub: "walk posting lists, score candidates, seek 10 documents",
          ms: indexedMs,
          w: (indexedMs / row.naive) * 100,
          done: indexedDone,
          ac: true,
        },
        {
          k: "Unindexed",
          sub: "read and re-tokenize every document on disk, then score the corpus",
          ms: naiveMs,
          w: t * 100,
          done: t >= 1,
          ac: false,
        },
      ].map((bar) => (
        <div key={bar.k} style={{ marginBottom: 26 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              marginBottom: 8,
            }}
          >
            <span className="label" style={bar.ac ? { color: "var(--accent)" } : undefined}>
              {bar.k} · {bar.sub}
            </span>
            <span
              className="mono"
              style={{ fontSize: 15, color: bar.ac ? "var(--accent)" : "var(--fg)" }}
            >
              {bar.ms.toFixed(2)} ms{bar.done ? "" : " …"}
            </span>
          </div>
          <div
            title={`${bar.k}: ${bar.sub}. Recorded at ${(bar.ac ? row.indexed : row.naive).toFixed(2)} ms on ${run.docs}.`}
            style={{
              height: 22,
              background: "var(--wash-5)",
              border: "1px solid var(--hair)",
              cursor: "help",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(bar.w, 0.25)}%`,
                background: bar.ac ? "var(--accent)" : "var(--wash-28)",
              }}
            />
          </div>
        </div>
      ))}

      <div className="cols" style={{ marginTop: 30 }}>
        <div className="c-3">
          <span className="stat">
            <span className="v" style={{ color: "var(--accent)" }}>
              {speedup}×
            </span>
            <span className="u">Ratio</span>
          </span>
        </div>
        <div className="c-3">
          <span className="stat">
            <span className="v">agrees</span>
            <span className="u">Top hit, both paths</span>
          </span>
        </div>
        <div className="c-6">
          <p className="label" style={{ marginBottom: 10 }}>
            Read the second bar for what it is
          </p>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--fg-2)", lineHeight: 1.6 }}>
            <code style={{ color: "var(--accent-hi)" }}>naiveSearch()</code> re-reads
            and re-tokenizes every document from disk on every call. The comparison
            is <em style={{ color: "var(--fg)" }}>no index at all</em> against{" "}
            <em style={{ color: "var(--fg)" }}>index already built</em>, not linear
            scan against index lookup. Building the index is paid once at ingest and
            appears in neither column. A pre-tokenized linear scan would land
            somewhere between the two.
          </p>
        </div>
      </div>
    </div>
  );
}
