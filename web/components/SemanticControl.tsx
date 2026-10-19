"use client";

import { useEffect, useState } from "react";
import { API_BASE, apiFetch, json } from "@/lib/api";
import { Icon } from "@/components/ui";

type Status = { enabled: boolean; model?: string; passages: number; dimensions: number; state: string; processed: number; total: number; error?: string };
export default function SemanticControl() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => { try { const value = await json<Status>(await apiFetch(`${API_BASE}/retrieval/semantic`)); if (live) { setStatus(value); setError(null); } } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not load meaning-search status."); } };
    void load(); const timer = window.setInterval(load, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  async function action(method: "POST" | "DELETE") {
    setBusy(true); setError(null);
    try { setStatus(await json<Status>(await apiFetch(`${API_BASE}/retrieval/semantic/index`, { method }))); }
    catch (e) { setError(e instanceof Error ? e.message : "Index action failed."); }
    finally { setBusy(false); }
  }
  return <section className="source"><span className="source-icon"><Icon name="search" size={18} /></span><div className="source-body"><h2>Meaning search</h2>
    <p className="hint">Keywords work without a model. Meaning search uses a model configured on the server; building this index sends searchable passages to that model.</p>
    {status && <p className="row-meta mono">{status.enabled ? `${status.model} · ${status.passages.toLocaleString()} passages · ${status.state}` : "No embedding model configured"}</p>}
    {status?.state === "running" && <p role="status">{status.processed} of {status.total} documents processed</p>}
    {status?.enabled && <div className="actions"><button type="button" className="button small" disabled={busy || status.state === "running"} onClick={() => action("POST")}>Build meaning index</button>{status.state === "running" && <button type="button" className="button ghost small" disabled={busy} onClick={() => action("DELETE")}>Cancel</button>}</div>}
    {(error || status?.error) && <p role="alert" className="field-error">{error ?? status?.error}</p>}
  </div></section>;
}
