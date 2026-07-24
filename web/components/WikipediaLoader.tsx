"use client";

import { useEffect, useState } from "react";
import {
  wikipediaStatus,
  indexWikipedia,
  deindexWikipedia,
  type WikipediaStatus,
} from "@/lib/api";

/** Toggle the bundled Wikipedia corpus in and out of the index. The corpus is
 *  pre-fetched to disk, so this never touches the live (rate-limited) API and
 *  de-indexing keeps the saved file — you can re-index it instantly. */
export default function WikipediaLoader({
  onIngested,
}: {
  onIngested: () => void;
}) {
  const [status, setStatus] = useState<WikipediaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ indexed: number; total: number } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);

  const refresh = () =>
    wikipediaStatus()
      .then(setStatus)
      .catch(() => setStatus(null));

  useEffect(() => {
    refresh();
  }, []);

  async function doIndex() {
    setBusy(true);
    setErr(null);
    setProgress({ indexed: 0, total: status?.available ?? 0 });
    try {
      await indexWikipedia(setProgress);
      await refresh();
      onIngested();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Indexing failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function doDeindex() {
    setBusy(true);
    setErr(null);
    try {
      await deindexWikipedia();
      await refresh();
      onIngested();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "De-index failed");
    } finally {
      setBusy(false);
    }
  }

  const available = status?.available ?? 0;
  const indexed = status?.indexed ?? 0;
  const isIndexed = indexed > 0;
  const pct =
    progress && progress.total > 0
      ? Math.min(100, (progress.indexed / progress.total) * 100)
      : 0;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <label style={{ marginBottom: 4 }}>Or index a bundled corpus</label>
      <div className="dz-title" style={{ fontSize: 16, marginBottom: 6 }}>
        Wikipedia articles
      </div>

      {available === 0 ? (
        <p className="hint" style={{ marginTop: 0 }}>
          No bundled corpus found. Run{" "}
          <code>tsx scripts/fetch-wikipedia.ts</code> once to save it, then this
          panel will let you index it with a click.
        </p>
      ) : (
        <p className="hint" style={{ marginTop: 0 }}>
          <b>{available.toLocaleString()}</b> real Wikipedia articles are
          pre-fetched to disk. Indexing loads them through the same write path as
          your uploads — no live API calls, nothing to rate-limit. De-indexing
          removes them from search but keeps the saved file.
        </p>
      )}

      {available > 0 && (
        <div className="row" style={{ marginTop: 12, alignItems: "center", gap: 14 }}>
          <button
            className="primary"
            onClick={doIndex}
            disabled={busy || isIndexed}
          >
            {isIndexed ? "Indexed ✓" : `Index ${available.toLocaleString()} articles`}
          </button>
          <button
            className="danger"
            onClick={doDeindex}
            disabled={busy || !isIndexed}
          >
            De-index
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {indexed.toLocaleString()} of {available.toLocaleString()} indexed
          </span>
        </div>
      )}

      {busy && progress && (
        <div className="loader">
          <div className="loader-head">
            <span className="loader-spin" />
            Indexing bundled corpus…
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-meta">
            <span>
              {progress.indexed.toLocaleString()} /{" "}
              {progress.total.toLocaleString()} indexed
            </span>
            <span>{pct.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {err && <div className="notice err">{err}</div>}
    </div>
  );
}
