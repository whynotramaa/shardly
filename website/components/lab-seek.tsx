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

      <dl className="seek-address">
        <div><dt>Segment</dt><dd>{d.seg}</dd></div>
        <div><dt>Byte offset</dt><dd>{d.off}</dd></div>
        <div><dt>Record length</dt><dd>{d.len} bytes</dd></div>
      </dl>
      <p className="diagram-pan-hint">Scroll horizontally to inspect every byte range.</p>
      <div className="lab-scroll seek-drawing" role="region" aria-label="Illustrative segment byte ranges" tabIndex={0}>
        <svg viewBox="0 0 640 110" role="img" aria-label={`Selected record begins at byte ${d.off} and occupies ${d.len} bytes`}>
          <text x="0" y="17">Segment byte ranges</text>
          <rect x="0" y="30" width="640" height="32" className="d-box-2" />
          {DOCS.map((doc, i) => <rect key={doc.id} x={(doc.off / TOTAL) * 638 + 1} y="31" width={(doc.len / TOTAL) * 638} height="30" fill={i === sel ? "var(--accent)" : doc.deleted ? "url(#hatch)" : "var(--wash-9)"} stroke={i === sel ? "var(--accent)" : "var(--hair-solid)"} />)}
          <line x1={(d.off / TOTAL) * 638 + 1} y1="25" x2={(d.off / TOTAL) * 638 + 1} y2="77" className="d-ac" />
          <text x={(d.off / TOTAL) * 638 + 8} y="99">byte {d.off}</text>
        </svg>
      </div>
      <p className="seek-code"><code>{d.deleted ? "Deletion marker prevents this read." : `fs.readSync(fd, buffer, 0, ${d.len}, ${d.off})`}</code></p>

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
        The offset map finds the record without scanning neighbouring records.
        Reading and checking the bytes still takes work proportional to the record size.
      </p>
    </div>
  );
}
