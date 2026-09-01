"use client";

import { useRef, useState } from "react";
import { idf, tfFactor } from "../lib/shardly";

/** A small line plot with a marked current point. */
function Plot({
  w = 340,
  h = 190,
  xLabel,
  yLabel,
  xMax,
  yMax,
  curves,
  point,
  zero,
  readout,
}: {
  w?: number;
  h?: number;
  xLabel: string;
  yLabel: string;
  xMax: number;
  yMax: number;
  curves: Array<{ f: (x: number) => number; label: string; on: boolean }>;
  point?: { x: number; y: number };
  zero?: boolean;
  /** Formats the value under the cursor. */
  readout: (x: number, y: number) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const px = (x: number) => pad.l + (x / xMax) * iw;
  const py = (y: number) =>
    pad.t + ih - ((y - (zero ? -yMax / 3 : 0)) / (yMax - (zero ? -yMax / 3 : 0))) * ih;

  const path = (f: (x: number) => number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const x = (i / 120) * xMax;
      pts.push(`${px(x).toFixed(1)},${py(f(x)).toFixed(1)}`);
    }
    return `M${pts.join(" L")}`;
  };

  const active = curves.find((c) => c.on) ?? curves[0]!;
  const hy = hoverX === null ? 0 : active.f(hoverX);

  // Map a pointer position onto the plot's own coordinate space, so the
  // readout works at any rendered size.
  const track = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const local = ((e.clientX - box.left) / box.width) * w;
    const frac = (local - pad.l) / iw;
    setHoverX(frac < 0 || frac > 1 ? null : frac * xMax);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: "100%", height: "auto", touchAction: "none" }}
      onPointerMove={track}
      onPointerLeave={() => setHoverX(null)}
    >
      <rect x={pad.l} y={pad.t} width={iw} height={ih} className="d-ghost" />
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={pad.l}
          y1={pad.t + ih * f}
          x2={pad.l + iw}
          y2={pad.t + ih * f}
          className="d-line"
          opacity="0.4"
        />
      ))}
      {zero ? (
        <line x1={pad.l} y1={py(0)} x2={pad.l + iw} y2={py(0)} className="d-dash" />
      ) : null}
      {curves.map((c) => (
        <path
          key={c.label}
          d={path(c.f)}
          fill="none"
          stroke={c.on ? "var(--accent)" : "var(--hair-solid)"}
          strokeWidth={c.on ? 1.6 : 1}
          strokeDasharray={c.on ? undefined : "3 3"}
        />
      ))}
      {point ? (
        <g>
          <line x1={px(point.x)} y1={pad.t} x2={px(point.x)} y2={pad.t + ih} className="d-dash" />
          <circle cx={px(point.x)} cy={py(point.y)} r="3.5" fill="var(--accent)" />
          <circle cx={px(point.x)} cy={py(point.y)} r="7" className="d-ac" />
        </g>
      ) : null}
      {hoverX !== null ? (
        <g>
          <line
            x1={px(hoverX)}
            y1={pad.t}
            x2={px(hoverX)}
            y2={pad.t + ih}
            stroke="var(--accent)"
            strokeWidth="1"
            opacity="0.5"
          />
          <circle cx={px(hoverX)} cy={py(hy)} r="3" fill="var(--accent)" />
          <text
            x={px(hoverX) < pad.l + iw / 2 ? px(hoverX) + 8 : px(hoverX) - 8}
            y={pad.t + 10}
            textAnchor={px(hoverX) < pad.l + iw / 2 ? "start" : "end"}
            className="d-t-s"
            style={{ fill: "var(--accent)" }}
          >
            {readout(hoverX, hy)}
          </text>
        </g>
      ) : null}
      {curves.map((c, i) => (
        <text
          key={c.label}
          x={pad.l + 6}
          y={pad.t + ih - 8 - (curves.length - 1 - i) * 12}
          className="d-t-s"
          style={c.on ? { fill: "var(--accent)" } : undefined}
        >
          {c.label}
        </text>
      ))}
      <text x={pad.l + iw} y={h - 6} textAnchor="end" className="d-t-s">
        {xLabel}
      </text>
      <text x="0" y={pad.t + 8} className="d-t-s">
        {yLabel}
      </text>
    </svg>
  );
}

function Slider({
  k,
  v,
  min,
  max,
  step = 1,
  fmt,
  on,
}: {
  k: string;
  v: number;
  min: number;
  max: number;
  step?: number;
  fmt?: (n: number) => string;
  on: (n: number) => void;
}) {
  return (
    <label className="ctl">
      <span className="ctl-head">
        <span className="k">{k}</span>
        <span className="v">{fmt ? fmt(v) : v}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => on(Number(e.target.value))}
      />
    </label>
  );
}

