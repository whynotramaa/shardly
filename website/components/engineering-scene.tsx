"use client";

import { useEffect, useRef, useState } from "react";

const stories = {
  write: {
    title: "A write reaches durable storage",
    steps: ["Sync the pending log", "Sync the document bytes", "Sync the commit record", "Publish and acknowledge"],
    descriptions: ["The write-ahead log records the intended write before the document changes.", "The segment receives the record. Its bytes are synchronized before the commit record.", "A durable commit record identifies a completed write during recovery.", "The engine publishes the new offset, updates search state, and returns success."],
  },
  index: {
    title: "A document becomes searchable",
    steps: ["Read the original field", "Analyze its words", "Store the postings", "Score matching candidates"],
    descriptions: ["Keep the original field for display and evidence. Analysis creates a separate representation.", "For English, normalize text and apply stopwords, simple stemming, and identifier splitting.", "Each term points to documents and positions. The original text is not replaced.", "A query visits matching postings, scores candidates, and keeps the best results."],
  },
  evidence: {
    title: "Evidence stays attached to a revision",
    steps: ["Find a passage", "Return its reference", "Verify before fetching", "Reject an old reference"],
    descriptions: ["The illustrative source field contains the exact span WAL at UTF-16 offsets 4 through 7.", "The reference binds document identity, revision, field, and span together.", "Fetch checks the current revision and access scope before returning the original field text.", "After the document changes, the old reference returns stale_reference. Search again for current evidence."],
  },
  hybrid: {
    title: "Optional models add another retrieval route",
    steps: ["Search both routes", "Collect bounded candidates", "Fuse and optionally rerank", "Check current sources"],
    descriptions: ["The lexical index matches terms. A configured embedding model supports a separate dense route.", "Each route contributes a bounded candidate list. The dense reference path uses exact cosine similarity.", "Reciprocal rank fusion is the default. A configured reranker can reorder the combined candidates.", "Deleted or changed parent revisions are excluded. Results still need current evidence and access checks."],
  },
} as const;

// Each path follows the record, term, or reference being explained by that step.
const transfers = {
  write: ["M111 42V72", "M177 170H235", "M367 170H425", "M557 170H615"],
  index: ["M56 120H222", "M248 152H284", "M484 152H520", "M650 272V305H503"],
  evidence: ["M96 124H123", "M130 146V219", "M330 255H363V207H394", "M580 235V251"],
  hybrid: ["M103 169H142V84H177", "M330 84H365", "M462 84H524V169H579", "M670 225V286H492"],
} as const;

