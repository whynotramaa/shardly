"use client";

import { useState } from "react";

/** Resolve a document id to a byte range and watch the seek land. */

const DOCS = [
  { id: "a1f3…c07", seg: "segment-0000", off: 0, len: 184, title: "Raft consensus", deleted: false },
  { id: "b8e2…9d1", seg: "segment-0000", off: 185, len: 231, title: "Write-ahead logging", deleted: false },
  { id: "c4a9…22f", seg: "segment-0000", off: 417, len: 196, title: "LSM trees", deleted: true },
  { id: "d0b7…8ae", seg: "segment-0000", off: 614, len: 308, title: "Inverted indexes", deleted: false },
  { id: "e5c1…41b", seg: "segment-0000", off: 923, len: 172, title: "BM25 ranking", deleted: false },
];

const TOTAL = 1095;

export default function LabSeek() {
  const [sel, setSel] = useState(1);
  const d = DOCS[sel]!;

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
        <p className="label label-ac">Lab 02 / resolve an id to bytes</p>
        <p className="label">Pick a document</p>
      </div>

      <div className="btn-row" style={{ marginBottom: 22 }}>
        {DOCS.map((doc, i) => (
          <button
            key={doc.id}
            className="btn"
            data-on={i === sel ? "1" : "0"}
            onClick={() => setSel(i)}
          >
            {doc.id}
          </button>
        ))}
      </div>

      <div className="lab-scroll">
      <svg viewBox="0 0 1080 190" style={{ width: "100%", height: "auto" }}>
        <text x="0" y="12" className="d-t-s">STEP 1 · OFFSET INDEX LOOKUP · O(1) HASH MAP</text>
        <rect x="0" y="24" width="1080" height="34" className="d-box-2" />
        <text x="14" y="46" className="d-t" style={{ fill: "var(--accent)" }}>
          offsetIndex.get(&quot;{d.id}&quot;) → {"{"} segment: &quot;{d.seg}&quot;, byteOffset: {d.off}, length: {d.len}, deleted: {String(d.deleted)} {"}"}
        </text>

        <text x="0" y="88" className="d-t-s">STEP 2 · SEEK INTO THE SEGMENT FILE</text>
        <rect x="0" y="100" width="1080" height="30" className="d-box-2" />
        {DOCS.map((doc, i) => {
          const x = (doc.off / TOTAL) * 1078 + 1;
          const w = (doc.len / TOTAL) * 1078;
          const active = i === sel;
          return (
            <rect
              key={doc.id}
              x={x}
              y={101}
              width={w}
              height={28}
              fill={active ? "var(--accent)" : doc.deleted ? "url(#hatch)" : "var(--wash-9)"}
              stroke={active ? "var(--accent)" : "var(--hair-solid)"}
            />
          );
        })}
        <line
          x1={(d.off / TOTAL) * 1078 + 1}
          y1="94"
          x2={(d.off / TOTAL) * 1078 + 1}
          y2="146"
          className="d-ac"
          strokeDasharray="2 3"
        />
        <text x={(d.off / TOTAL) * 1078 + 8} y="160" className="d-t-ac">
          byte {d.off}
        </text>

        <text x="0" y="186" className="d-t">
          fs.readSync(fd, buf, 0, {d.len}, {d.off})
          {d.deleted ? "   never reached, the tombstone short-circuits the read" : ""}
        </text>
      </svg>
      </div>

      <div
        className="cut"
        style={{
          marginTop: 18,
          padding: "16px 18px",
          background: d.deleted ? "var(--acc-6)" : "var(--wash-3)",
          borderColor: d.deleted ? "var(--acc-30)" : undefined,
        }}
      >
        <p className="label" style={{ marginBottom: 8 }}>
          {d.deleted ? "Tombstoned" : "Returned"}
        </p>
        <p className="mono" style={{ margin: 0, color: d.deleted ? "var(--accent)" : "var(--fg)" }}>
          {d.deleted
            ? "read() returns null. The bytes are still on disk, hidden by the map, until compaction runs."
            : `{ "title": "${d.title}", … }`}
        </p>
      </div>

      <p className="label" style={{ marginTop: 18 }}>
        Not one neighbouring record was opened, parsed, or even touched. The cost
        is identical whether the file holds five records or five million.
      </p>
    </div>
  );
}
