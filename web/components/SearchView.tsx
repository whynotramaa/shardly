"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import MissingInspector from "@/components/MissingInspector";
import { Icon, Segmented, Switch, Toast } from "@/components/ui";
import {
  compareSearch,
  getDocument,
  search,
  suggest,
  type SearchGroup,
  type SearchHit,
  type SearchOptions,
  type SearchResponse,
  type SearchSnippet,
} from "@/lib/api";
import { describe, snippet } from "@/lib/docmeta";
import {
  loadCollections,
  loadRecentSearches,
  recentSearches,
  loadSavedSearches,
  saveWorkspace,
  readSearchOptions,
  searchParams,
  validSynonyms,
  passageMarks,
  distinctPassages,
  originalFieldText,
  documentMatchHref,
  visibleGroups,
  type Collection,
  type SavedSearch,
} from "@/lib/workspace";

const initialOptions: SearchOptions = {
  mode: "all",
  groupBy: "none",
  prefix: false,
  typos: false,
  profile: "tuned",
  inspect: false,
  limit: 10,
  offset: 0,
};

const FACETS = { source: "Source", repo: "Repository", type: "Type", language: "Language" } as const;

export default function SearchView({ documents, sourcesHref }: { documents?: number | null; sourcesHref: string }) {
  const [q, setQ] = useState("");
  const [exact, setExact] = useState(false);
  const [options, setOptions] = useState<SearchOptions>(initialOptions);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<SearchHit | null>(null);
  const [fullDoc, setFullDoc] = useState<Record<string, unknown> | null>(null);
  const [recent, setRecent] = useState<SavedSearch[]>([]);
  const recentRef = useRef<SavedSearch[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [compare, setCompare] = useState<{ baseline: SearchResponse; tuned: SearchResponse } | null>(null);
  const [notice, setNoticeText] = useState<{ text: string; n: number } | null>(null);
  const setNotice = (text: string) => setNoticeText((c) => ({ text, n: (c?.n ?? 0) + 1 }));
  const generation = useRef(0);
  const suggestionGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const compareGeneration = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [synonymDraft, setSynonymDraft] = useState("{}");
  const [synonymError, setSynonymError] = useState<string | null>(null);
  const [collectionTarget, setCollectionTarget] = useState<string | null>(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingTarget, setMissingTarget] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [appliedOptions, setAppliedOptions] = useState<SearchOptions>(initialOptions);

  useEffect(() => {
    setSaved(loadSavedSearches());
    recentRef.current = loadRecentSearches(); setRecent(recentRef.current);
    setCollections(loadCollections());
    const apply = () => {
      ++compareGeneration.current;
      setCompare(null);
      setErr(null);
      hideSuggestions();
      closePreview();
      try {
        const params = new URLSearchParams(window.location.search);
        const nextQ = params.get("q") ?? "";
        if (params.get("explain")) { setMissingTarget(params.get("explain")!); setMissingOpen(true); }
        const nextExact = params.get("exact") === "true";
        const nextOptions = { ...initialOptions, ...readSearchOptions(params) };
        setQ(nextQ);
        setExact(nextExact);
        setOptions(nextOptions);
        setSynonymDraft(JSON.stringify(nextOptions.synonyms ?? {}, null, 2));
        if (nextQ.trim()) void run(nextQ, nextOptions, nextExact, false);
        else { ++generation.current; setRes(null); setBusy(false); }
      } catch (error) {
        ++generation.current;
        setBusy(false);
        setRes(null);
        setErr(error instanceof Error ? error.message : "Invalid search URL");
      }
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => {
      window.removeEventListener("popstate", apply);
      ++generation.current;
      ++suggestionGeneration.current;
      ++previewGeneration.current;
      ++compareGeneration.current;
    };
  }, []);

  useEffect(() => {
    const request = ++suggestionGeneration.current;
    setSuggestions([]);
    setSuggestionIndex(-1);
    if (q.trim().length < 2) return;
    const timer = window.setTimeout(async () => {
      try {
        const items = await suggest(q.trim());
        if (request === suggestionGeneration.current && document.activeElement === inputRef.current) setSuggestions(items);
      } catch {
        if (request === suggestionGeneration.current) setSuggestions([]);
      }
    }, 180);
    return () => { window.clearTimeout(timer); ++suggestionGeneration.current; };
  }, [q]);

  const hits = res?.hits ?? [];
  const grouped = !!appliedOptions.groupBy && appliedOptions.groupBy !== "none";
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.matches("input, textarea, select, button, [contenteditable=true]")) return;
      if (e.key === "/") { e.preventDefault(); inputRef.current?.focus(); return; }
      if (e.key === "Escape") { setCollectionTarget(null); closePreview(); return; }
      if (grouped) return;
      if (e.key === "j") { e.preventDefault(); setSelected((n) => Math.min(n + 1, Math.max(0, hits.length - 1))); }
      else if (e.key === "k") { e.preventDefault(); setSelected((n) => Math.max(n - 1, 0)); }
      else if (e.key === "Enter" && hits[selected]) openPreview(hits[selected]!);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hits, selected, grouped]);

  function closePreview() {
    ++previewGeneration.current;
    setPreview(null);
    setFullDoc(null);
    setPreviewError(null);
  }
  function hideSuggestions() {
    ++suggestionGeneration.current;
    setSuggestions([]);
    setSuggestionIndex(-1);
  }
  async function run(nextQ = q, nextOptions = options, nextExact = exact, push = true) {
    ++compareGeneration.current;
    if (!nextQ.trim()) return;
    const actualQuery = nextExact && (!nextOptions.match || nextOptions.match === "text") ? `"${nextQ.replaceAll('"', "")}"` : nextQ;
    const runId = ++generation.current;
    setBusy(true);
    setErr(null);
    setCompare(null);
    setRes(null);
    setSelected(0);
    hideSuggestions();
    closePreview();
    const url = `${window.location.pathname}?${searchParams(nextQ, nextOptions, nextExact)}`;
    if (push && url !== `${window.location.pathname}${window.location.search}`) window.history.pushState({}, "", url);
    else window.history.replaceState({}, "", url);
    try {
      const result = await search(actualQuery, nextOptions);
      if (runId === generation.current) {
        setRes(result);
        setAppliedOptions(nextOptions);
        const nextRecent = recentSearches({ id: crypto.randomUUID(), name: nextQ.trim(), query: nextQ, options: { ...nextOptions, offset: 0 }, exact: nextExact }, recentRef.current);
        const historyError = saveWorkspace("shardly-recent-searches", nextRecent);
        if (historyError) setErr(historyError);
        else { recentRef.current = nextRecent; setRecent(nextRecent); }
      }
    } catch (error) {
      if (runId === generation.current) {
        setErr(error instanceof Error ? error.message : "Search failed");
        setRes(null);
      }
    } finally {
      if (runId === generation.current) setBusy(false);
    }
  }
  function change(key: keyof SearchOptions, value: unknown) {
    const next = { ...options, [key]: value, offset: key === "offset" ? (value as number) : 0 };
    setOptions(next);
    void run(q, next);
  }
  function restore(item: SavedSearch) {
    const next = { ...initialOptions, ...(item.options as SearchOptions) };
    setQ(item.query);
    setExact(Boolean(item.exact));
    setOptions(next);
    setSynonymDraft(JSON.stringify(next.synonyms ?? {}, null, 2));
    void run(item.query, next, Boolean(item.exact));
  }
  function saveSearch() {
    if (!q.trim()) return;
    const name = nameDraft.trim();
    if (!name || name.length > 256) { setNameError("Enter a name of 1–256 characters."); return; }
    const next = [...saved, { id: crypto.randomUUID(), name, query: q, options: { ...options }, exact }];
    const error = saveWorkspace("shardly-saved-searches", next);
    if (error) { setNameError(error); return; }
    setSaved(next); setSaving(false); setNotice("Search saved");
  }
  function deleteSaved(id: string) {
    const next = saved.filter((item) => item.id !== id);
    const error = saveWorkspace("shardly-saved-searches", next);
    if (error) setErr(error); else setSaved(next);
  }
  function storeCollections(next: Collection[]) {
    const error = saveWorkspace("shardly-collections", next);
    if (error) { setErr(error); return false; }
    setCollections(next);
    return true;
  }
  const scope = options.docIds ? collections.find((c) => c.docIds.length === options.docIds!.length && c.docIds.every((id) => options.docIds!.includes(id))) : undefined;
  function addToCollection(collectionId: string) {
    if (!collectionTarget) return;
    const next = collections.map((c) => c.id === collectionId && !c.docIds.includes(collectionTarget) ? { ...c, docIds: [...c.docIds, collectionTarget] } : c);
    if (!storeCollections(next)) return;
    const name = next.find((c) => c.id === collectionId)?.name;
    setCollectionTarget(null);
    setNotice(`Added to ${name}`);
    if (scope?.id === collectionId) change("docIds", next.find((c) => c.id === collectionId)!.docIds);
  }
  function createCollection() {
    const name = nameDraft.trim();
    if (!name || name.length > 256) { setNameError("Enter a name of 1–256 characters."); return; }
    if (!storeCollections([...collections, { id: crypto.randomUUID(), name, docIds: collectionTarget ? [collectionTarget] : [] }])) return;
    setCollectionTarget(null);
    setNotice(`Added to ${name}`);
  }
  async function openPreview(hit: SearchHit) {
    const request = ++previewGeneration.current;
    setSelected(Math.max(0, hits.indexOf(hit)));
    setPreview(hit);
    setFullDoc(null);
    setPreviewError(null);
    try {
      const record = await getDocument(hit.docId);
      if (request === previewGeneration.current) setFullDoc(record.doc);
    } catch (error) {
      if (request === previewGeneration.current) setPreviewError(error instanceof Error ? error.message : "Could not load document. Try opening it again.");
    }
  }
  function selectSuggestion(value: string) {
    const next = { ...options, offset: 0 };
    setQ(value);
    setOptions(next);
    void run(value, next);
    inputRef.current?.focus();
  }
  async function runCompare() {
    if (!res) return;
    const request = ++compareGeneration.current;
    setErr(null);
    try {
      const result = await compareSearch(res.query, { ...appliedOptions, inspect: false });
      if (request === compareGeneration.current) setCompare(result);
    } catch (error) {
      if (request === compareGeneration.current) setErr(error instanceof Error ? error.message : "Comparison failed");
    }
  }
  function applySynonyms() {
    try {
      const value: unknown = JSON.parse(synonymDraft);
      if (!validSynonyms(value)) throw new Error("Use an object with at most 32 terms, each mapped to up to 8 strings of 80 characters or fewer.");
      setSynonymError(null);
      change("synonyms", value);
    } catch (error) {
      setSynonymError(error instanceof Error ? error.message : "Invalid synonym JSON");
    }
  }
  function closeMenu(id: string) { document.getElementById(id)?.hidePopover(); }

  const tuned = [exact, options.mode === "any", options.prefix, options.typos, !!options.synonyms, options.inspect, options.match && options.match !== "text", options.profile === "baseline", grouped].filter(Boolean).length;
  const idle = !res && !busy && !err;
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;

  return (
    <div className={`search${idle ? " is-idle" : ""}`}>
      <section className="search-head">
        {idle && (
          <h1 className="search-title">
            {documents ? <>Search <span className="num">{documents.toLocaleString()}</span> documents</> : documents === 0 ? "Nothing indexed yet" : "Search your documents"}
          </h1>
        )}
        <form className={`searchbox${busy ? " busy" : ""}`} role="search" onSubmit={(e) => { e.preventDefault(); if (suggestionIndex < 0) void run(); }}>
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            id="q"
            type="text"
            value={q}
            aria-label="Search documents"
            onChange={(e) => { ++compareGeneration.current; setCompare(null); setQ(e.target.value); setOptions((c) => ({ ...c, offset: 0 })); setSuggestionIndex(-1); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { hideSuggestions(); return; }
              if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setSuggestionIndex((n) => Math.min(n + 1, suggestions.length - 1)); return; }
              if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setSuggestionIndex((n) => Math.max(n - 1, -1)); return; }
              if (e.key === "Enter" && suggestionIndex >= 0) { e.preventDefault(); selectSuggestion(suggestions[suggestionIndex]!); }
            }}
            placeholder="Words, a filename, or a phrase"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onBlur={hideSuggestions}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="search-suggestions"
            aria-activedescendant={suggestionIndex >= 0 ? `suggestion-${suggestionIndex}` : undefined}
          />
          {q ? <button type="button" className="icon-button ghost" aria-label="Clear query" onClick={() => { setQ(""); inputRef.current?.focus(); }}><Icon name="x" size={14} /></button> : <kbd aria-hidden>/</kbd>}
          <button type="button" className={`icon-button options-trigger${tuned ? " tuned" : ""}`} popoverTarget="search-options" aria-label={`Search options${tuned ? `, ${tuned} changed` : ""}`}>
            <Icon name="sliders" />{tuned > 0 && <span className="badge-dot">{tuned}</span>}
          </button>
          <button className="button solid search-go" disabled={busy || !q.trim()}>{busy ? "Searching" : "Search"}</button>
          <span className="scanline" aria-hidden />
          {suggestions.length > 0 && (
            <div id="search-suggestions" className="suggestions" role="listbox">
              {suggestions.map((item, i) => (
                <button type="button" id={`suggestion-${i}`} role="option" aria-selected={i === suggestionIndex} key={item} onMouseDown={(e) => e.preventDefault()} onClick={() => selectSuggestion(item)}>
                  <Icon name="search" size={14} />{item}
                </button>
              ))}
            </div>
          )}
        </form>

        <div id="search-options" popover="auto" className="menu options-panel" aria-label="Search options">
          <Segmented label="Match" value={options.match ?? "text"} options={[["text", "Words"], ["literal", "Literal"], ["substring", "Substring"]]} onChange={(v) => change("match", v)} />
          {options.match && options.match !== "text" && <p className="hint">{options.match === "literal" ? "Exact text, case sensitive." : "Partial text, any case."} Scope to 2,000 documents or fewer.</p>}
          <Segmented label="Require" value={options.mode ?? "all"} options={[["all", "All words"], ["any", "Any word"]]} onChange={(v) => change("mode", v)} />
          <div className="switch-list">
            <Switch label="Exact phrase" checked={exact} onChange={(next) => { setExact(next); void run(q, options, next); }} />
            <Switch label="Prefix matching" checked={!!options.prefix} onChange={(next) => change("prefix", next)} />
            <Switch label="Typo tolerance" checked={!!options.typos} onChange={(next) => change("typos", next)} />
            <Switch label="Synonyms" checked={!!options.synonyms} onChange={(next) => { setSynonymError(null); change("synonyms", next ? {} : undefined); }} />
          </div>
          {options.synonyms && (
            <div className="synonyms">
              <textarea aria-label="Synonyms as JSON" value={synonymDraft} onChange={(e) => setSynonymDraft(e.target.value)} placeholder={'{"car": ["automobile"]}'} rows={3} spellCheck={false} />
              <button type="button" className="button small" onClick={applySynonyms}>Apply</button>
              {synonymError && <p role="alert" className="field-error">{synonymError}</p>}
            </div>
          )}
          <Segmented label="Ranking" value={options.profile ?? "tuned"} options={[["tuned", "Fields & passages"], ["baseline", "BM25"]]} onChange={(v) => change("profile", v)} />
          <Segmented label="Group" value={options.groupBy ?? "none"} options={[["none", "None"], ["repo", "Repository"], ["source", "Source"]]} onChange={(v) => change("groupBy", v)} />
          <div className="switch-list">
            <Switch label="Query inspector" hint="Stage timings and reads" checked={!!options.inspect} onChange={(next) => change("inspect", next)} />
          </div>
        </div>

        {idle && options.docIds !== undefined && (
          <span className="chip active">
            <Icon name="layers" size={13} />Searching in {scope?.name ?? "selected documents"}
            <button type="button" className="chip-x" aria-label="Clear collection scope" onClick={() => setOptions({ ...options, docIds: undefined })}><Icon name="x" size={12} /></button>
          </span>
        )}
        {idle && (recent.length > 0 || saved.length > 0) && (
          <div className="shortcuts">
            {saved.map((s) => (
              <span className="chip saved" key={s.id}>
                <button type="button" onClick={() => restore(s)}><Icon name="bookmark" size={13} />{s.name}</button>
                <button type="button" className="chip-x" aria-label={`Delete saved search ${s.name}`} onClick={() => deleteSaved(s.id)}><Icon name="x" size={12} /></button>
              </span>
            ))}
            {recent.slice(0, 6).map((item) => (
              <button type="button" key={item.id} className="chip" onClick={() => restore(item)}>{item.query}</button>
            ))}
          </div>
        )}
        {idle && documents === 0 && <Link className="button primary" href={sourcesHref}><Icon name="plus" />Add a source</Link>}
      </section>

      {err && <p className="alert" role="alert">{err}</p>}

      {(res || busy) && (
        <div className="result-bar">
          <span className="result-count">
            {res ? <><b>{res.total.toLocaleString()}</b> {res.total === 1 ? "match" : "matches"} <span className="mono">{res.tookMs.toFixed(1)} ms</span></> : "Searching…"}
          </span>
          {options.docIds !== undefined && (
            <span className="chip active">
              <Icon name="layers" size={13} />{scope?.name ?? "Selected documents"}
              <button type="button" className="chip-x" aria-label="Clear collection scope" onClick={() => change("docIds", undefined)}><Icon name="x" size={12} /></button>
            </span>
          )}
          {res?.facets && (Object.keys(FACETS) as Array<keyof typeof FACETS>).map((key) => {
            const values = res.facets?.[key];
            const active = options[key];
            if (!values?.length && !active) return null;
            const id = `facet-${key}`;
            return (
              <span key={key} className="facet">
                <button type="button" className={`chip${active ? " active" : ""}`} popoverTarget={id}>
                  {active ? <>{FACETS[key]}: <b>{active}</b></> : FACETS[key]}<Icon name="chevron" size={13} />
                </button>
                <div id={id} popover="auto" className="menu facet-menu" aria-label={`Filter by ${FACETS[key].toLowerCase()}`}>
                  {active && <button type="button" className="menu-item" onClick={() => { closeMenu(id); change(key, undefined); }}><Icon name="x" /><span>Clear filter</span></button>}
                  {values?.map((f) => (
                    <button type="button" key={f.value} className="menu-item" aria-pressed={active === f.value} onClick={() => { closeMenu(id); change(key, active === f.value ? undefined : f.value); }}>
                      <span className="tick">{active === f.value && <Icon name="check" size={14} />}</span><span>{f.value}</span><span className="count">{f.count}</span>
                    </button>
                  ))}
                </div>
              </span>
            );
          })}
          {res && (
            <span className="result-tools">
              <button type="button" className="icon-button" popoverTarget="result-tools" aria-label="More actions"><Icon name="more" /></button>
              <div id="result-tools" popover="auto" className="menu" aria-label="More actions">
                <button type="button" className="menu-item" onClick={() => { closeMenu("result-tools"); setNameDraft(q.trim()); setNameError(null); setSaving(true); }}><Icon name="bookmark" /><span>Save search</span></button>
                <button type="button" className="menu-item" onClick={() => { closeMenu("result-tools"); void runCompare(); }}><Icon name="layers" /><span>Compare ranking<small>BM25 next to fields & passages</small></span></button>
                <button type="button" className="menu-item" onClick={() => { closeMenu("result-tools"); setMissingTarget(undefined); setMissingOpen(true); }}><Icon name="info" /><span>Why is a document missing?</span></button>
              </div>
            </span>
          )}
        </div>
      )}

      {saving && (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); saveSearch(); }}>
          <input aria-label="Saved search name" autoFocus value={nameDraft} maxLength={256} onChange={(e) => setNameDraft(e.target.value)} aria-invalid={!!nameError} placeholder="Name this search" />
          <button className="button primary small">Save</button>
          <button type="button" className="button ghost small" onClick={() => setSaving(false)}>Cancel</button>
          {nameError && <p role="alert" className="field-error">{nameError}</p>}
        </form>
      )}
      {res?.inspector && <InspectorPanel inspector={res.inspector} />}
      {compare && <ComparePanel result={compare} offset={appliedOptions.offset ?? 0} onClose={() => setCompare(null)} />}
      {res && missingOpen && <MissingInspector key={res.query} query={res.query} options={appliedOptions} target={missingTarget} onClose={() => setMissingOpen(false)} />}

      <div className={`results${preview ? " has-preview" : ""}`}>
        <div className="results-main">
          {busy && !res && <div className="skeleton" aria-hidden>{[0, 1, 2].map((i) => <div key={i}><span /><span /><span /></div>)}</div>}
          {res && grouped && res.groups && (
            <div className="groups">
              {visibleGroups(res.groups, res.total).map((group) => (
                <GroupResults key={`${JSON.stringify([res.query, appliedOptions])}-${group.key}`} group={group} query={res.query} options={appliedOptions} onOpen={openPreview} onCollect={setCollectionTarget} />
              ))}
            </div>
          )}
          {res && res.hits.length === 0 && (
            <div className="empty">
              <h2>No matches for “{res.query}”</h2>
              <p>Try fewer words, turn on typo tolerance, or clear a filter.</p>
            </div>
          )}
          {res && !grouped && res.hits.length > 0 && (
            <ol className="hits" aria-label="Search results">
              {hits.map((hit, i) => (
                <HitRow key={hit.docId} index={i} hit={hit} rank={offset + i + 1} query={res.query} active={i === selected} onOpen={() => openPreview(hit)} onCollect={() => setCollectionTarget(hit.docId)} />
              ))}
            </ol>
          )}
          {res && !grouped && res.total > limit && (
            <Pager page={Math.floor(offset / limit) + 1} pages={Math.ceil(res.total / limit)} disabled={busy} onPrev={() => change("offset", Math.max(0, offset - limit))} onNext={() => change("offset", offset + limit)} />
          )}
          {res && res.hits.length > 0 && <p className="keys" aria-hidden>{grouped ? <><kbd>tab</kbd> move <kbd>enter</kbd> preview</> : <><kbd>j</kbd><kbd>k</kbd> move <kbd>enter</kbd> preview <kbd>esc</kbd> close</>}</p>}
        </div>
        {preview && res && (
          <Preview
            hit={preview}
            fullDoc={fullDoc}
            error={previewError}
            query={res.query}
            onClose={closePreview}
            onCollect={() => setCollectionTarget(preview.docId)}
          />
        )}
      </div>

      {collectionTarget && (
        <div className="sheet" role="dialog" aria-label="Add to collection">
          <div className="sheet-head"><h2>Add to collection</h2><button type="button" className="icon-button ghost" aria-label="Close" onClick={() => setCollectionTarget(null)}><Icon name="x" /></button></div>
          {collections.length > 0 && (
            <div className="sheet-list">
              {collections.map((c) => {
                const has = c.docIds.includes(collectionTarget);
                return (
                  <button type="button" key={c.id} className="menu-item" disabled={has} onClick={() => addToCollection(c.id)}>
                    <Icon name={has ? "check" : "layers"} /><span>{c.name}</span><span className="count">{c.docIds.length}</span>
                  </button>
                );
              })}
            </div>
          )}
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); createCollection(); }}>
            <input aria-label="New collection name" value={nameDraft} maxLength={256} onChange={(e) => setNameDraft(e.target.value)} placeholder="New collection" autoFocus={!collections.length} />
            <button className="button small" disabled={!nameDraft.trim()}><Icon name="plus" size={14} />Create</button>
            {nameError && <p role="alert" className="field-error">{nameError}</p>}
          </form>
          <p className="hint">Stored in this browser.</p>
        </div>
      )}
      {notice && <Toast key={notice.n} message={notice.text} />}
    </div>
  );
}

