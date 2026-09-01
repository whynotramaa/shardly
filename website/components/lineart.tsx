/* Abstract technical constructions. Decoration, but drawn like instrumentation. */

export function ArcStack({ n = 9 }: { n?: number }) {
  return (
    <svg viewBox="0 0 300 300" aria-hidden style={{ width: "100%" }}>
      {Array.from({ length: n }, (_, i) => {
        const r = 20 + i * 15;
        return (
          <circle
            key={i}
            cx="150"
            cy="300"
            r={r}
            fill="none"
            stroke={i === n - 3 ? "var(--accent)" : "var(--hair-solid)"}
            strokeWidth={i === n - 3 ? 1.4 : 1}
          />
        );
      })}
      <line x1="0" y1="300" x2="300" y2="300" className="d-line" />
      <line x1="150" y1="150" x2="150" y2="300" className="d-dash" />
      <text x="156" y="164" className="d-t-s">AVGDL</text>
    </svg>
  );
}

export function CircleField() {
  return (
    <svg viewBox="0 0 420 200" aria-hidden style={{ width: "100%" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={i}
          cx={70 + i * 70}
          cy="100"
          r="66"
          fill="none"
          stroke={i === 2 ? "var(--accent)" : "var(--hair-solid)"}
          strokeWidth={i === 2 ? 1.3 : 1}
        />
      ))}
      <line x1="0" y1="100" x2="420" y2="100" className="d-dash" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={70 + i * 70} y1="94" x2={70 + i * 70} y2="106" className="d-line" />
        </g>
      ))}
    </svg>
  );
}

export function Triangulation() {
  const pts = [
    [20, 180], [110, 30], [200, 165], [290, 45], [380, 175], [150, 190], [250, 20],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 2], [1, 6], [6, 3], [2, 5], [4, 2],
    [1, 5], [6, 2],
  ];
  return (
    <svg viewBox="0 0 400 200" aria-hidden style={{ width: "100%" }}>
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={pts[a!]![0]}
          y1={pts[a!]![1]}
          x2={pts[b!]![0]}
          y2={pts[b!]![1]}
          stroke={i === 4 || i === 9 ? "var(--accent)" : "var(--hair-solid)"}
          strokeWidth="1"
        />
      ))}
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="2.5" fill={i === 2 ? "var(--accent)" : "var(--fg-3)"} />
          <text x={x! + 7} y={y! + 3} className="d-t-s">
            D{i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function Target({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
      <circle cx="60" cy="60" r="55" className="d-line" fill="none" />
      <circle cx="60" cy="60" r="36" className="d-line" fill="none" />
      <circle cx="60" cy="60" r="17" className="d-ac" fill="none" />
      <line x1="0" y1="60" x2="120" y2="60" className="d-dash" />
      <line x1="60" y1="0" x2="60" y2="120" className="d-dash" />
      <circle cx="60" cy="60" r="3" fill="var(--accent)" />
    </svg>
  );
}

/** A dotted measurement scale, used as a section spacer. */
export function Scale({ label }: { label?: string }) {
  return (
    <svg viewBox="0 0 1180 30" aria-hidden style={{ width: "100%" }}>
      <line x1="0" y1="20" x2="1180" y2="20" className="d-line" />
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1={i * 20}
          y1="20"
          x2={i * 20}
          y2={i % 5 === 0 ? 8 : 14}
          stroke={i % 10 === 0 ? "var(--accent)" : "var(--hair-solid)"}
        />
      ))}
      {label ? (
        <text x="1180" y="6" textAnchor="end" className="d-t-s">
          {label}
        </text>
      ) : null}
    </svg>
  );
}
