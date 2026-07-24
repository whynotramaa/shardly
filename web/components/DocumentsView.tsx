"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listDocuments, type DocumentList } from "@/lib/api";
import { describe, snippet } from "@/lib/docmeta";

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
    return () => {
      active = false;
    };
  }, [offset]);

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  return (
    <div>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="meta" style={{ margin: 0 }}>
            {total > 0
              ? `Showing ${from}–${to} of ${total.toLocaleString()} indexed documents`
              : busy
                ? "Loading…"
                : "No documents indexed yet."}
          </span>
          <div className="row">
            <button
              className="pager"
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
              disabled={busy || offset === 0}
            >
              ← Prev
            </button>
            <button
              className="pager"
              onClick={() => setOffset(offset + PAGE)}
              disabled={busy || to >= total}
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {err && <div className="notice err">{err}</div>}

      {total === 0 && !busy && !err && (
        <p className="meta">
          Head to <b>Upload</b> or <b>GitHub</b> to add documents.
        </p>
      )}

      <div className="doc-list">
        {data?.items.map((item) => {
          const { title, badge } = describe(item.doc);
          return (
            <Link key={item.id} href={`/document/${item.id}`} className="doc-row">
              <div className="doc-row-head">
                <span className={`badge src-${badge.split(" ")[0]}`}>{badge}</span>
                <span className="doc-title">{title}</span>
              </div>
              <div className="doc-snippet">{snippet(item.doc)}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
