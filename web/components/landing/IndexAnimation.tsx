"use client";

import { useEffect, useMemo, useRef, useState } from "react";



const SEGMENTS = 6;
const COLS = 3;
const ROWS = 6;
const DEMO_TERMS = [
  "storage",
  "recovery",
  "segment",
  "inverted",
  "durability",
  "offset",
  "posting",
];

// Geometry (SVG user units; the SVG scales responsively).
const SEG_X0 = 40;
const SEG_W = 66;
const SEG_GAP = 18;
const SEG_Y = 50;
const SEG_H = 150;
const RES_X = 690;
const RES_Y = 100;
const RES_W = 180;
const RES_H = 52;
const ANCHOR_X = RES_X;
const ANCHOR_Y = RES_Y + RES_H / 2;

function dotX(seg: number, c: number) {
  return SEG_X0 + seg * (SEG_W + SEG_GAP) + 15 + c * 18;
}
function dotY(r: number) {
  return SEG_Y + 18 + r * 22;
}

// Small deterministic hash + PRNG so a term maps to a fixed posting pattern.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Frame {
  hot: Set<string>; // "seg-col-row"
  reps: { seg: number; x: number; y: number }[]; // one representative hot dot per segment
  score: string;
  postings: number;
}

function computeFrame(term: string): Frame {
  const rnd = mulberry(hashStr(term));
  const density = 0.16 + rnd() * 0.14; // rarer/commoner terms differ
  const hot = new Set<string>();
  const reps: { seg: number; x: number; y: number }[] = [];
  for (let seg = 0; seg < SEGMENTS; seg++) {
    let repDone = false;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (rnd() < density) {
          hot.add(`${seg}-${c}-${r}`);
          if (!repDone) {
            reps.push({ seg, x: dotX(seg, c), y: dotY(r) });
            repDone = true;
          }
        }
      }
    }
  }
  const postings = hot.size;
  const score = (3 + postings * 0.11 + (hashStr(term) % 100) / 140).toFixed(2);
  return { hot, reps, score, postings };
}

export default function IndexAnimation() {
  const [query, setQuery] = useState("");
  const [demoIdx, setDemoIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const reduceRef = useRef(false);

  // Decode-in on mount; fall back to instant reveal for reduced motion.
  useEffect(() => {
    reduceRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceRef.current) {
      setReady(true);
      return;
    }
    const t = setTimeout(() => setReady(true), 40);
    return () => clearTimeout(t);
  }, []);

  // Cycle demo terms while the box is empty.
  useEffect(() => {
    if (query.trim()) return;
    const id = setInterval(
      () => setDemoIdx((i) => (i + 1) % DEMO_TERMS.length),
      2600,
    );
    return () => clearInterval(id);
  }, [query]);

  const activeTerm = query.trim() || DEMO_TERMS[demoIdx];
  const frame = useMemo(() => computeFrame(activeTerm), [activeTerm]);

  const dots: React.ReactNode[] = [];
  for (let seg = 0; seg < SEGMENTS; seg++) {
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const key = `${seg}-${c}-${r}`;
        const hot = frame.hot.has(key);
        const delay = reduceRef.current ? 0 : (seg * 4 + c * 6 + r) * 7;
        dots.push(
          <circle
            key={key}
            cx={dotX(seg, c)}
            cy={dotY(r)}
            r={hot ? 3.6 : 3}
            className={`posting${hot ? " hot" : ""}`}
            style={{
              opacity: ready ? undefined : 0,
              transitionDelay: `${delay}ms`,
            }}
          />,
        );
      }
    }
  }

  return (
    <div className="index-anim">
      <div className="index-anim-bar">
        <span>
          inverted index ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· <span className="q">term ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“{activeTerm}ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â</span> ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢{" "}
          {frame.postings} postings
        </span>
        <span className="live">live</span>
      </div>

      <svg
        viewBox="0 0 900 224"
        role="img"
        aria-label={`Index cross-section: query term ${activeTerm} lights ${frame.postings} matching postings across segments, ranked into a result scoring ${frame.score}.`}
      >
        {/* segment files */}
        {Array.from({ length: SEGMENTS }).map((_, seg) => {
          const x = SEG_X0 + seg * (SEG_W + SEG_GAP);
          return (
            <g key={seg}>
              <rect
                x={x}
                y={SEG_Y}
                width={SEG_W}
                height={SEG_H}
                rx={2}
                className="seg-rect"
              />
              <text x={x + SEG_W / 2} y={SEG_Y - 8} textAnchor="middle" className="seg-label">
                seg{seg}
              </text>
            </g>
          );
        })}

        {/* match lines: each segment's representative hot posting ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ result node */}
        {ready &&
          frame.reps.map((rep) => (
            <path
              key={rep.seg}
              className="match-line"
              d={`M ${rep.x} ${rep.y} C ${(rep.x + ANCHOR_X) / 2} ${rep.y}, ${
                (rep.x + ANCHOR_X) / 2
              } ${ANCHOR_Y}, ${ANCHOR_X} ${ANCHOR_Y}`}
            />
          ))}

        {/* postings */}
        {dots}

        {/* ranked result node */}
        <rect
          x={RES_X}
          y={RES_Y}
          width={RES_W}
          height={RES_H}
          rx={2}
          className="result-node"
        />
        <text x={RES_X + 14} y={RES_Y + 21} className="result-label">
          ranked #1
        </text>
        <text x={RES_X + 14} y={RES_Y + 41} className="result-score">
          {frame.score}
        </text>
      </svg>

      <div style={{ padding: "0 16px 16px" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="type a term ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â watch the postings light up"
          aria-label="Demo query term"
          style={{
            width: "100%",
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: 2,
            color: "var(--ink)",
            fontFamily: "var(--mono)",
            fontSize: "0.85rem",
            padding: "10px 12px",
          }}
        />
      </div>
    </div>
  );
}







