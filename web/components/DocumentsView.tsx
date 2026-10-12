"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listDocuments, type DocumentList } from "@/lib/api";
import { describe, snippet } from "@/lib/docmeta";
import { Icon } from "@/components/ui";

const PAGE = 25;

export default function DocumentsView() {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<DocumentList | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setErr(null);
    listDocuments(offset, PAGE)
      .then((d) => active && setData(d))
      .catch((e) => active && setErr(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [offset]);

  const total = data?.total ?? 0;
  const to = Math.min(offset + PAGE, total);

  return (
    <>
      {err && <p className="alert" role="alert">{err}</p>}
      {total === 0 && !busy && !err && <p className="hint"><Link className="text-link" href="/app?view=sources">Add a source</Link> to fill your library.</p>}
      <ul className={`docs${busy ? " loading" : ""}`}>
        {data?.items.map((item, i) => {
          const { title, badge } = describe(item.doc);
          return (
            <li key={item.id} style={{ "--i": i } as React.CSSProperties}>
              <Link href={`/document/${encodeURIComponent(item.id)}`}>
                <span className="hit-title"><span className="tag">{badge}</span>{title}</span>
                <span className="doc-snippet">{snippet(item.doc, 160)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {total > PAGE && (
        <nav className="pager" aria-label="Document pages">
          <button type="button" className="button ghost small" onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={busy || offset === 0}><Icon name="back" size={14} />Previous</button>
          <span className="mono">{offset + 1}–{to} of {total.toLocaleString()}</span>
          <button type="button" className="button ghost small" onClick={() => setOffset(offset + PAGE)} disabled={busy || to >= total}>Next<Icon name="arrow" size={14} /></button>
        </nav>
      )}
    </>
  );
}
