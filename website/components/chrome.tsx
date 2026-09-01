import type { ReactNode, CSSProperties } from "react";

export interface SectionMeta {
  id: string;
  n: string;
  kicker: string;
  title: string;
}

/** The running order. The rail, the header, and the sections all read it. */
export const SECTIONS: SectionMeta[] = [
  { id: "idea",      n: "01", kicker: "Premise",        title: "Two maps" },
  { id: "record",    n: "02", kicker: "Storage",        title: "A record on disk" },
  { id: "append",    n: "03", kicker: "Storage",        title: "Append only" },
  { id: "wal",       n: "04", kicker: "Durability",     title: "The write-ahead log" },
  { id: "recovery",  n: "05", kicker: "Durability",     title: "Recovery" },
  { id: "fsync",     n: "06", kicker: "Throughput",     title: "Group commit" },
  { id: "compact",   n: "07", kicker: "Maintenance",    title: "Compaction" },
  { id: "snapshot",  n: "08", kicker: "Maintenance",    title: "Snapshots" },
  { id: "token",     n: "09", kicker: "Search",         title: "Tokenization" },
  { id: "index",     n: "10", kicker: "Search",         title: "The inverted index" },
  { id: "bm25",      n: "11", kicker: "Ranking",        title: "BM25" },
  { id: "topn",      n: "12", kicker: "Ranking",        title: "Top-N selection" },
  { id: "bench",     n: "13", kicker: "Measurement",    title: "The benchmark" },
  { id: "ingest",    n: "14", kicker: "Intake",         title: "Ingestion" },
  { id: "http",      n: "15", kicker: "Interface",      title: "The HTTP layer" },
  { id: "cost",      n: "16", kicker: "Reference",      title: "Cost of everything" },
  { id: "lucene",    n: "17", kicker: "Context",        title: "Against Lucene" },
  { id: "limits",    n: "18", kicker: "Honesty",        title: "Where it stops" },
];

export function Section({
  meta,
  children,
  style,
  tone,
}: {
  meta: SectionMeta;
  children: ReactNode;
  style?: CSSProperties;
  tone?: "paper";
}) {
  return (
    <section
      id={meta.id}
      className={`sec ${tone ? `${tone} bleed` : ""}`}
      style={style}
      data-sec={meta.id}
    >
      <div className="sec-index">
        <span className="n">{meta.n}</span>
        <span className="t">{meta.kicker}</span>
        <span className="rule" />
        <span className="t">{meta.title}</span>
      </div>
      {children}
    </section>
  );
}

/** Section title plus optional standfirst. */
export function Head({
  title,
  lede,
  span = 8,
}: {
  title: ReactNode;
  lede?: ReactNode;
  span?: number;
}) {
  return (
    <div className="sec-head cols">
      <div className={`c-${span}`}>
        <h2 className="display d-md">{title}</h2>
        {lede ? <p className="lede" style={{ marginTop: 22 }}>{lede}</p> : null}
      </div>
    </div>
  );
}

/** A bordered figure with a numbered caption. Every diagram uses it. */
export function Figure({
  n,
  cap,
  children,
  tone,
  pad,
}: {
  n: string;
  cap: ReactNode;
  children: ReactNode;
  tone?: "paper" | "accent";
  pad?: number;
}) {
  return (
    <figure className={`fig ${tone ?? ""}`} style={{ margin: 0 }}>
      <div
        className="fig-body"
        style={pad !== undefined ? { padding: pad } : undefined}
      >
        {children}
      </div>
      <figcaption className="fig-cap">
        <span className="k">FIG {n}</span>
        <span className="v">{cap}</span>
      </figcaption>
    </figure>
  );
}

export function Marks() {
  return (
    <span className="marks" aria-hidden>
      <span className="tl" />
      <span className="tr" />
      <span className="bl" />
      <span className="br" />
    </span>
  );
}

export function DotRule({ style }: { style?: CSSProperties }) {
  return <hr className="dot-rule" style={style} />;
}

export function Ticks({ n = 40 }: { n?: number }) {
  return (
    <div className="tick-row" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

export function Microtext({ text, times = 14 }: { text: string; times?: number }) {
  return (
    <div className="microtext" aria-hidden>
      {Array.from({ length: times }, () => text).join("  ·  ")}
    </div>
  );
}

export function Stat({
  v,
  u,
  serif = true,
}: {
  v: ReactNode;
  u: string;
  serif?: boolean;
}) {
  return (
    <span className="stat">
      <span
        className="v"
        style={
          serif ? undefined : { fontFamily: "var(--f-mono)", fontSize: 28 }
        }
      >
        {v}
      </span>
      <span className="u">{u}</span>
    </span>
  );
}
