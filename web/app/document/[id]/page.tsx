"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDocument, type DocumentRecord } from "@/lib/api";
import { describe, renderMode, primaryText, type Doc } from "@/lib/docmeta";
import { queryTerms, markText } from "@/lib/highlight";
import { CodeBlock, MarkdownBlock } from "@/components/DocumentRenderers";

export default function DocumentPage() {
  return (
    <Suspense fallback={<div className="container" />}>
      <DocumentInner />
    </Suspense>
  );
}

function DocumentInner() {
  const params = useParams<{ id: string }>();
  const id = String(params.id);
  const search = useSearchParams();
  const terms = queryTerms(search.get("q"));

  const [rec, setRec] = useState<DocumentRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    getDocument(id)
      .then(setRec)
      .catch((e) => setErr(e instanceof Error ? e.message : "Not found"))
      .finally(() => setBusy(false));
  }, [id]);

  return (
    <div className="container">
      <Link href="/app" className="back-link">
        ← Back to workspace
      </Link>

      {terms.length > 0 && (
        <div className="match-count">
          highlighting: {terms.join(" · ")}
        </div>
      )}

      {busy && <p className="meta">Loading document…</p>}
      {err && <div className="notice err">{err}</div>}
      {rec && <DocumentBody doc={rec.doc} id={rec.id} terms={terms} />}
    </div>
  );
}

function DocumentBody({
  doc,
  id,
  terms,
}: {
  doc: Doc;
  id: string;
  terms: string[];
}) {
  const { title, badge } = describe(doc);
  const { mode, language } = renderMode(doc);

  return (
    <>
      <div className="detail-head">
        <span className={`badge src-${badge.split(" ")[0]}`}>{badge}</span>
        <h1 className="detail-title">{title}</h1>
      </div>
      <DocMetaBar doc={doc} id={id} />

      <div className="panel detail-body">
        {mode === "repo" && <RepoBody doc={doc} terms={terms} />}
        {mode === "code" && (
          <CodeBlock
            code={String(doc.content ?? "")}
            language={language}
            highlight={terms}
          />
        )}
        {mode === "markdown" && (
          <MarkdownBlock markdown={String(doc.content ?? "")} highlight={terms} />
        )}
        {mode === "pdf" && <PdfBody doc={doc} terms={terms} />}
        {mode === "text" && (
          <pre className="text-block">
            {markText(String(doc.content ?? ""), terms)}
          </pre>
        )}
        {mode === "json" && (
          <CodeBlock
            code={JSON.stringify(doc, null, 2)}
            language="json"
            highlight={terms}
          />
        )}
      </div>
    </>
  );
}

/** Small facts bar shown for every document. */
function DocMetaBar({ doc, id }: { doc: Doc; id: string }) {
  const facts: Array<[string, React.ReactNode]> = [];
  if (typeof doc.url === "string")
    facts.push([
      "url",
      <a key="u" href={doc.url} target="_blank" rel="noreferrer">
        {doc.url}
      </a>,
    ]);
  if (typeof doc.language === "string" && doc.language) facts.push(["language", doc.language]);
  if (typeof doc.pages === "number") facts.push(["pages", doc.pages]);
  if (typeof doc.path === "string") facts.push(["path", doc.path]);
  facts.push(["id", <code key="id">{id}</code>]);

  return (
    <div className="stat-pills" style={{ marginBottom: 18 }}>
      {facts.map(([k, v], i) => (
        <span className="pill" key={i}>
          {k}: <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

function RepoBody({ doc, terms }: { doc: Doc; terms: string[] }) {
  const topics = Array.isArray(doc.topics) ? (doc.topics as string[]) : [];
  return (
    <>
      {typeof doc.description === "string" && doc.description && (
        <p className="repo-desc">{markText(doc.description, terms)}</p>
      )}
      <div className="stat-pills">
        {typeof doc.stars === "number" && (
          <span className="pill">★ <b>{doc.stars}</b> stars</span>
        )}
        {typeof doc.forks === "number" && (
          <span className="pill">⑃ <b>{doc.forks}</b> forks</span>
        )}
        {topics.map((t) => (
          <span key={t} className="term-chip">
            {t}
          </span>
        ))}
      </div>
      {typeof doc.readme === "string" ? (
        <div style={{ marginTop: 18 }}>
          <MarkdownBlock markdown={doc.readme} highlight={terms} />
        </div>
      ) : (
        <p className="meta">No README found for this repository.</p>
      )}
    </>
  );
}

function PdfBody({ doc, terms }: { doc: Doc; terms: string[] }) {
  const text = primaryText(doc);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return (
    <div className="pdf-text">
      <p className="meta" style={{ marginTop: 0 }}>
        Extracted text{typeof doc.pages === "number" ? ` · ${doc.pages} page(s)` : ""}
      </p>
      {paragraphs.length > 0 ? (
        paragraphs.map((p, i) => (
          <p key={i}>{markText(p.replace(/\s+/g, " ").trim(), terms)}</p>
        ))
      ) : (
        <pre className="text-block">{markText(text, terms)}</pre>
      )}
    </div>
  );
}
