"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DocumentsView from "@/components/DocumentsView";
import CollectionMember from "@/components/CollectionMember";
import { Icon } from "@/components/ui";
import { loadCollections, loadSavedSearches, saveWorkspace, searchParams, type Collection, type SavedSearch } from "@/lib/workspace";

export default function LibraryWorkspace() {
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return (
    <div className="page">
      <header className="page-head">
        <h1>Library</h1>
        <p>Saved searches and collections live in this browser.</p>
      </header>
      {error && <p className="alert" role="alert">{error}</p>}

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
