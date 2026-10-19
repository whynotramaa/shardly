"use client";

import { useState, type CSSProperties } from "react";
import { benchmark, type BenchmarkResponse } from "@/lib/api";
import { benchmarkReplay } from "@/lib/benchmark-replay";
import { Icon } from "@/components/ui";

const STAGES: Record<string, string> = { parse: "Parse & analyze", expand: "Expand terms", candidates: "Apply scopes", postings: "Read postings", filter: "Check matches", score: "Rank & select", read: "Prepare evidence" };
const ms = (value: number) => `${value.toFixed(2)} ms`;

export default function BenchmarkView() {
  const [replay, setReplay] = useState(0);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<BenchmarkResponse | null>(null);
  const [history, setHistory] = useState<BenchmarkResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await benchmark(q);
      setRes(result);
      setHistory(previous => [result, ...previous].slice(0, 5));
    } catch (e) { setErr(e instanceof Error ? e.message : "Benchmark failed"); setRes(null); }
    finally { setBusy(false); }
  }

  const race = res ? benchmarkReplay(res) : null;
  const avoided = res && res.naive.scanned > 0 ? (1 - res.indexed.scanned / res.naive.scanned) * 100 : null;
  const delta = res ? res.naive.tookMs - res.indexed.tookMs : 0;
  const stages = res?.details ? Object.entries(res.details.stageMs).filter(([name]) => name !== "total") : [];
  const maxStage = Math.max(...stages.map(([, value]) => value), 0.001);

  return (
    <div className={`search benchmark${!res && !busy && !err ? " is-idle" : ""}`}>
      <section className="search-head">
        <h1 className="search-title">Benchmark your search</h1>
        <form className={`searchbox${busy ? " busy" : ""}`} onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <Icon name="search" size={18} />
          <input type="text" maxLength={2000} value={q} onChange={(e) => setQ(e.target.value)} placeholder="replication shard" aria-label="Benchmark query" spellCheck={false} />
          <button className="button solid search-go" disabled={busy || !q.trim()}>{busy ? "Running…" : "Run"}<Icon name="arrow" size={16} /></button>
          <span className="scanline" aria-hidden />
        </form>
        <p className="hint">One query, two execution paths. See the time, work, and results behind each.</p>
      </section>

      <div className="benchmark-results" aria-busy={busy}>
        <div role="status" className="benchmark-status">{busy ? "Running indexed search, then the full scan…" : res ? `Benchmark complete for ${res.query}.` : ""}</div>
        {err && <p className="alert" role="alert">{err}</p>}
        {res && <>
          <section className="benchmark-timing" aria-labelledby="benchmark-latency-title">
            <h2 id="benchmark-latency-title">Execution time</h2>
            <p className="hint">Two routes through the same documents. Watch where the work goes.</p>
            <dl className="benchmark-timing-values">
              <div className="indexed"><dt><span aria-hidden />Indexed search</dt><dd>{ms(res.indexed.tookMs)}</dd></div>
              <div className="scan"><dt><span aria-hidden />Full scan</dt><dd>{ms(res.naive.tookMs)}</dd></div>
            </dl>
            {race && <figure className="benchmark-replay" aria-label={`Timing illustration: indexed search considers ${res.indexed.scanned} candidates; the full scan reads ${res.naive.scanned} documents.`}>
              <div className="benchmark-replay-lanes" aria-hidden="true" key={`${res.query}:${res.indexed.tookMs}:${res.naive.tookMs}:${replay}`}>
                {(["indexed", "naive"] as const).map(path => <div key={path} className={`benchmark-route ${path}`} style={{ "--replay-duration": `${path === "indexed" ? race.indexedDuration : race.scanDuration}ms` } as CSSProperties}>
                  <div className="benchmark-route-label"><span>{path === "indexed" ? "Take the index" : "Read everything"}</span><strong>{res[path].scanned.toLocaleString()}</strong><small>{path === "indexed" ? "matching candidates" : "documents to scan"}</small></div>
                  <div className="benchmark-document-field" aria-hidden>
                    {race.tileCount ? <>
                      <div className="benchmark-document-tiles">{Array.from({ length: race.tileCount }, (_, i) => <i key={i} />)}</div>
                      <div className="benchmark-document-tiles visited">{Array.from({ length: race.tileCount }, (_, i) => <i key={i} className={path === "naive" || race.selectedTiles.has(i) ? "touched" : ""} />)}</div>
                      <span className="benchmark-route-sweep" />
                    </> : <span className="hint">No documents in this corpus</span>}
                  </div>
                  <div className="benchmark-route-result"><span className="benchmark-route-working">{path === "indexed" ? "Looking up" : "Scanning"}<span aria-hidden>…</span></span><span className="benchmark-route-finished"><Icon name={res[path].hits ? "check" : "info"} size={20} />{res[path].hits ? "Results ready" : "No matches"}</span></div>
                </div>)}
              </div>
              <div className="benchmark-replay-footer"><figcaption>Illustrative replay of this run. The slower path is stretched to 2.4 seconds; tiles summarize document groups. Exact timings are above.</figcaption><button type="button" className="text-button" onClick={() => setReplay(value => value + 1)}><Icon name="refresh" size={14} />Replay</button></div>
            </figure>}
            <p className="benchmark-timing-difference">{delta > 0 ? `The index saved ${ms(delta)}.` : delta < 0 ? `The full scan finished ${ms(-delta)} sooner.` : "Both paths finished in the same time."}<span>{res.speedup.toFixed(2)}× scan / index time</span></p>
            <p className="hint">Results for <strong className="benchmark-query">{res.query}</strong> across {res.naive.scanned.toLocaleString()} documents. {avoided !== null && `${avoided.toFixed(1)}% did not enter indexed scoring.`}</p>
            <span className="benchmark-agreement"><Icon name={res.indexed.hits === 0 && res.naive.hits === 0 ? "info" : res.topHitsMatch ? "check" : "info"} />{res.indexed.hits === 0 && res.naive.hits === 0 ? "No matches in either path" : res.topHitsMatch ? "Same top document" : "Different top documents"}</span>
          </section>

          <div className="benchmark-grid">
            <section className="benchmark-section benchmark-card" aria-labelledby="benchmark-work-title">
              <h2 id="benchmark-work-title">Work performed</h2>

              <table className="benchmark-table">
                <caption>Comparison of the two execution paths</caption>
                <thead><tr><th scope="col">Measure</th><th scope="col">Index</th><th scope="col">Full scan</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Documents considered</th><td>{res.indexed.scanned.toLocaleString()}</td><td>{res.naive.scanned.toLocaleString()}</td></tr>
                  <tr><th scope="row">Results returned</th><td>{res.indexed.hits.toLocaleString()}</td><td>{res.naive.hits.toLocaleString()}</td></tr>
                </tbody>
              </table>
              <p className="hint">The index considers matching candidates. A full scan reads and tokenizes every document. Returned results are capped; they are not the total match count.</p>
            </section>

            <section className="benchmark-section benchmark-card" aria-labelledby="benchmark-stages-title">
              <h2 id="benchmark-stages-title">Inside indexed search</h2>
              {res.details ? <>
                <p className="hint">Where this indexed request spent its time.</p>
                <ol className="benchmark-stages">
                  {stages.map(([name, value]) => <li key={name}><span>{STAGES[name] ?? name}</span><span className="benchmark-stage-track" aria-hidden><span style={{ width: `${Math.max(value / maxStage * 100, 1)}%` }} /></span><span className="mono">{ms(value)}</span></li>)}
                </ol>
                <dl className="benchmark-facts">
                  <div><dt>Posting entries visited</dt><dd>{res.details.postingReads.toLocaleString()}</dd></div>
                  <div><dt>Candidates before filters</dt><dd>{res.details.candidateCount.toLocaleString()}</dd></div>
                  <div><dt>Document reads from storage</dt><dd>{res.details.documentReads.toLocaleString()}</dd></div>
                  <div><dt>Document cache hits</dt><dd>{res.details.cacheHits.toLocaleString()}</dd></div>
                </dl>
              </> : <p className="hint">This API version does not provide stage timings. Update the API to see the execution breakdown.</p>}
              <h3>Analyzed query terms</h3>
              <div className="benchmark-terms">{res.terms.map(term => <code key={term}>{term}</code>)}</div>
              <p className="hint">English analysis lowercases words, removes stopwords, and applies simple stemming.</p>
            </section>
          </div>
        </>}

        {history.length > 1 && <section className="benchmark-section benchmark-card" aria-labelledby="benchmark-history-title">
          <h2 id="benchmark-history-title">Recent runs</h2>
          <p className="hint">Last five runs while this view is open. Individual samples, without averaging.</p>
          <div className="benchmark-table-scroll"><table className="benchmark-table"><caption>Recent benchmark samples, newest first</caption><thead><tr><th scope="col">Query</th><th scope="col">Index</th><th scope="col">Full scan</th><th scope="col">Scan / index</th></tr></thead><tbody>{history.map((sample, i) => <tr key={i}><th scope="row">{sample.query}</th><td>{ms(sample.indexed.tookMs)}</td><td>{ms(sample.naive.tookMs)}</td><td>{sample.speedup.toFixed(2)}×</td></tr>)}</tbody></table></div>
        </section>}

        <section className="benchmark-section benchmark-card benchmark-method" aria-labelledby="benchmark-method-title">
          <h2 id="benchmark-method-title">What this measures</h2>
          <div className="benchmark-method-grid"><p><strong>Indexed search</strong> follows postings to matching documents, ranks with baseline BM25, and prepares result evidence.</p><p><strong>Full scan</strong> reads and tokenizes the whole corpus, then ranks matching documents with BM25.</p></div>
          <p className="hint">Each click runs indexed search first, then the scan. Cache state, disk activity, and query frequency affect timing. This is one local sample, not a throughput or cold-start test. Use plain keywords for comparable query semantics. Top-document agreement does not establish overall ranking quality.</p>
        </section>
      </div>
    </div>
  );
}