export default function LabBm25() {
  const [tf, setTf] = useState(4);
  const [docLen, setDocLen] = useState(220);
  const [avgdl, setAvgdl] = useState(260);
  const [n, setN] = useState(180);
  const [k1, setK1] = useState(1.5);
  const [b, setB] = useState(0.75);
  const N = 20000;

  const termIdf = idf(N, n);
  const factor = tfFactor(tf, docLen, avgdl, k1, b);
  const score = termIdf * factor;

  return (
    <div className="cut panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 22,
        }}
      >
        <p className="label label-ac">Lab 05 / one term, one document</p>
        <p className="label">N fixed at 20,000 documents</p>
      </div>

      <div className="cols">
        <div className="c-4">
          <div style={{ display: "grid", gap: 18 }}>
            <Slider k="tf · occurrences in this doc" v={tf} min={1} max={40} on={setTf} />
            <Slider k="|D| · this doc's length" v={docLen} min={10} max={1200} step={10} on={setDocLen} />
            <Slider k="avgdl · corpus average" v={avgdl} min={40} max={800} step={10} on={setAvgdl} />
            <Slider
              k="n · docs containing the term"
              v={n}
              min={1}
              max={19000}
              on={setN}
              fmt={(x) => `${x.toLocaleString()} of 20,000`}
            />
            <hr className="dot-rule" />
            <Slider k="k1 · saturation" v={k1} min={0} max={4} step={0.1} on={setK1} fmt={(x) => x.toFixed(1)} />
            <Slider k="b · length correction" v={b} min={0} max={1} step={0.05} on={setB} fmt={(x) => x.toFixed(2)} />
            <div className="btn-row">
              <button
                className="btn"
                onClick={() => {
                  setK1(1.5);
                  setB(0.75);
                }}
              >
                Reset to Shardly&apos;s defaults
              </button>
            </div>
          </div>

          <div
            className="cut"
            style={{
              marginTop: 26,
              padding: "18px 20px",
              background: "var(--acc-6)",
              borderColor: "var(--acc-30)",
            }}
          >
            <p className="label label-ac" style={{ marginBottom: 10 }}>
              Contribution to the score
            </p>
            <p
              className="display"
              style={{ fontSize: 52, margin: 0, color: "var(--accent)" }}
            >
              {score.toFixed(3)}
            </p>
            <p className="mono" style={{ margin: "12px 0 0", color: "var(--fg-3)", fontSize: 11 }}>
              idf {termIdf.toFixed(3)} × tf-factor {factor.toFixed(3)}
            </p>
          </div>
        </div>

        <div className="c-8">
          <div className="cols">
            <div className="c-6">
              <p className="label" style={{ marginBottom: 8 }}>
                A · Repeats saturate
              </p>
              <Plot
                xLabel="tf →"
                yLabel="factor"
                xMax={40}
                yMax={3.2}
                point={{ x: tf, y: factor }}
                readout={(x, y) =>
                  `${Math.round(x)} occurrences → ${y.toFixed(2)}`
                }
                curves={[
                  { f: (x) => tfFactor(x, docLen, avgdl, 0.4, b), label: "k1 = 0.4", on: false },
                  { f: (x) => tfFactor(x, docLen, avgdl, k1, b), label: `k1 = ${k1.toFixed(1)}`, on: true },
                  { f: (x) => tfFactor(x, docLen, avgdl, 4, b), label: "k1 = 4.0", on: false },
                ]}
              />
              <p className="label" style={{ marginTop: 8 }}>
                Raw frequency would be a straight line climbing forever. k1 bends it
                flat. Set k1 to 0 and every repeat past the first counts for nothing.
              </p>
            </div>

            <div className="c-6">
              <p className="label" style={{ marginBottom: 8 }}>
                B · Length is discounted
              </p>
              <Plot
                xLabel="|D| →"
                yLabel="factor"
                xMax={1200}
                yMax={3.2}
                point={{ x: docLen, y: factor }}
                readout={(x, y) =>
                  `${Math.round(x)} tokens → ${y.toFixed(2)}`
                }
                curves={[
                  { f: (x) => tfFactor(tf, x, avgdl, k1, 0), label: "b = 0", on: false },
                  { f: (x) => tfFactor(tf, x, avgdl, k1, b), label: `b = ${b.toFixed(2)}`, on: true },
                  { f: (x) => tfFactor(tf, x, avgdl, k1, 1), label: "b = 1", on: false },
                ]}
              />
              <p className="label" style={{ marginTop: 8 }}>
                At b = 0 the line is flat and a 10,000-word page wins on volume. At
                b = 1 depth is punished as padding. 0.75 sits between them.
              </p>
            </div>

            <div className="c-12" style={{ marginTop: 14 }}>
              <p className="label" style={{ marginBottom: 8 }}>
                C · Rarity is everything · why the + 1 inside the logarithm is not decoration
              </p>
              <Plot
                w={720}
                h={200}
                xLabel="n, documents containing the term →"
                yLabel="idf"
                xMax={20000}
                yMax={11}
                zero
                point={{ x: n, y: termIdf }}
                readout={(x, y) =>
                  `in ${Math.round(x).toLocaleString()} docs → idf ${y.toFixed(2)}`
                }
                curves={[
                  {
                    f: (x) => Math.log((N - Math.max(x, 1) + 0.5) / (Math.max(x, 1) + 0.5)),
                    label: "without the + 1 · goes negative past half the corpus",
                    on: false,
                  },
                  {
                    f: (x) => idf(N, Math.max(x, 1)),
                    label: "Shardly · log((N − n + 0.5) / (n + 0.5) + 1)",
                    on: true,
                  },
                ]}
              />
              <p className="label" style={{ marginTop: 8 }}>
                Drag n past 10,000 and watch the dashed line cross zero. Under that
                version, a document would lose points for containing a common query
                word. The + 1 keeps every contribution positive.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
