"use client";

import { useEffect, useState } from "react";
import { wikipediaStatus, indexWikipedia, deindexWikipedia, type WikipediaStatus } from "@/lib/api";
import { Icon, Progress } from "@/components/ui";

export default function WikipediaLoader({ onIngested }: { onIngested: () => void }) {
  const [status, setStatus] = useState<WikipediaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ indexed: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => wikipediaStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { void refresh(); }, []);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setErr(null);
    try { await fn(); await refresh(); onIngested(); }
    catch (e) { setErr(e instanceof Error ? e.message : fallback); }
    finally { setBusy(false); setProgress(null); }
  }

  const available = status?.available ?? 0;
  const indexed = status?.indexed ?? 0;

  return (
    <section className="source">
      <span className="source-icon"><Icon name="book" size={18} /></span>
      <div className="source-body">
        <h2>Wikipedia sample</h2>
        {available === 0 ? (
          <p className="hint">No bundled corpus. Run <code>tsx scripts/fetch-wikipedia.ts</code> once to download it.</p>
        ) : (
          <p className="hint"><span className="mono">{indexed.toLocaleString()} / {available.toLocaleString()}</span> articles indexed</p>
        )}
        {available > 0 && (
          <div className="actions">
            {indexed > 0
              ? <button type="button" className="button small" disabled={busy} onClick={() => run(deindexWikipedia, "Removal failed")}>Remove from index</button>
              : <button type="button" className="button primary small" disabled={busy} onClick={() => { setProgress({ indexed: 0, total: available }); void run(() => indexWikipedia(setProgress), "Indexing failed"); }}>Index {available.toLocaleString()} articles</button>}
          </div>
        )}
        {busy && progress && (
          <div className="stack">
            <Progress value={progress.indexed} max={progress.total} label="Wikipedia indexing progress" />
            <p className="row-meta mono">{progress.indexed.toLocaleString()} / {progress.total.toLocaleString()}</p>
          </div>
        )}
        {err && <p className="alert" role="alert">{err}</p>}
      </div>
    </section>
  );
}