export default function EngineeringScene({ kind }: { kind: keyof typeof stories }) {
  const story = stories[kind];
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(media.matches); if (media.matches) setPlaying(false); };
    update(); media.addEventListener("change", update);
    const onVisibility = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", onVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); media.removeEventListener("change", update); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  useEffect(() => {
    if (!playing || !visible || reduced) return;
    const timer = setTimeout(() => {
      if (step === story.steps.length - 1) setPlaying(false);
      else setStep(step + 1);
    }, 1900);
    return () => clearTimeout(timer);
  }, [playing, visible, reduced, step, story.steps.length]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !visible) return;
    const centers = { write: [111, 301, 491, 681], index: [139, 384, 650, 400], evidence: [249, 185, 579, 579], hybrid: [200, 405, 670, 475] };
    const width = el.querySelector("svg")!.getBoundingClientRect().width;
    el.scrollTo({ left: centers[kind][step] / 800 * width - el.clientWidth / 2, behavior: reduced ? "instant" : "smooth" });
  }, [kind, step, visible, reduced]);
  const phase = (n: number) => `scene-phase ${step === n ? "is-active" : ""} ${step > n ? "is-done" : ""}`;
  return <div className="engineering-scene" ref={root} data-playing={playing && visible && !reduced} data-kind={kind}>
    <div className="scene-top"><span>{story.title}</span><button type="button" onClick={() => { if (playing) setPlaying(false); else { setStep(0); setPlaying(!reduced); } }} disabled={reduced}>{playing ? "Pause sequence" : "Play sequence"}</button></div>
    <p className="diagram-pan-hint">Swipe the drawing to inspect it. Selecting a step brings it into view.</p>
    <div className="scene-canvas" ref={canvas} tabIndex={0} role="region" aria-label={`${story.title} drawing`}>
    <svg viewBox="0 0 800 340" role="img" aria-label={story.title}>
      {kind === "write" && <>
        <path d="M110 170H695" className="scene-track" />
        {[0,1,2,3].map((n) => <g key={n} className={phase(n)} transform={`translate(${45 + n*190} 72)`}>
          <path d="M0 22L22 0H132V165H0Z" className="scene-plate" />
          <path d="M0 22H22V0M20 53H112M20 65H90M20 77H103" className="scene-detail" />
          <rect x="20" y="104" width="92" height="35" rx="2" className="scene-fill" />
          <text x="66" y="126" textAnchor="middle">{["pending", "record", "commit", "visible"][n]}</text>
          <text x="66" y="198" textAnchor="middle" className="scene-label">{["write-ahead log", "segment file", "write-ahead log", "offset + response"][n]}</text>
          <circle cx="66" cy="-22" r="5" className="scene-dot" />
        </g>)}
        <text x="400" y="322" textAnchor="middle" className="scene-note">Acknowledgement follows the durable commit.</text>
      </>}
      {kind === "index" && <>
        <g className={phase(0)}><path d="M36 42H242V263H36Z" className="scene-plate"/><text x="56" y="74">document A</text><path d="M56 88H222" className="scene-detail"/><text x="56" y="120">The storage layer</text><text x="56" y="146">stores records.</text><path d="M56 179H210M56 193H186M56 207H216" className="scene-detail"/><text x="56" y="241" className="scene-label">original field retained</text></g>
        <path d="M248 152H284M484 152H520" className="scene-track" markerEnd="url(#ah)"/>
        <g className={phase(1)}>{["storage", "layer", "stor", "record"].map((word, n) => <g key={word} transform={`translate(294 ${48+n*53})`}><rect width="180" height="39" className="scene-plate"/><text x="18" y="25">{word}</text><text x="158" y="25" className="scene-label">{n}</text></g>)}</g>
        <g className={phase(2)}><rect x="536" y="42" width="228" height="220" className="scene-plate"/><text x="555" y="74">postings in memory</text>{["storage → A", "layer   → A", "stor    → A", "record  → A"].map((line, n) => <text key={line} x="555" y={112+n*34}>{line}</text>)}</g>
        <g className={phase(3)}><path d="M139 272V305H650V272" className="scene-track"/><rect x="297" y="285" width="206" height="39" className="scene-plate"/><text x="400" y="310" textAnchor="middle">query → ranked hits</text></g>
      </>}
      {kind === "evidence" && <>
        <g className={phase(0)}><path d="M40 48H458V146H40Z" className="scene-plate"/><text x="60" y="77" className="scene-label">document A · revision A · body</text><rect x="95" y="89" width="29" height="29" className="scene-fill" data-evidence-highlight="true"/><text x="60" y="110" xmlSpace="preserve"><tspan textLength="36" lengthAdjust="spacingAndGlyphs">The </tspan><tspan x="96" data-evidence-span="true" textLength="27" lengthAdjust="spacingAndGlyphs">WAL</tspan><tspan x="123"> records each write.</tspan></text><path d="M96 121V132H123V121" className="scene-detail"/><text x="309" y="132" className="scene-label">span [4, 7)</text></g>
        <g className={phase(1)}><path d="M130 146V219" className="scene-track" markerEnd="url(#ah)"/><rect x="40" y="219" width="290" height="73" className="scene-plate"/><text x="59" y="247">document + revision + field</text><text x="59" y="273">start 4 · end 7</text></g>
        <g className={phase(2)}><rect x="394" y="179" width="371" height="56" className="scene-plate"/><text x="413" y="213">same revision → return WAL</text><path d="M330 255H363V207H394M458 98H620V179" className="scene-track"/></g>
        <g className={phase(3)}><rect x="394" y="251" width="371" height="56" className="scene-plate"/><path d="M580 236V250" className="scene-track"/><text x="413" y="285">new revision → stale_reference</text></g>
      </>}
      {kind === "hybrid" && <>
        <path d="M72 169H142V84H338M142 169V253H338M462 84H524V169H576M462 253H524" className="scene-track" markerEnd="url(#ah)"/>
        <g className={phase(0)}><circle cx="72" cy="169" r="30" className="scene-plate"/><text x="72" y="175" textAnchor="middle">query</text><rect x="177" y="54" width="153" height="60" className="scene-plate"/><text x="253" y="80" textAnchor="middle">lexical index</text><text x="253" y="101" textAnchor="middle" className="scene-label">term matching</text><rect x="177" y="223" width="153" height="60" className="scene-plate"/><text x="253" y="249" textAnchor="middle">embedding model</text><text x="253" y="270" textAnchor="middle" className="scene-label">optional endpoint</text></g>
        <g className={phase(1)}>{[60,229].map((y) => <g key={y}>{[0,1,2].map(n=><rect key={n} x={365+n*8} y={y+n*8} width="70" height="35" className="scene-plate"/>)}</g>)}</g>
        <g className={phase(2)}><path d="M579 114H761V224H579Z" className="scene-plate"/><text x="670" y="147" textAnchor="middle">rank fusion</text><path d="M599 161H741" className="scene-detail"/><text x="670" y="190" textAnchor="middle">optional reranker</text></g>
        <g className={phase(3)}><path d="M670 225V286H492" className="scene-track" markerEnd="url(#ah)"/><text x="478" y="291" textAnchor="end">current, scoped evidence</text></g>
        <text x="400" y="31" textAnchor="middle" className="scene-note">Two retrieval routes. One current document revision.</text>
      </>}
      {playing && visible && !reduced && <g key={`${kind}-${step}`} aria-hidden="true">
        <path d={transfers[kind][step]} pathLength="1" className="scene-transfer" />
        <circle r="3" className="scene-packet"><animateMotion dur="1.3s" path={transfers[kind][step]} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1" /></circle>
      </g>}
    </svg>
    </div>
    <div className="scene-steps" aria-label={`${story.title} steps`}>{story.steps.map((label, n) => <button type="button" key={label} aria-pressed={step===n} onClick={() => {setPlaying(false);setStep(n);}}><span>{n+1}</span>{label}</button>)}</div>
    <p className="scene-description" aria-live="polite">{story.descriptions[step]}</p>
    <p className="scene-timing">{reduced ? "Reduced motion is enabled. Select a step to explore." : "Illustrative sequence, slowed for reading. Playback stops after one pass."}</p>
  </div>;
}