function Pager({ page, pages, disabled, onPrev, onNext }: { page: number; pages: number; disabled: boolean; onPrev: () => void; onNext: () => void }) {
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" className="button ghost small" disabled={disabled || page <= 1} onClick={onPrev}><Icon name="back" size={14} />Previous</button>
      <span className="mono">{page} / {pages}</span>
      <button type="button" className="button ghost small" disabled={disabled || page >= pages} onClick={onNext}>Next<Icon name="arrow" size={14} /></button>
    </nav>
  );
}

function GroupResults({ group, query, options, onOpen, onCollect }: { group: SearchGroup; query: string; options: SearchOptions; onOpen: (hit: SearchHit) => void; onCollect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const limit = options.limit ?? 10;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setResult(null);
    const field = options.groupBy === "repo" ? "repo" : "source";
    async function fetchGroup() {
      if (group.key) return search(query, { ...options, [field]: group.key, groupBy: "none", offset, limit });
      const matches: SearchHit[] = [];
      let scanned = 0;
      let response: SearchResponse;
      do {
        response = await search(query, { ...options, groupBy: "none", offset: scanned, limit: 100 });
        if (cancelled) return response;
        matches.push(...response.hits.filter((hit) => String(hit.doc[field] ?? "") === ""));
        scanned += response.hits.length;
      } while (matches.length < offset + limit && scanned < response.total && response.hits.length > 0);
      return { ...response, total: group.count, hits: matches.slice(offset, offset + limit) };
    }
    fetchGroup()
      .then((response) => { if (!cancelled) setResult(response); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load group"); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, offset, query, options, group.key, limit]);
  return (
    <details className="group" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><Icon name="chevron" size={14} /><span>{group.key || "Unassigned"}</span><span className="count">{group.count}</span></summary>
      {open && (
        <div className="group-body">
          {busy && <Spinner label="Loading group" />}
          {error && <p role="alert" className="alert">{error}</p>}
          <ol className="hits">
            {result?.hits.map((hit, i) => <HitRow key={hit.docId} index={i} hit={hit} rank={offset + i + 1} query={query} active={false} onOpen={() => onOpen(hit)} onCollect={() => onCollect(hit.docId)} />)}
          </ol>
          {result && result.total === 0 && <p className="hint">No matches in this group.</p>}
          {group.count > limit && <Pager page={Math.floor(offset / limit) + 1} pages={Math.ceil(group.count / limit)} disabled={busy} onPrev={() => setOffset(Math.max(0, offset - limit))} onNext={() => setOffset(offset + limit)} />}
        </div>
      )}
    </details>
  );
}

function Spinner({ label }: { label: string }) {
  return <p className="spinner" role="status"><span aria-hidden />{label}</p>;
}

function Highlighted({ passage }: { passage: SearchSnippet }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  passageMarks(passage).forEach((mark, i) => {
    if (mark.start > last) out.push(passage.text.slice(last, mark.start));
    out.push(<mark key={i} data-match-start={mark.start + passage.start}>{passage.text.slice(mark.start, mark.end)}</mark>);
    last = mark.end;
  });
  out.push(passage.text.slice(last));
  return <>{out}</>;
}

function where(passage: SearchSnippet) {
  return passage.page ? `p. ${passage.page}` : passage.line ? `line ${passage.line}` : passage.field;
}

function HitRow({ hit, index, rank, query, active, onOpen, onCollect }: { hit: SearchHit; index: number; rank: number; query: string; active: boolean; onOpen: () => void; onCollect: () => void }) {
  const { title, badge } = describe(hit.doc);
  const passages = distinctPassages(hit.snippet, hit.passages);
  const [first, ...rest] = passages;
  return (
    <li className={`hit${active ? " active" : ""}`} style={{ "--i": index } as React.CSSProperties}>
      <span className="hit-rank mono" aria-hidden>{rank}</span>
      <button type="button" className="hit-open" onClick={onOpen}>
        <span className="hit-title"><span className="tag">{badge}</span>{title}</span>
        <span className="hit-snippet">{first ? <><Highlighted passage={first} />{(first.page || first.line) && <span className="where">{where(first)}</span>}</> : snippet(hit.doc)}</span>
      </button>
      {rest.length > 0 && (
        <ul className="hit-more">
          {rest.map((p) => (
            <li key={`${p.field}-${p.start}`}>
              <Link href={documentMatchHref(hit.docId, query, p)}><span className="where">{where(p)}</span><span className="hit-snippet"><Highlighted passage={p} /></span></Link>
            </li>
          ))}
        </ul>
      )}
      <div className="hit-actions">
        <Link className="text-button" href={documentMatchHref(hit.docId, query, first)}><Icon name="external" size={14} />Open</Link>
        <button type="button" className="text-button" onClick={onCollect}><Icon name="plus" size={14} />Collect</button>
        <details className="score">
          <summary className="text-button mono">score {hit.score.toFixed(2)}</summary>
          <table>
            <thead><tr><th>term</th><th>tf</th><th>idf</th><th>contribution</th></tr></thead>
            <tbody>{hit.breakdown.map((b) => <tr key={b.term}><td>{b.term}</td><td>{b.termFrequency}</td><td>{b.idf.toFixed(3)}</td><td>{b.contribution.toFixed(4)}</td></tr>)}</tbody>
          </table>
        </details>
      </div>
    </li>
  );
}

function Preview({ onCollect, hit, fullDoc, error, query, onClose }: { onCollect: () => void; hit: SearchHit; fullDoc: Record<string, unknown> | null; error: string | null; query: string; onClose: () => void }) {
  const { title, badge } = describe(hit.doc);
  const first = hit.snippet ?? hit.passages?.[0];
  const text = fullDoc && first ? originalFieldText(fullDoc, first.field) : snippet(fullDoc ?? hit.doc, 700);
  const fullTextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = first?.matches[0]?.start;
    if (at !== undefined) fullTextRef.current?.querySelector(`[data-match-start="${at}"]`)?.scrollIntoView({ block: "center" });
  }, [fullDoc, hit.docId]);
  const matches = (hit.passages ?? (first ? [first] : [])).filter((p) => p.field === first?.field).flatMap((p) => p.matches);
  const fullPassage = { text, field: first?.field ?? "content", start: 0, end: text.length, matches };
  return (
    <aside className="preview" aria-label="Document preview" key={hit.docId}>
      <div className="preview-head">
        <span className="tag">{badge}</span>
        <button type="button" className="icon-button ghost" aria-label="Close preview" onClick={onClose}><Icon name="x" /></button>
      </div>
      <h2>{title}</h2>
      <div className="preview-actions">
        <Link className="button primary small" href={documentMatchHref(hit.docId, query, first)}>Open at match<Icon name="arrow" size={14} /></Link>
        <button type="button" className="button ghost small" onClick={onCollect}><Icon name="plus" size={14} />Add to collection</button>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      <div ref={fullTextRef} className="preview-text" tabIndex={0} aria-label="Full document text">
        {fullDoc ? <Highlighted passage={fullPassage} /> : error ? "Full document unavailable." : <Spinner label="Loading document" />}
      </div>
      {fullDoc && <details className="disclosure"><summary><Icon name="chevron" size={14} />All fields</summary><pre className="code">{JSON.stringify(fullDoc, null, 2)}</pre></details>}
    </aside>
  );
}

function InspectorPanel({ inspector }: { inspector: NonNullable<SearchResponse["inspector"]> }) {
  const stats: Array<[string, string]> = [
    ...Object.entries(inspector.stageMs).map(([name, ms]): [string, string] => [name, `${ms.toFixed(2)} ms`]),
    ["candidates", String(inspector.candidateCount)],
    ["posting reads", String(inspector.postingReads)],
    ["document reads", String(inspector.documentReads)],
    ...(inspector.cacheHits !== undefined ? [["cache hits", String(inspector.cacheHits)] as [string, string]] : []),
  ];
  return (
    <details className="panel inspector" open>
      <summary><Icon name="chevron" size={14} />Query inspector <span className="mono">{inspector.parsedQuery.join(" · ") || "filters only"}</span></summary>
      <dl className="stats">{stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {inspector.documentSource && <p className="hint">Documents read from {inspector.documentSource}.</p>}
      <details className="disclosure"><summary><Icon name="chevron" size={14} />Raw query data</summary><pre className="code">{JSON.stringify({ expansions: inspector.expansions, scoreBreakdown: inspector.scoreBreakdown }, null, 2)}</pre></details>
    </details>
  );
}

function ComparePanel({ result, offset, onClose }: { offset: number; result: { baseline: SearchResponse; tuned: SearchResponse }; onClose: () => void }) {
  const base = result.baseline.hits;
  const tuned = result.tuned.hits;
  return (
    <section className="panel compare" aria-label="Ranking comparison">
      <div className="panel-head"><h2>Ranking comparison</h2><button type="button" className="icon-button ghost" aria-label="Close comparison" onClick={onClose}><Icon name="x" /></button></div>
      <div className="compare-cols">
        {(["baseline", "tuned"] as const).map((profile) => (
          <div key={profile}>
            <h3>{profile === "baseline" ? "BM25" : "Fields & passages"} <span className="mono">{result[profile].tookMs.toFixed(2)} ms</span></h3>
            <ol>
              {result[profile].hits.map((hit, i) => {
                const other = (profile === "tuned" ? base : tuned).findIndex((h) => h.docId === hit.docId);
                const delta = other < 0 ? null : other - i;
                return (
                  <li key={hit.docId}>
                    <span className="mono rank">{offset + i + 1}</span>
                    <Link href={documentMatchHref(hit.docId, result[profile].query, hit.snippet)}>{describe(hit.doc).title}</Link>
                    <span className={`mono delta${delta === null ? " out" : delta > 0 ? " up" : delta < 0 ? " down" : ""}`} title={hit.breakdown.map((b) => `${b.term}: ${b.contribution.toFixed(3)}`).join(" · ")}>
                      {delta === null ? "new" : delta === 0 ? "=" : delta > 0 ? `+${delta}` : delta}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <p className="hint">Ranks are within this page. The change column shows how far each document moves against the other profile.</p>
    </section>
  );
}
