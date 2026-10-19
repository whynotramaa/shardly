"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DocumentsView from "@/components/DocumentsView";
import CollectionMember from "@/components/CollectionMember";
import { Icon } from "@/components/ui";
import { loadCollections, loadSavedSearches, saveWorkspace, searchParams, portableWorkspace, importWorkspace, type Collection, type SavedSearch } from "@/lib/workspace";
import { API_BASE, apiFetch, json } from "@/lib/api";

export default function LibraryWorkspace() {
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setSaved(loadSavedSearches()); setCollections(loadCollections()); }, []);
  function store(next: Collection[]) {
    const err = saveWorkspace("shardly-collections", next);
    setError(err);
    if (err) return false;
    setCollections(next);
    return true;
  }
  function removeSaved(id: string) {
    const next = saved.filter((s) => s.id !== id);
    const err = saveWorkspace("shardly-saved-searches", next);
    setError(err);
    if (!err) setSaved(next);
  }
  function submit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 256) { setError("Enter a name of 1–256 characters."); return; }
    const next = editing ? collections.map((c) => c.id === editing ? { ...c, name: trimmed } : c) : [...collections, { id: crypto.randomUUID(), name: trimmed, docIds: [] }];
    if (store(next)) setFormOpen(false);
  }
  async function transfer(action: "upload" | "download" | "export" | "import", file?: File) {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (action === "export") {
        const url = URL.createObjectURL(new Blob([JSON.stringify(portableWorkspace(), null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "shardly-saved-work.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      } else if (action === "upload") {
        await json(await apiFetch(`${API_BASE}/workspace`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(portableWorkspace()) }));
        setNotice("Saved work copied to the server. Collections are now available to search agents and included in backups.");
      } else {
        if (file && file.size > 2 * 1024 * 1024) throw new Error("Saved-work file exceeds 2 MiB.");
        const value: unknown = action === "import" ? JSON.parse(await file!.text()) : await json(await apiFetch(`${API_BASE}/workspace`));
        const imported = importWorkspace(value); setCollections(imported.collections); setSaved(imported.searches); setNotice("Saved work loaded into this browser.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Transfer failed."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return (
    <div className="page">
      <header className="page-head">
        <h1>Library</h1>
        <p>Manage saved searches and collections, and keep a portable copy.</p>
      </header>
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      <section className="block"><h2>Saved work</h2><p className="hint">Edits stay in this browser until you save them to the server. Import and Load replace this browser's saved work; export a copy first if you need to keep it.</p><div className="actions">
        <button type="button" className="button small" disabled={busy} onClick={() => transfer("export")}>Export saved work</button>
        <button type="button" className="button ghost small" disabled={busy} onClick={() => input.current?.click()}>Import saved work</button>
        <button type="button" className="button ghost small" disabled={busy} onClick={() => transfer("upload")}>Save to server</button>
        <button type="button" className="button ghost small" disabled={busy} onClick={() => transfer("download")}>Load from server</button>
        <input hidden type="file" ref={input} accept="application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void transfer("import", file); }} />
      </div></section>

      <section className="block">
        <h2>Saved searches</h2>
        {saved.length === 0 ? <p className="hint">Save a search from its results menu.</p> : (
          <ul className="list">
            {saved.map((item) => (
              <li key={item.id}>
                <Link href={`/app?${searchParams(item.query, item.options, item.exact)}`} className="list-link"><Icon name="bookmark" size={15} /><span>{item.name}<small className="mono">{item.query}</small></span></Link>
                <button type="button" className="icon-button ghost" aria-label={`Remove ${item.name}`} onClick={() => removeSaved(item.id)}><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Collections</h2>
          {!formOpen && <button type="button" className="text-button" onClick={() => { setEditing(null); setName(""); setError(null); setFormOpen(true); }}><Icon name="plus" size={14} />New</button>}
        </div>
        {formOpen && (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input aria-label={editing ? "Collection name" : "New collection name"} autoFocus maxLength={256} value={name} onChange={(e) => setName(e.target.value)} placeholder="Collection name" />
            <button className="button primary small">Save</button>
            <button type="button" className="button ghost small" onClick={() => setFormOpen(false)}>Cancel</button>
          </form>
        )}
        {collections.length === 0 && !formOpen && <p className="hint">Collect documents from search results to group them here.</p>}
        <div className="collections">
          {collections.map((collection) => (
            <details className="collection" key={collection.id}>
              <summary><Icon name="chevron" size={14} /><span>{collection.name}</span><span className="count">{collection.docIds.length}</span></summary>
              <div className="collection-body">
                <div className="actions">
                  <Link className="button small" href={`/app?${searchParams("", { docIds: collection.docIds })}`}><Icon name="search" size={14} />Search within</Link>
                  <button type="button" className="button ghost small" onClick={() => { setEditing(collection.id); setName(collection.name); setError(null); setFormOpen(true); }}>Rename</button>
                  <button type="button" className="button ghost small" onClick={() => store(collections.filter((c) => c.id !== collection.id))}>Delete</button>
                </div>
                {collection.docIds.length === 0 && <p className="hint">Empty. Deleting a collection keeps its documents.</p>}
                <ul className="list">
                  {collection.docIds.map((id) => <CollectionMember key={id} id={id} collection={collection.name} onRemove={() => store(collections.map((c) => c.id === collection.id ? { ...c, docIds: c.docIds.filter((docId) => docId !== id) } : c))} />)}
                </ul>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>All documents</h2>
        <DocumentsView />
      </section>
    </div>
  );
}
