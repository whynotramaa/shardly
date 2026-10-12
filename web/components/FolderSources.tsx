"use client";

import { useEffect, useRef, useState } from "react";
import { createFolder, folderAction, listFolders, type FolderSource } from "@/lib/api";
import { Icon, Toast } from "@/components/ui";

export default function FolderSources({ onChanged }: { onChanged: () => void }) {
  const [sources, setSources] = useState<FolderSource[]>([]);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const active = useRef(false);
  const synced = useRef("");
  const generation = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  async function refresh() {
    const request = ++generation.current;
    try {
      const next = await listFolders();
      if (active.current && request === generation.current) {
        setSources(next);
        const signature = JSON.stringify(next.map((source) => [source.id, source.lastSyncedAt, source.files]));
        if (synced.current && signature !== synced.current) onChangedRef.current();
        synced.current = signature;
      }
    } catch (e) {
      if (active.current && request === generation.current) setError(e instanceof Error ? e.message : "Could not load folders. Try refreshing.");
    }
  }
  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { active.current = false; ++generation.current; window.clearInterval(timer); };
  }, []);
  async function action(id: string, kind: "pause" | "resume" | "rescan" | "remove") {
    setBusy(id); setError(null); setNotice(null);
    try {
      const result = await folderAction(id, kind);
      if (!active.current) return;
      if (kind === "remove" && "removed" in result) { setRemoving(null); setNotice(`Folder removed, ${result.removed} documents deleted`); }
      await refresh(); onChangedRef.current();
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "Folder action failed. Try again."); }
    finally { if (active.current) setBusy(null); }
  }
  async function add() {
    setError(null); setNotice(null);
    if (!path.trim().startsWith("/")) { setError("Enter an absolute path on the server, such as /home/you/notes."); return; }
    setBusy("create");
    try { await createFolder(path.trim()); if (active.current) { setPath(""); setNotice("Folder added, first scan started"); await refresh(); onChangedRef.current(); } }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : "Could not add folder. Check its path and permissions."); }
    finally { if (active.current) setBusy(null); }
  }
  return (
    <section className="source">
      <span className="source-icon"><Icon name="folder" size={18} /></span>
      <div className="source-body">
        <h2>Folder</h2>
        <p className="hint">Watch a folder on the server. Changes sync on their own.</p>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input aria-label="Folder path" className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/you/notes" spellCheck={false} />
          <button className="button primary small" disabled={!!busy || !path.trim()}>Watch</button>
        </form>
        {error && <p role="alert" className="alert">{error}</p>}
        {sources.length > 0 && (
          <ul className="rows">
            {sources.map((source) => (
              <li key={source.id} className="row-item">
                <div className="row-line">
                  <span className="row-title mono">{source.path}</span>
                  <span className={`status s-${source.status}`}>{source.status}</span>
                  <button type="button" className="icon-button ghost" disabled={!!busy} aria-label={source.paused ? "Resume" : "Pause"} onClick={() => action(source.id, source.paused ? "resume" : "pause")}><Icon name={source.paused ? "play" : "pause"} size={14} /></button>
                  <button type="button" className="icon-button ghost" disabled={!!busy || source.status === "syncing"} aria-label="Rescan" onClick={() => action(source.id, "rescan")}><Icon name="refresh" size={14} /></button>
                  <button type="button" className="icon-button ghost" disabled={!!busy} aria-label="Remove folder" onClick={() => setRemoving(source.id)}><Icon name="trash" size={14} /></button>
                </div>
                <p className="row-meta mono">
                  {source.files} files · {source.progress.indexed} indexed{source.progress.removed ? ` · ${source.progress.removed} removed` : ""}
                  {source.lastSyncedAt && ` · synced ${new Date(source.lastSyncedAt).toLocaleString()}`}
                </p>
                {source.error && <p role="alert" className="field-error">{source.error}</p>}
                {removing === source.id && (
                  <div className="confirm">
                    <p>Stop watching and delete the documents this folder added? Files on disk stay.</p>
                    <button type="button" className="button danger small" disabled={!!busy} onClick={() => action(source.id, "remove")}>Remove</button>
                    <button type="button" className="button ghost small" onClick={() => setRemoving(null)}>Cancel</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Toast message={notice} />
    </section>
  );
}
