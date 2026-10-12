"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getDocument, type DocumentRecord } from "@/lib/api";
import { describe, renderMode, primaryText, type Doc } from "@/lib/docmeta";
import { originalFieldText } from "@/lib/workspace";
import { queryTerms, markText } from "@/lib/highlight";
import { CodeBlock, MarkdownBlock } from "@/components/DocumentRenderers";
import ThemeToggle from "@/components/ThemeToggle";
import { Brand, Icon } from "@/components/ui";

export default function DocumentPage() {
  return (
    <Suspense fallback={<div className="shell" />}>
      <DocumentInner />
    </Suspense>
  );
}

function DocumentInner() {
  const params = useParams<{ id: string }>();
  const id = String(params.id);
  const search = useSearchParams();
  const terms = queryTerms(search.get("q"));
  const field = search.get("field") ?? undefined;
  const rawAt = search.get("at");
  const at = rawAt !== null && /^\d+$/.test(rawAt) ? Number(rawAt) : undefined;
  const rawEnd = search.get("end");
  const end =
    rawEnd !== null && /^\d+$/.test(rawEnd) ? Number(rawEnd) : undefined;

  const [rec, setRec] = useState<DocumentRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setRec(null);
    getDocument(id)
      .then((record) => {
        if (!cancelled) setRec(record);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Not found");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  useEffect(() => {
    if (!rec || at === undefined) return;
    const timer = window.setTimeout(
      () =>
        document
          .getElementById("match-start")
          ?.scrollIntoView({ block: "center" }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [rec, at, field]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <Brand href="/app" />
          <span className="crumb-sep" aria-hidden>/</span>
          <span className="crumb">Document</span>
        </div>
        <div className="topbar-right"><ThemeToggle /></div>
      </header>
      <main className="page doc-page">
      <button type="button" className="text-button back" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/app"))}>
        <Icon name="back" size={14} />Back
      </button>

      {busy && <p className="spinner" role="status"><span aria-hidden />Loading document</p>}
      {err && <p className="alert" role="alert">{err}</p>}
      {rec && (
        <DocumentBody
          doc={rec.doc}
          id={rec.id}
          terms={terms}
          at={at}
          end={end}
          field={field}
        />
      )}
      </main>
    </div>
  );
}

function DocumentBody({
  doc,
  id,
  terms,
  at,
  end,
  field,
}: {
  doc: Doc;
  id: string;
  terms: string[];
  at?: number;
  end?: number;
  field?: string;
}) {
  const { title, badge } = describe(doc);
  const { mode, language } = renderMode(doc);
  const original =
    field !== undefined && Object.hasOwn(doc, field)
      ? originalFieldText(doc, field)
      : null;
  const jumpValid =
    original !== null &&
    at !== undefined &&
    Number.isSafeInteger(at) &&
    at >= 0 &&
    at < original.length;

  return (
    <>
      <header className="doc-head">
        <span className="tag">{badge}</span>
        <h1>{title}</h1>
        <DocMetaBar doc={doc} id={id} terms={terms} />
      </header>

      {field && !jumpValid && (
        <p className="alert" role="status">
          The requested match is no longer in this document.
        </p>
      )}
      <div className="doc-body">
        {jumpValid ? (
          <>
            <p className="row-meta mono">field: {field}</p>
            <pre className="text-block">
              {offsetMark(original!, terms, at, end)}
            </pre>
          </>
        ) : (
          <>
            {mode === "repo" && <RepoBody doc={doc} terms={terms} />}
            {mode === "code" && (
              <CodeBlock
                code={String(doc.content ?? "")}
                language={language}
                highlight={terms}
              />
            )}
            {mode === "markdown" && (
              <MarkdownBlock
                markdown={String(doc.content ?? "")}
                highlight={terms}
              />
            )}
            {mode === "pdf" && <PdfBody doc={doc} terms={terms} />}
            {mode === "text" && (
              <pre className="text-block">
                {offsetMark(String(doc.content ?? ""), terms, at)}
              </pre>
            )}
            {mode === "json" && (
              <CodeBlock
                code={JSON.stringify(doc, null, 2)}
                language="json"
                highlight={terms}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function offsetMark(text: string, terms: string[], at?: number, end?: number) {
  if (at === undefined || at < 0 || at >= text.length)
    return markText(text, terms);
  const matchEnd = Math.min(
    text.length,
    end !== undefined && end > at ? end : at + 1,
  );
  return (
    <>
      {markText(text.slice(0, at), terms)}
      <mark id="match-start">{text.slice(at, matchEnd)}</mark>
      {markText(text.slice(matchEnd), terms)}
    </>
  );
}

function DocMetaBar({ doc, id, terms }: { doc: Doc; id: string; terms: string[] }) {
  const facts: React.ReactNode[] = [];
  if (typeof doc.url === "string") facts.push(<a key="u" className="text-link" href={doc.url} target="_blank" rel="noreferrer">{doc.url.replace(/^https?:\/\//, "")}</a>);
  if (typeof doc.language === "string" && doc.language) facts.push(doc.language);
  if (typeof doc.pages === "number") facts.push(`${doc.pages} pages`);
  if (typeof doc.path === "string") facts.push(doc.path);
  facts.push(id);
  if (terms.length) facts.push(<span key="t" className="accent">matching {terms.join(" · ")}</span>);
  return <p className="doc-meta mono">{facts.map((f, i) => <span key={i}>{f}</span>)}</p>;
}

function RepoBody({ doc, terms }: { doc: Doc; terms: string[] }) {
  const topics = Array.isArray(doc.topics) ? (doc.topics as string[]) : [];
  return (
    <>
      {typeof doc.description === "string" && doc.description && (
        <p className="repo-desc">{markText(doc.description, terms)}</p>
      )}
      <p className="doc-meta mono">
        {typeof doc.stars === "number" && <span>{doc.stars} stars</span>}
        {typeof doc.forks === "number" && <span>{doc.forks} forks</span>}
        {topics.map((t) => <span key={t}>#{t}</span>)}
      </p>
      {typeof doc.readme === "string" ? (
        <div>
          <MarkdownBlock markdown={doc.readme} highlight={terms} />
        </div>
      ) : (
        <p className="hint">No README found for this repository.</p>
      )}
    </>
  );
}

function PdfBody({ doc, terms }: { doc: Doc; terms: string[] }) {
  const text = primaryText(doc);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return (
    <div className="pdf-text">
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
