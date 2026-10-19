"use client";

import { useRef, useState } from "react";
import { diagnostics, exportBackup, resetStore, restoreBackup, type DiagnosticsResponse } from "@/lib/api";
import RebuildControl from "@/components/RebuildControl";
import SemanticControl from "@/components/SemanticControl";
import ApiAccess from "@/components/ApiAccess";
import { Icon, Toast } from "@/components/ui";

export default function EngineView({ onChanged }: { onChanged: () => void }) {
  const backupInput = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [stats, setStats] = useState<DiagnosticsResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function task(name: string, fn: () => Promise<void>, fallback: string) {
    setBusy(name);
    setErr(null);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : fallback); }
    finally { setBusy(null); }
  }
  const inspect = () => task("inspect", async () => setStats(await diagnostics(term.trim() || undefined)), "Diagnostics failed");
  const download = () => task("backup", async () => {
    const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shardly-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }, "Backup export failed");
  const restore = (file: File | undefined) => file && task("restore", async () => {
    try {
      const result = await restoreBackup(JSON.parse(await file.text()));
      setNotice(`Restored, ${result.added} added, ${result.duplicates} already present`);
      onChanged();
    } finally {
      if (backupInput.current) backupInput.current.value = "";
    }
  }, "Restore failed. Check the store before retrying.");
  const clearAll = () => task("reset", async () => { await resetStore(); setConfirmReset(false); setNotice("All documents deleted"); onChanged(); }, "Reset failed");

  return (
    <div className="page">
      <header className="page-head">
        <h1>Engine</h1>
        <p>Maintenance and diagnostics for the index.</p>
      </header>
      {err && <p className="alert" role="alert">{err}</p>}
      <div className="sources">
        <ApiAccess onChanged={onChanged} />
        <RebuildControl />
        <SemanticControl />
        <section className="source">
          <span className="source-icon"><Icon name="search" size={18} /></span>
          <div className="source-body">
            <h2>Diagnostics</h2>
            <p className="hint">Index counts, or the postings for one term.</p>
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void inspect(); }}>
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Term (optional)" aria-label="Term to inspect" spellCheck={false} />
              <button className="button small" disabled={busy === "inspect"}>Inspect</button>
            </form>
            {stats && <pre className="code">{JSON.stringify(stats, null, 2)}</pre>}
          </div>
        </section>
        <section className="source">
          <span className="source-icon"><Icon name="download" size={18} /></span>
          <div className="source-body">
            <h2>Backup</h2>
            <p className="hint">Restoring adds missing documents and skips ones already here.</p>
            <div className="actions">
              <button type="button" className="button small" disabled={busy === "backup"} onClick={() => void download()}><Icon name="download" size={14} />{busy === "backup" ? "Preparing…" : "Download"}</button>
              <button type="button" className="button ghost small" disabled={busy === "restore"} onClick={() => backupInput.current?.click()}><Icon name="upload" size={14} />{busy === "restore" ? "Restoring…" : "Restore"}</button>
              <input ref={backupInput} type="file" accept="application/json" hidden onChange={(e) => void restore(e.target.files?.[0])} />
            </div>
          </div>
        </section>
        <section className="source danger-zone">
          <span className="source-icon"><Icon name="trash" size={18} /></span>
          <div className="source-body">
            <h2>Delete all documents</h2>
            <p className="hint">Empties the store. Source files stay on disk.</p>
            {confirmReset ? (
              <div className="confirm">
                <p>Delete every indexed document? This cannot be undone. Pause watched folders first.</p>
                <button type="button" className="button danger small" disabled={busy === "reset"} onClick={() => void clearAll()}>Delete everything</button>
                <button type="button" className="button ghost small" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <div className="actions"><button type="button" className="button danger-outline small" onClick={() => setConfirmReset(true)}>Delete all…</button></div>
            )}
          </div>
        </section>
      </div>
      <Toast message={notice} />
    </div>
  );
}
