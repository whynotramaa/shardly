"use client";

import { useEffect, useRef, useState } from "react";
import { cancelJob, listJobs, retryJob, startJob, type Job } from "@/lib/api";
import { newTerminalJobs } from "@/lib/jobs";
import { Check, Icon, Progress } from "@/components/ui";

export default function GitHubSource({ onChanged }: { onChanged: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [github, setGithub] = useState("");
  const [token, setToken] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seenTerminal = useRef(new Set<string>());
  const active = useRef(false);
  const refreshGeneration = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  async function refresh() {
    const request = ++refreshGeneration.current;
    try {
      const next = await listJobs();
      if (!active.current || request !== refreshGeneration.current) return;
      setJobs(next);
      if (newTerminalJobs(next, seenTerminal.current).length) onChangedRef.current();
    } catch (e) {
      if (active.current && request === refreshGeneration.current) setErr(e instanceof Error ? e.message : "Could not load jobs");
    }
  }
  useEffect(() => {
    active.current = true;
    void refresh();
    const id = window.setInterval(() => void refresh(), 1800);
    return () => { active.current = false; ++refreshGeneration.current; window.clearInterval(id); };
  }, []);
  async function create() {
    if (!github.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await startJob({ kind: "github", user: github.trim(), deep, token: token.trim() || undefined });
      setGithub("");
      setToken("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start GitHub import");
    } finally {
      setBusy(false);
    }
  }
  async function act(fn: () => Promise<unknown>, fallback: string) {
    try { await fn(); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : fallback); }
  }

  return (
    <section className="source">
      <span className="source-icon"><Icon name="github" size={18} /></span>
      <div className="source-body">
        <h2>GitHub</h2>
        <p className="hint">Import an account or one repository.</p>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input aria-label="GitHub account or repository" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="owner or owner/repo" spellCheck={false} />
          <button className="button primary small" disabled={busy || !github.trim()}>Import</button>
        </form>
        <details className="disclosure">
          <summary><Icon name="chevron" size={14} />Private repos and source files</summary>
          <div className="stack">
            <input type="password" aria-label="GitHub token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token, kept in memory only" autoComplete="off" />
            <Check label="Index source files" hint="Reads every file, not only the README" checked={deep} onChange={setDeep} />
          </div>
        </details>
        {err && <p className="alert" role="alert">{err}</p>}
        {jobs.length > 0 && (
          <ul className="rows">
            {jobs.map((job) => <JobRow key={job.id} job={job}
              onCancel={() => void act(() => cancelJob(job.id), "Could not cancel import")}
              onRetry={() => void act(() => retryJob(job.id, job.request.kind === "github" ? token.trim() || undefined : undefined), "Could not retry import")} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

function JobRow({ job, onCancel, onRetry }: { job: Job; onCancel: () => void; onRetry: () => void }) {
  const { completed, total } = job.progress;
  const running = job.status === "queued" || job.status === "running";
  const counts = job.result && typeof job.result.ingestion === "object" && job.result.ingestion !== null ? (job.result.ingestion as Record<string, unknown>) : null;
  return (
    <li className="row-item">
      <div className="row-line">
        <span className="row-title">{job.request.user ?? "Wikipedia corpus"}</span>
        <span className={`status s-${job.status}`}>{job.status}</span>
        {running && <button type="button" className="text-button" onClick={onCancel}>Cancel</button>}
        {(job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") && <button type="button" className="text-button" onClick={onRetry}><Icon name="refresh" size={14} />Retry</button>}
      </div>
      {running && <Progress value={completed} max={total || undefined} label={`Import progress for ${job.request.user ?? "corpus"}`} />}
      <p className="row-meta mono">
        {counts ? `${Number(counts.added ?? 0)} added · ${Number(counts.updated ?? 0)} updated · ${Number(counts.duplicates ?? 0)} unchanged` : `${completed.toLocaleString()} / ${total.toLocaleString()}`}
      </p>
      {job.error && <p className="field-error">{job.error}</p>}
    </li>
  );
}
