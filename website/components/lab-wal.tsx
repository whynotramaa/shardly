"use client";

import { useState } from "react";

/**
 * Kill the process at any point in a single write and see what survives.
 * The six positions are the only distinct states the protocol can be in.
 */

interface Case {
  id: string;
  at: string;
  wal: string;
  seg: string;
  mem: string;
  acked: boolean;
  recovery: string;
  verdict: string;
  correct: boolean;
}

const CASES: Case[] = [
  {
    id: "P0",
    at: "Before anything is written",
    wal: "empty",
    seg: "unchanged",
    mem: "unchanged",
    acked: false,
    recovery:
      "Nothing to replay. The store opens exactly as it closed.",
    verdict: "The write never happened, and nobody was told it had.",
    correct: true,
  },
  {
    id: "P1",
    at: "After the pending record is fsynced",
    wal: "pending @ segment-0000:4096, len 231",
    seg: "unchanged",
    mem: "unchanged",
    acked: false,
    recovery:
      "Pass 2 finds a pending record with no committed twin. verifySegmentRecord() sees the file is shorter than 4096 + 231 and discards it.",
    verdict:
      "The log recorded an intent that was never carried out. Discarding it is the only right answer.",
    correct: true,
  },
  {
    id: "P2",
    at: "Halfway through the segment write",
    wal: "pending @ segment-0000:4096, len 231",
    seg: 'torn: {"id":"b8e2-…","doc":{"tit',
    mem: "unchanged",
    acked: false,
    recovery:
      "The range exists, so the check reads it and calls JSON.parse. The parse throws on the truncated object, and the record is discarded.",
    verdict:
      "This is the case the whole protocol exists for. Without the pending record, nothing would know those bytes were suspect.",
    correct: true,
  },
  {
    id: "P3",
    at: "After the segment fsync, before the commit record",
    wal: "pending @ segment-0000:4096, len 231",
    seg: "complete record, durable",
    mem: "unchanged",
    acked: false,
    recovery:
      "All four checks pass: the file exists, it is long enough, the bytes parse, and the embedded id matches. The record is applied.",
    verdict:
      "Recovered even though the caller never got an acknowledgement. Correct, and more than was promised.",
    correct: true,
  },
  {
    id: "P4",
    at: "After the in-memory map is updated",
    wal: "pending @ segment-0000:4096, len 231",
    seg: "complete record, durable",
    mem: "offsetIndex updated, then lost with the process",
    acked: false,
    recovery:
      "Memory did not survive, so the on-disk state is identical to P3. The same four checks pass and the record is applied.",
    verdict:
      "In-memory state is never part of the durability argument. Only the two fsynced files are.",
    correct: true,
  },
  {
    id: "P5",
    at: "After the committed record is fsynced",
    wal: "pending + committed",
    seg: "complete record, durable",
    mem: "offsetIndex updated",
    acked: true,
    recovery:
      "Pass 1 applies it without inspection. A committed record is proof that the segment fsync already returned.",
    verdict:
      "This is the only case where the caller was told the write succeeded, so this is the only case where losing it would be a bug.",
    correct: true,
  },
];

const STEPS = [
  "wal.logPending() + fsync",
  "writeSync(segment) + fsync",
  "offsetIndex.set(...)",
  "wal.logCommitted() + fsync",
];

export default function LabWal() {
  const [i, setI] = useState(2);
  const c = CASES[i]!;

  return (
    <div className="cut panel" style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "baseline",
          flexWrap: "wrap",
          marginBottom: 22,
        }}
      >
        <p className="label label-ac">Lab 01 / kill the process mid-write</p>
        <p className="label">Click a kill point</p>
      </div>

      {/* timeline */}
      <div className="lab-scroll">
      <svg viewBox="0 0 1080 130" style={{ width: "100%", height: "auto" }}>
        <line x1="30" y1="62" x2="1050" y2="62" className="d-line" />
        {STEPS.map((s, si) => {
          const x = 130 + si * 200;
          return (
            <g key={s}>
              <rect x={x} y="46" width="170" height="32" className="d-box-2" />
              <text x={x + 85} y="66" textAnchor="middle" className="d-t">
                {si + 1}
              </text>
              <text x={x + 85} y="100" textAnchor="middle" className="d-t-s">
                {s.length > 26 ? s.slice(0, 26) : s}
              </text>
            </g>
          );
        })}
        {CASES.map((cs, ci) => {
          const x = 30 + ci * 200;
          const on = ci === i;
          return (
            <g
              key={cs.id}
              onClick={() => setI(ci)}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setI(ci);
              }}
            >
              <rect x={x - 22} y="4" width="44" height="58" fill="transparent" />
              <path
                d={`M${x} 14 V 46`}
                stroke={on ? "var(--accent)" : "var(--hair-solid)"}
                strokeWidth={on ? 1.5 : 1}
                strokeDasharray="2 3"
              />
              <path
                d={`M${x - 6} 8 L${x + 6} 20 M${x + 6} 8 L${x - 6} 20`}
                stroke={on ? "var(--accent)" : "var(--hair-solid)"}
                strokeWidth={on ? 1.8 : 1}
              />
              <text
                x={x}
                y="36"
                textAnchor="middle"
                className="d-t-s"
                style={on ? { fill: "var(--accent)" } : undefined}
              >
                {cs.id}
              </text>
            </g>
          );
        })}
      </svg>
      </div>

      <div className="dl" style={{ marginTop: 20 }}>
        <div className="dl-row">
          <dt>Kill at</dt>
          <dd>{c.at}</dd>
        </div>
        <div className="dl-row">
          <dt>wal.log</dt>
          <dd className="mono" style={{ color: "var(--accent)" }}>
            {c.wal}
          </dd>
        </div>
        <div className="dl-row">
          <dt>segment</dt>
          <dd className="mono">{c.seg}</dd>
        </div>
        <div className="dl-row">
          <dt>memory</dt>
          <dd className="mono">{c.mem}</dd>
        </div>
        <div className="dl-row">
          <dt>Client saw</dt>
          <dd style={{ color: c.acked ? "var(--accent)" : "var(--fg-2)" }}>
            {c.acked
              ? "201 Created. The write is acknowledged."
              : "Nothing. The connection died before any response."}
          </dd>
        </div>
        <div className="dl-row">
          <dt>On restart</dt>
          <dd>{c.recovery}</dd>
        </div>
      </div>

      <div
        className="cut"
        style={{
          marginTop: 20,
          padding: "18px 20px",
          background: "var(--acc-6)",
          borderColor: "var(--acc-30)",
        }}
      >
        <p className="label label-ac" style={{ marginBottom: 8 }}>
          Verdict
        </p>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6 }}>{c.verdict}</p>
      </div>
    </div>
  );
}
