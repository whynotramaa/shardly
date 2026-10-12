"use client";

import { useEffect, useRef, useState } from "react";
import { cancelRebuild, rebuildIndex, type RebuildProgress } from "@/lib/api";
import { Icon, Progress } from "@/components/ui";

export default function RebuildControl() {
  const [progress, setProgress] = useState<RebuildProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const request = useRef(0);
  async function refresh(start = false) {
    const id = ++request.current;
    if (start) { setBusy(true); setError(null); }
    try { const next = await rebuildIndex(start); if (active.current && id === request.current) { setProgress(next); setError(null); } }
    catch (e) { if (active.current && id === request.current) setError(e instanceof Error ? e.message : "Could not load rebuild status."); }
    finally { if (active.current && id === request.current) setBusy(false); }
  }
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; ++request.current; }; }, []);
  useEffect(() => {
    if (progress?.state !== "running") return;
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [progress?.state]);
  async function cancel() {
    setBusy(true); setError(null);
    try { await cancelRebuild(); if (active.current) await refresh(); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : "Could not cancel rebuild."); }
    finally { if (active.current) setBusy(false); }
  }
  const running = progress?.state === "running";
  return (
    <section className="source">
      <span className="source-icon"><Icon name="refresh" size={18} /></span>
      <div className="source-body">
        <h2>Rebuild index</h2>
        <p className="hint">Search keeps working while it runs. Documents are kept.</p>
        <div className="actions">
          <button type="button" className="button small" disabled={busy || running} onClick={() => void refresh(true)}>{busy && !running ? "Starting…" : running ? "Rebuilding…" : "Rebuild"}</button>
          {running && <button type="button" className="button ghost small" disabled={busy} onClick={() => void cancel()}>Cancel</button>}
          {progress && progress.state !== "idle" && <span className={`status s-${progress.state}`}>{progress.state}</span>}
        </div>
        {running && progress && (
          <div className="stack" role="status">
            <Progress value={progress.processed} max={Math.max(1, progress.total)} label="Index rebuild progress" />
            <p className="row-meta mono">{progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</p>
          </div>
        )}
        {(error || progress?.error) && <p className="alert" role="alert">{error ?? progress?.error}</p>}
      </div>
    </section>
  );
}
