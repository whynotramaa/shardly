"use client";

import { useEffect, useRef, useState } from "react";

function Arrow() {
  return (
    <div className="sp-link">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
        <path d="M3 12h16M14 7l5 5-5 5" />
        <circle className="sp-flow" cx="4" cy="12" r="2.4" stroke="none" />
      </svg>
    </div>
  );
}

const POSTINGS = [
  true, false, true, false, false, true,
  false, true, false, true, false, false,
  true, false, false, true, true, false,
];

export default function SignalPath() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`signal${inView ? " in" : ""}`} ref={ref}>
      <div className="signal-track">
        {/* 01 — raw */}
        <div className="sp-stage">
          <div className="sp-head">
            <span className="sp-num">01</span>
            <span className="sp-label">Raw</span>
          </div>
          <div className="sp-sub">a document arrives</div>
          <div className="sp-body">
            <span className="sp-line w1" />
            <span className="sp-line w3" />
            <span className="sp-line w2" />
            <span className="sp-line w4" />
          </div>
        </div>

        <Arrow />

        {/* 02 — tokens */}
        <div className="sp-stage">
          <div className="sp-head">
            <span className="sp-num">02</span>
            <span className="sp-label">Tokens</span>
          </div>
          <div className="sp-sub">lowercased · stemmed</div>
          <div className="sp-body">
            <div className="sp-chips">
              {["storage", "index", "crash", "recoveri", "segment"].map((t) => (
                <span key={t} className="sp-chip">{t}</span>
              ))}
            </div>
          </div>
        </div>

        <Arrow />

        {/* 03 — postings */}
        <div className="sp-stage">
          <div className="sp-head">
            <span className="sp-num">03</span>
            <span className="sp-label">Postings</span>
          </div>
          <div className="sp-sub">term → documents</div>
          <div className="sp-body">
            <div className="sp-postings">
              {POSTINGS.map((on, i) => (
                <span key={i} className={`sp-dot${on ? " on" : ""}`} />
              ))}
            </div>
          </div>
        </div>

        <Arrow />

        {/* 04 — ranked */}
        <div className="sp-stage">
          <div className="sp-head">
            <span className="sp-num">04</span>
            <span className="sp-label">Ranked</span>
          </div>
          <div className="sp-sub">BM25 top-N</div>
          <div className="sp-body">
            {[
              ["recovery.md", "8.42"],
              ["wal.ts", "6.10"],
              ["segment.ts", "5.87"],
            ].map(([name, score]) => (
              <div key={name} className="sp-rank">
                <b>{name}</b>
                <span className="s">{score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
