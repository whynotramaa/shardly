"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { demoDurability, importDemo, seedDemo, type DemoDurability, type DemoImport, type DemoSeed, type SearchResponse } from "@/lib/api";
import { searchDemo, compareDemo } from "@/lib/demo";
import { describe } from "@/lib/docmeta";
import { Icon } from "@/components/ui";

const STEPS = ["Find a passage", "Compare ranking", "Import a document", "Check durability"];

export default function DemoView() {
  const [seed, setSeed] = useState<DemoSeed | null>(null);
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("checksum mismatch");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [comparison, setComparison] = useState<{ baseline: SearchResponse; tuned: SearchResponse } | null>(null);
  const [imported, setImported] = useState<DemoImport | null>(null);
  const [durability, setDurability] = useState<DemoDurability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  async function run(action: () => Promise<void>) {
    const id = ++request.current; setBusy(true); setError(null);
    try { await action(); }
    catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : "Demo action failed. Try again."); }
    finally { if (id === request.current) setBusy(false); }
  }
  const queryForm = (id: string, label: string, action: () => Promise<void>) => (
    <form className="searchbox compact" onSubmit={(e) => { e.preventDefault(); void run(action); }}>
      <Icon name="search" size={16} />
      <input id={id} aria-label={label} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
      <button className="button primary small" disabled={busy || !query.trim()}>{label}</button>
    </form>
  );
  return (
    <div className="page demo">
      <header className="page-head">
        <h1>Five-minute tour</h1>
        <p>{seed ? `${seed.documents} demo documents loaded. Your own documents are untouched.` : "Load a few demo documents, then try search, ranking, imports, and recovery."}</p>
        <Link className="text-button" href="/app">Exit tour</Link>
      </header>
      {!seed ? (
        <button type="button" className="button primary" disabled={busy} onClick={() => run(async () => { setSeed(await seedDemo()); })}>{busy ? "Loading…" : "Start the tour"}<Icon name="arrow" size={14} /></button>
      ) : (
        <>
          <ol className="stepper" aria-label="Tour steps">
            {STEPS.map((label, index) => (
              <li key={label}>
                <button type="button" aria-current={index === step ? "step" : undefined} className={index < step ? "done" : ""} disabled={busy} onClick={() => { ++request.current; setStep(index); setError(null); }}>
                  <span className="step-dot">{index < step ? <Icon name="check" size={12} /> : index + 1}</span>{label}
                </button>
              </li>
            ))}
          </ol>
          <section className="block" key={step}>
            {step === 0 && <>
              <p className="lead">Every passage keeps its original line and offsets.</p>
              {queryForm("demo-query", "Search", async () => setResult(await searchDemo(query)))}
              {result && <>
                <p className="row-meta mono" role="status">{result.total} matches · {result.tookMs.toFixed(2)} ms</p>
                <ol className="hits">{result.hits.map((hit, i) => (
                  <li className="hit" key={hit.docId} style={{ "--i": i } as React.CSSProperties}>
                    <div className="hit-open"><span className="hit-title">{describe(hit.doc).title}</span><span className="hit-snippet">{hit.snippet?.text}</span></div>
                    {hit.snippet && <p className="row-meta mono">{hit.snippet.field} · {hit.snippet.line ? `line ${hit.snippet.line} · ` : ""}offset {hit.snippet.start}–{hit.snippet.end}</p>}
                  </li>
                ))}</ol>
              </>}
            </>}
            {step === 1 && <>
              <p className="lead">The same query under both ranking profiles. Order can differ by corpus.</p>
              {queryForm("demo-ranking-query", "Compare", async () => setComparison(await compareDemo(query)))}
              {comparison && <div className="compare-cols">{(["baseline", "tuned"] as const).map((profile) => (
                <div key={profile}>
                  <h3>{profile === "baseline" ? "BM25" : "Fields & passages"} <span className="mono">{comparison[profile].tookMs.toFixed(2)} ms</span></h3>
                  <ol>{comparison[profile].hits.map((hit, i) => <li key={hit.docId}><span className="mono rank">{i + 1}</span><span>{describe(hit.doc).title}</span><span className="mono delta">{hit.score.toFixed(3)}</span></li>)}</ol>
                </div>
              ))}</div>}
            </>}
            {step === 2 && <>
              <p className="lead">Import a sample, then import it again. Identity stays stable and duplicates are skipped.</p>
              <button type="button" className="button primary" disabled={busy} onClick={() => run(async () => setImported(await importDemo()))}>{busy ? "Importing…" : imported ? "Import again" : "Import sample"}</button>
              {imported && <p role="status" className="verdict ok"><Icon name="check" />{imported.added} added, {imported.updated} updated, {imported.duplicates} duplicates. {imported.documents} demo documents.</p>}
            </>}
            {step === 3 && <>
              <p className="lead">Replay the demo records through an isolated recovery check.</p>
              <button type="button" className="button primary" disabled={busy} onClick={() => run(async () => setDurability(await demoDurability()))}>{busy ? "Checking…" : "Check durability"}</button>
              {durability && (
                <div role={durability.verified ? "status" : "alert"} className={`verdict ${durability.verified ? "ok" : "no"}`}>
                  <p><Icon name={durability.verified ? "check" : "x"} />{durability.verified ? "Verified." : "Verification failed."} {durability.before} records before, {durability.after} after.</p>
                  {durability.detail && <p>{durability.detail}</p>}
                </div>
              )}
            </>}
          </section>
          <div className="actions demo-foot">
            <span className="hint">Step {step + 1} of {STEPS.length}</span>
            {step < STEPS.length - 1 && <button type="button" className="button ghost small" disabled={busy} onClick={() => { setStep(step + 1); setError(null); }}>Next<Icon name="arrow" size={14} /></button>}
          </div>
        </>
      )}
      {error && <p role="alert" className="alert">{error}</p>}
    </div>
  );
}
