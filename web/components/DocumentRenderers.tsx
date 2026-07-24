"use client";

import { useEffect, useRef } from "react";
import hljs from "highlight.js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { highlightDom } from "@/lib/highlight";

/** Syntax-highlighted code, with optional query-match highlighting. */
export function CodeBlock({
  code,
  language,
  highlight = [],
}: {
  code: string;
  language?: string;
  highlight?: string[];
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let html: string;
    try {
      if (language && hljs.getLanguage(language)) {
        html = hljs.highlight(code, { language }).value;
      } else {
        html = hljs.highlightAuto(code).value;
      }
    } catch {
      html = code.replace(/[&<>]/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
      );
    }
    el.innerHTML = html;
    if (highlight.length > 0) highlightDom(el, highlight);
  }, [code, language, highlight]);

  return (
    <pre className="code-block">
      <code ref={ref} className="hljs" />
    </pre>
  );
}

/** Rendered, sanitized Markdown — with real code highlighting and optional
 *  query-match highlighting. */
export function MarkdownBlock({
  markdown,
  highlight = [],
}: {
  markdown: string;
  highlight?: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raw = marked.parse(markdown, { async: false }) as string;
    el.innerHTML = DOMPurify.sanitize(raw);
    // Highlight fenced code blocks that marked emitted.
    el.querySelectorAll<HTMLElement>("pre code").forEach((block) => {
      try {
        hljs.highlightElement(block);
      } catch {
        /* leave un-highlighted on failure */
      }
    });
    if (highlight.length > 0) highlightDom(el, highlight);
  }, [markdown, highlight]);

  return <div className="markdown" ref={ref} />;
}
