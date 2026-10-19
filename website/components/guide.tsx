import type { ReactNode } from "react";
import { source } from "../lib/facts";

export function Chapter({ id, title, children, files }: { id: string; title: string; children: ReactNode; files: string[] }) {
  return <section id={id} className="chapter">
    <div className="chapter-title"><a href={`#${id}`} aria-label={`Link to ${title}`}>#</a><h2>{title}</h2></div>
    <div className="reading">{children}</div>
    <p className="source-links">Read the implementation: {files.map((file, i) => <span key={file}>{i > 0 ? " · " : ""}<a href={source(file)}>{file.split("/").pop()}</a></span>)}</p>
  </section>;
}

export function Drawing({ children, caption }: { children: ReactNode; caption: string }) {
  return <figure className="guide-figure">{children}<figcaption>{caption}</figcaption></figure>;
}

export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-group"><p className="table-pan-hint">Scroll horizontally to read every column.</p><div className="table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div></div>;
}
