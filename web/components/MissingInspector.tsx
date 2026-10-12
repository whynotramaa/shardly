"use client";

import { useEffect, useRef, useState } from "react";
import { explainMissing, getDocument, listDocuments, search, type DocumentRecord, type MissingExplanation, type SearchOptions } from "@/lib/api";
import { describe } from "@/lib/docmeta";
import { Icon } from "@/components/ui";

export default function MissingInspector({ query, options, target, onClose }: { query: string; options: SearchOptions; target?: string; onClose: () => void }) {
  const generation = useRef(0);
  const [lookup, setLookup] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<DocumentRecord[]>([]);
  const [choice, setChoice] = useState(target ?? "");
  const [chosenTitle, setChosenTitle] = useState("");
  const [result, setResult] = useState<MissingExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!target) return;
    setChoice(target); setResult(null);
    getDocument(target).then((record) => { if (active) setChosenTitle(describe(record.doc).title); }).catch(() => { if (active) setChosenTitle("Document unavailable"); });
    return () => { active = false; };
  }, [target]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const page = lookup.trim() ? await search(lookup.trim(), { mode: "any", limit: 50, offset }) : await listDocuments(offset, 50);
        if (active) {
          setTotal(page.total);
          setItems("hits" in page ? page.hits.map((hit) => ({ id: hit.docId, doc: hit.doc })) : page.items);
        }
      } catch (e) { if (active) { setItems([]); setError(e instanceof Error ? e.message : "Could not find documents."); } }
      finally { if (active) setLoading(false); }
    }, lookup ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [lookup, offset]);
  useEffect(() => { ++generation.current; setResult(null); setBusy(false); return () => { ++generation.current; }; }, [query, options, choice]);
  async function explain() {
    if (!choice.trim()) return;
    setBusy(true); setError(null); setResult(null);
    const request = ++generation.current;
    try { const next = await explainMissing(query, choice.trim(), options); if (request === generation.current) setResult(next); }
    catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : "Could not explain this match."); }
    finally { if (request === generation.current) setBusy(false); }
  }
  return (
    <section className="panel missing" aria-label="Explain a missing match">
      <div className="panel-head">
        <h2>Why is a document missing for “{query}”?</h2>
        <button type="button" className="icon-button ghost" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="field-icon">
        <Icon name="search" size={15} />
        <input aria-label="Find a document" autoFocus value={lookup} onChange={(e) => { setLookup(e.target.value); setOffset(0); }} placeholder="Find the document by title or words" />
      </div>
      <div className="choices" role="radiogroup" aria-label="Document" aria-busy={loading}>
        {items.map((item) => (
          <label key={item.id} className="choice">
            <input type="radio" name="missing-document" checked={choice === item.id} onChange={() => { setChoice(item.id); setChosenTitle(describe(item.doc).title); setResult(null); }} />
            <span>{describe(item.doc).title}<small>{item.id}</small></span>
          </label>
        ))}
        {!loading && !items.length && <p className="hint">No documents found. Try another title or filename.</p>}
      </div>
      {total > 50 && (
        <nav className="pager" aria-label="Document pages">
          <button type="button" className="button ghost small" disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - 50))}><Icon name="back" size={14} />Previous</button>
          <span className="mono">{offset + 1}–{Math.min(offset + 50, total)} of {total}</span>
          <button type="button" className="button ghost small" disabled={loading || offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Next<Icon name="arrow" size={14} /></button>
        </nav>
      )}
      <details className="disclosure">
        <summary><Icon name="chevron" size={14} />Use a document ID</summary>
        <input aria-label="Document ID" className="mono" value={choice} onChange={(e) => { setChoice(e.target.value); setChosenTitle(""); setResult(null); }} />
      </details>
      <div className="panel-foot">
        <span className="hint">{choice ? chosenTitle || choice : "Choose a document"}</span>
        <button type="button" className="button primary small" disabled={busy || !choice.trim()} onClick={() => void explain()}>{busy ? "Explaining…" : "Explain"}</button>
      </div>
      {error && <p role="alert" className="alert">{error}</p>}
      {result && (
        <div className={`verdict ${result.matched ? "ok" : "no"}`} role="status">
          <p><Icon name={result.matched ? "check" : "x"} />{result.matched ? `Matched${result.rank ? ` at rank ${result.rank}` : ""}, ${result.returned ? "on this page" : "outside this page"}.` : "Did not match."}</p>
          <ul>{result.reasons.map((reason, i) => <li key={i}>{reason.detail}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
