"use client";

import { useEffect } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

/* =========================================================================
   Engineering deep-dive — every subsystem and the decision behind it.
   ========================================================================= */

const K1 = 1.5;

/** BM25 term-frequency saturation curve: sat(tf) = tf·(k1+1)/(tf+k1). */
function SaturationCurve() {
  const W = 520;
  const H = 210;
  const padL = 44;
  const padB = 34;
  const padT = 16;
  const padR = 16;
  const maxTf = 10;
  const maxY = 3.2; // headroom above the k1+1 = 2.5 asymptote
  const x = (tf: number) => padL + (tf / maxTf) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / maxY) * (H - padB - padT);

  const sat: string[] = [];
  const lin: string[] = [];
  for (let tf = 0; tf <= maxTf; tf += 0.25) {
    sat.push(`${x(tf).toFixed(1)},${y((tf * (K1 + 1)) / (tf + K1)).toFixed(1)}`);
    lin.push(`${x(tf).toFixed(1)},${y(Math.min(tf, maxY)).toFixed(1)}`);
  }
  const asymptoteY = y(K1 + 1);

  return (
    <div className="eng-figure">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="BM25 term-frequency saturation curve">
        {/* axes */}
        <line className="curve-axis" x1={padL} y1={padT} x2={padL} y2={H - padB} />
        <line className="curve-axis" x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} />
        {/* asymptote k1+1 */}
        <line
          className="curve-line faint"
          x1={padL}
          y1={asymptoteY}
          x2={W - padR}
          y2={asymptoteY}
        />
        <text className="curve-label" x={W - padR} y={asymptoteY - 5} textAnchor="end">
          k1 + 1 = 2.5 (ceiling)
        </text>
        {/* linear reference */}
        <polyline className="curve-line faint" points={lin.join(" ")} />
        {/* saturated */}
        <polyline className="curve-line" points={sat.join(" ")} />
        {/* labels */}
        <text className="curve-label" x={(padL + W) / 2} y={H - 8} textAnchor="middle">
          term frequency (tf) →
        </text>
        <text className="curve-label" x={12} y={padT + 6} transform={`rotate(-90 12 ${H / 2})`}>
          weight
        </text>
      </svg>
      <div className="eng-fig-cap">
        The 10th occurrence of a word barely moves the score — BM25 saturates
        term frequency (solid) instead of counting it linearly (dashed).
      </div>
    </div>
  );
}

function Section({
  id,
  n,
  kicker,
  title,
  children,
}: {
  id: string;
  n: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="eng-section" id={id}>
      <div className="eng-kicker">
        {n} · {kicker}
      </div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const TOC = [
  ["overview", "Overview"],
  ["storage", "Append-only storage"],
  ["durability", "WAL & crash recovery"],
  ["tokenizer", "Tokenization"],
  ["index", "Inverted index"],
  ["bm25", "BM25 ranking"],
  ["twopass", "Two-pass + heap"],
  ["ingest", "Ingestion adapters"],
  ["benchmark", "Benchmark"],
  ["api", "API surface"],
  ["sources", "Sources"],
];

export default function EngineeringPage() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) e.target.classList.add("in");
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll(".eng-section").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="eng">
      <nav className="eng-nav">
        <Link href="/" className="nav-brand">
          Shardly<span className="dot">.</span>
        </Link>
        <div className="eng-nav-links">
          <Link href="/app" className="hide-sm">workspace</Link>
          <Link href="/">home</Link>
          <ThemeToggle />
        </div>
      </nav>

      <header className="eng-hero">
        <span className="eyebrow">Engineering deep-dive</span>
        <h1>Every layer of Shardly, and the decision behind it.</h1>
        <p>
          Shardly is a document store with full-text search built from first
          principles — no database, no search library. This page walks the whole
          system top to bottom: how bytes hit disk, how a crash is survived, how
          text becomes an index, and how BM25 turns a query into a ranking in
          single-digit milliseconds. Nothing is hand-waved.
        </p>

        <div className="eng-toc">
          <div className="eng-toc-title">Contents</div>
          <ol>
            {TOC.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`}>
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </header>

      {/* 01 — Overview */}
      <Section id="overview" n="01" kicker="THE SHAPE OF IT" title="One request, end to end">
        <p>
          A document arrives (an upload, a GitHub repo, a Wikipedia article). It
          is written durably to disk, tokenized, and folded into an in-memory
          inverted index. A later query never touches the corpus on disk — it
          walks posting lists in memory, scores candidates with BM25, and reads
          the raw bytes of only the handful of documents it will actually return.
        </p>
        <pre className="ascii">{`  ┌──────────┐   ┌───────────────┐   ┌──────────────┐   ┌─────────────┐
  │ Adapter  │──▶│ Segment writer│──▶│ Inverted     │──▶│ BM25 ranker │──▶ results
  │ file/pdf │   │ append-only   │   │ index (RAM)  │   │ + heap top-N│
  │ repo/wiki│   │ + WAL (fsync) │   │ term→postings│   └─────────────┘
  └──────────┘   └───────────────┘   └──────────────┘
                        │                    ▲
                   crash-safe           rebuilt from disk
                   durability           on startup (snapshot or replay)`}</pre>
        <p className="ascii-cap">
          The write path is durable and sequential; the read path is in-memory
          and random-access. Keeping those two concerns apart is the core design.
        </p>
        <div className="callout">
          <div className="callout-label">Design axis</div>
          <p>
            Latency is the priority. Every decision below trades in favour of a
            fast, predictable read path — even when that costs more work on write
            or more memory.
          </p>
        </div>
      </Section>

      {/* 02 — Storage */}
      <Section id="storage" n="02" kicker="BYTES ON DISK" title="Append-only segment storage">
        <p>
          Documents are appended as newline-delimited JSON records to segment
          files. Writing is always sequential — the fastest thing a disk does —
          and records are never rewritten in place. When a segment reaches{" "}
          <code>64&nbsp;MB</code> it is sealed and a new one is opened.
        </p>
        <pre className="ascii">{`  segments/000000.seg                       (append-only, immutable once sealed)
  ┌───────────────┬───────────────┬───────────────┬──▶ grows to the right
  │ {"id":…}\\n    │ {"id":…}\\n    │ {"id":…}\\n    │
  └───────────────┴───────────────┴───────────────┘
    ▲offset 0        ▲offset 128      ▲offset 291

  offsetIndex (in memory):   id ──▶ { segment, offset }
  read(id):  fs.readSync(fd, buf, 0, len, offset)   ← one positioned read, O(1)`}</pre>
        <p>
          Reading a document by id is a single <code>readSync</code> at a known
          offset — no scan, no parse of neighbours. The <code>offsetIndex</code>{" "}
          lives in memory and file descriptors are cached, so a hot read is one
          syscall.
        </p>
        <div className="eng-table-wrap">
          <table className="eng-table">
            <thead>
              <tr><th>Decision</th><th>Why</th><th>Cost accepted</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>append-only</td>
                <td>sequential writes are ~orders faster than random; no in-place corruption window</td>
                <td>deletes need tombstones; space reclaimed only by compaction</td>
              </tr>
              <tr>
                <td>offset index in RAM</td>
                <td>turns read-by-id into O(1) positioned read</td>
                <td>memory proportional to document count</td>
              </tr>
              <tr>
                <td>fd cache</td>
                <td>avoids an open()/close() per read</td>
                <td>open descriptors held for the process lifetime</td>
              </tr>
              <tr>
                <td>64 MB segments</td>
                <td>bounds file size; enables future per-segment compaction</td>
                <td>rotation logic on the write path</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* 03 — Durability */}
      <Section id="durability" n="03" kicker="SURVIVING A CRASH" title="Write-ahead log & recovery">
        <p>
          A segment append alone is not safe: a crash mid-write could leave a
          torn record that the index still believes exists. Shardly uses a
          write-ahead log with a two-phase <code>pending → committed</code>{" "}
          handshake around every write.
        </p>
        <pre className="ascii">{`  write(doc):
     1. WAL  ← {op:write, id, seg, offset, status:PENDING}      fsync
     2. SEG  ← append the JSON record at that offset
     3. WAL  ← {op:write, id, status:COMMITTED}                 fsync

  recovery on startup — replay the WAL:
     COMMITTED  ─────────────▶ trust it, apply id→offset to the index
     PENDING (never committed) ─▶ read the bytes at offset:
                                    parses cleanly ─▶ keep
                                    torn / partial ─▶ discard`}</pre>
        <p>
          The log records intent <em>before</em> the data lands and confirmation{" "}
          <em>after</em>. On restart, a committed record is trusted; a pending
          record with no commit is verified against the actual bytes and kept
          only if intact. The WAL reader also tolerates a torn <em>final</em>{" "}
          line — the one record that was mid-fsync when power was lost.
        </p>
        <div className="callout">
          <div className="callout-label">Group commit</div>
          <p>
            One <code>fsync</code> per document would cap throughput at a few
            hundred writes/second. Batched writes share a single fsync across the
            whole batch — that is what makes seeding 50,000 documents at{" "}
            ~1,025&nbsp;docs/s possible while staying crash-safe.
          </p>
        </div>
        <p className="muted">
          Verified, not asserted: a kill-9 durability harness fired four{" "}
          <code>SIGKILL</code>s at a running writer. All <b>2,520</b> acknowledged
          writes survived every crash with zero loss and zero corruption.
        </p>
      </Section>

      {/* 04 — Tokenizer */}
      <Section id="tokenizer" n="04" kicker="TEXT → TERMS" title="Tokenization & stemming">
        <p>
          Before indexing, every string and number field of a document is walked
          and reduced to normalized terms: lowercased, stripped of punctuation,
          filtered against a stopword list, and stemmed with rule-based suffix
          stripping so <code>indexing</code>, <code>indexed</code> and{" "}
          <code>indexes</code> collapse to one term.
        </p>
        <div className="eng-table-wrap">
          <table className="eng-table">
            <thead>
              <tr><th>Input</th><th>After tokenizing</th><th>Rule</th></tr>
            </thead>
            <tbody>
              <tr><td>&quot;The Storage-Engine&quot;</td><td>storage, engin</td><td>lowercase, split punctuation, drop stopword &quot;the&quot;, stem</td></tr>
              <tr><td>&quot;running quickly&quot;</td><td>run, quick</td><td>suffix stripping (-ning, -ly)</td></tr>
              <tr><td>&quot;recovery&quot;</td><td>recoveri</td><td>-y → -i so recover/recovery align</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Query text runs through the exact same pipeline, so a search for{" "}
          <code>Recovering</code> matches a document that said{" "}
          <code>recovery</code>. The tokenizer is the one component both the write
          and read paths must agree on.
        </p>
      </Section>

      {/* 05 — Inverted index */}
      <Section id="index" n="05" kicker="THE LOOKUP TABLE" title="Inverted index">
        <p>
          The index is a map from term to a posting list — the documents that
          contain it and how often. Alongside it sit the corpus statistics BM25
          needs: document frequency per term, each document&apos;s length, the
          average length, and the total count.
        </p>
        <pre className="ascii">{`  term          df     postings (docId → term frequency)
  ───────────────────────────────────────────────────────
  storage       49993  d1→3  d2→1  d7→5  …          ← common: low idf
  recoveri        842  d2→2  d9→1  …                 ← rarer:  high idf
  checksum        311  d4→1  d5→2  …

  corpus:  N = 50000 docs   avgdl ≈ 110 tokens`}</pre>
        <p>
          A query jumps straight to the posting lists of its terms — the only
          documents that can possibly match — instead of reading all 50,000. That
          single indirection is the whole reason search is fast; everything else
          is scoring.
        </p>
      </Section>

      {/* 06 — BM25 */}
      <Section id="bm25" n="06" kicker="RANKING" title="BM25, precisely">
        <p>
          Each candidate document is scored by summing a per-term contribution.
          A term contributes more when it is rare in the corpus (idf), when it
          appears often in the document (tf) — but with diminishing returns — and
          less when the document is simply long.
        </p>
        <div className="formula">{`score(D, Q) = Σ  idf(t) · [ f(t,D)·(k1+1) ] / [ f(t,D) + k1·(1 − b + b·|D|/avgdl) ]
              t∈Q

idf(t) = ln( (N − n(t) + 0.5) / (n(t) + 0.5) + 1 )`}</div>
        <div className="formula-legend">
          <span><b>f(t,D)</b> term frequency in D</span>
          <span><b>n(t)</b> docs containing t</span>
          <span><b>N</b> total docs</span>
          <span><b>|D|</b> length of D</span>
          <span><b>avgdl</b> average length</span>
          <span><b>k1 = 1.5</b> tf saturation</span>
          <span><b>b = 0.75</b> length normalization</span>
        </div>

        <h3>Why tf saturates (k1)</h3>
        <p>
          A word appearing 20 times does not make a document 20× more relevant.
          The <code>k1</code> term makes tf approach a ceiling of{" "}
          <code>k1 + 1 = 2.5</code>, so early occurrences matter and later ones
          barely move the needle.
        </p>
        <SaturationCurve />

        <h3>Why length matters (b)</h3>
        <p>
          A term appearing once in a 20-word note is a stronger signal than once
          in a 2,000-word essay. With <code>b = 0.75</code>, the denominator grows
          for documents longer than average and shrinks for shorter ones,
          normalizing the tf contribution by relative length.
        </p>

        <h3>A worked example</h3>
        <p className="muted">
          Corpus of <code>N = 50,000</code>, <code>avgdl ≈ 110</code>. Two query
          terms hitting a document of average length (so the length factor{" "}
          <code>1 − b + b·|D|/avgdl = 1</code>):
        </p>
        <div className="eng-table-wrap">
          <table className="eng-table">
            <thead>
              <tr><th>term</th><th>n(t)</th><th>idf</th><th>tf</th><th>saturated tf</th><th>contribution</th></tr>
            </thead>
            <tbody>
              <tr><td>storage</td><td>49,993</td><td>0.0002</td><td>3</td><td>1.667</td><td>0.0003</td></tr>
              <tr><td>checksum</td><td>311</td><td>4.98</td><td>2</td><td>1.429</td><td>7.12</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          The near-ubiquitous term <code>storage</code> contributes almost
          nothing; the rare <code>checksum</code> dominates the score. That is
          idf doing its job — and it is exactly what the &quot;why this ranked
          here&quot; table in the Search tab shows, per hit.
        </p>
      </Section>

      {/* 07 — Two-pass + heap */}
      <Section id="twopass" n="07" kicker="THE HOT PATH" title="Two passes and a bounded heap">
        <p>
          Computing a full score breakdown for every candidate is wasteful when a
          query returns the top 10. Ranking runs in two passes: first a cheap
          score for every candidate, selecting the top-N with a fixed-capacity
          min-heap; then the detailed per-term breakdown for only those N.
        </p>
        <div className="eng-table-wrap">
          <table className="eng-table">
            <thead>
              <tr><th>Approach</th><th>Work</th><th>Top-10 of 50k</th></tr>
            </thead>
            <tbody>
              <tr><td>sort all</td><td>score + full breakdown for every candidate, then sort</td><td>O(C log C), C breakdowns</td></tr>
              <tr><td>min-heap top-N</td><td>score every candidate, keep N in a heap, breakdown ×N</td><td>O(C log N), 10 breakdowns</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          The min-heap holds N entries; a candidate scoring below the heap&apos;s
          minimum is discarded in O(1). This is what cut the hot path from{" "}
          ~64&nbsp;ms to ~18&nbsp;ms at 50k documents.
        </p>
      </Section>

      {/* 08 — Ingestion */}
      <Section id="ingest" n="08" kicker="GETTING DATA IN" title="Ingestion adapters">
        <p>
          Everything indexable becomes a plain document with text fields — the
          adapters differ only in how they get there.
        </p>
        <h3>Files &amp; PDFs</h3>
        <p>
          Uploaded files stream to the server. PDFs are run through{" "}
          <code>unpdf</code> to extract real text (so a PDF indexes its words, not
          binary garbage). True binaries are detected — NUL bytes or a high ratio
          of control characters — and skipped with a reason rather than polluting
          the index.
        </p>
        <h3>GitHub</h3>
        <p>
          A username indexes every public repo (name, description, language,
          topics, stars, README); an <code>owner/repo</code> indexes just one.
          Deep mode also pulls source files via the git-tree and blob API.
          READMEs and blobs are fetched concurrently (8 in flight) to keep a
          large account from taking minutes. An optional token raises the rate
          limit from 60 to 5,000 requests/hour.
        </p>
        <h3>Wikipedia</h3>
        <p>
          The demo corpus loader calls the MediaWiki API&apos;s{" "}
          <code>generator=random</code> with intro extracts, ~20 articles per
          request, many requests concurrently, deduplicated by page id until the
          requested count of real articles is indexed — streaming progress back
          as it goes.
        </p>
      </Section>

      {/* 09 — Benchmark */}
      <Section id="benchmark" n="09" kicker="PROVING IT" title="Benchmark methodology">
        <p>
          The benchmark runs the <em>same</em> query two ways against the same
          corpus and confirms they agree on the top hit. The naive path reads and
          tokenizes every document on disk; the indexed path walks posting lists.
          Both compute identical BM25 scores — only the candidate-gathering
          differs.
        </p>
        <div className="eng-table-wrap">
          <table className="eng-table">
            <thead>
              <tr><th>query</th><th>indexed</th><th>naive</th><th>speedup</th><th>top hit</th></tr>
            </thead>
            <tbody>
              <tr><td>vector</td><td>5.98 ms</td><td>747.4 ms</td><td>125×</td><td>agrees</td></tr>
              <tr><td>storage index</td><td>17.41 ms</td><td>815.9 ms</td><td>47×</td><td>agrees</td></tr>
              <tr><td>crash recovery latency</td><td>20.61 ms</td><td>840.8 ms</td><td>41×</td><td>agrees</td></tr>
              <tr><td>checksum integrity corruption</td><td>15.47 ms</td><td>797.5 ms</td><td>52×</td><td>agrees</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          50,000 documents, 5-run average, measured locally. Run your own in the
          workspace&apos;s Benchmark tab against whatever you have indexed.
        </p>
      </Section>

      {/* 10 — API */}
      <Section id="api" n="10" kicker="THE SEAM" title="HTTP API surface">
        <p>
          The API is thin: parse input, call the engine, shape the response. No
          storage or ranking logic leaks into the routes.
        </p>
        <div className="eng-table-wrap">
          <table className="eng-table">
            <thead>
              <tr><th>endpoint</th><th>does</th></tr>
            </thead>
            <tbody>
              <tr><td>POST /documents</td><td>add one JSON document</td></tr>
              <tr><td>POST /documents/bulk</td><td>add an array of documents</td></tr>
              <tr><td>POST /documents/upload</td><td>multipart files → extract text → index</td></tr>
              <tr><td>POST /ingest/github</td><td>index a user or a single repo</td></tr>
              <tr><td>POST /ingest/wikipedia</td><td>stream-index N random articles (NDJSON progress)</td></tr>
              <tr><td>GET /search?q=</td><td>ranked hits + per-term BM25 breakdown</td></tr>
              <tr><td>GET /benchmark?q=</td><td>indexed vs naive, timed side by side</td></tr>
              <tr><td>GET /documents</td><td>paginated list with snippet previews</td></tr>
              <tr><td>GET /documents/:id</td><td>the full document (O(1) positioned read)</td></tr>
              <tr><td>DELETE /documents/:id</td><td>tombstone + de-index</td></tr>
              <tr><td>POST /reset</td><td>wipe the store</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* 11 — Sources */}
      <Section id="sources" n="11" kicker="REFERENCES" title="Sources & further reading">
        <ul>
          <li>
            Robertson &amp; Zaragoza,{" "}
            <a className="link" href="https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf" target="_blank" rel="noreferrer">
              The Probabilistic Relevance Framework: BM25 and Beyond
            </a>{" "}
            (2009) — the ranking function implemented here.
          </li>
          <li>
            <a className="link" href="https://fastify.dev/" target="_blank" rel="noreferrer">Fastify</a>{" "}
            — the HTTP layer; <a className="link" href="https://nextjs.org/" target="_blank" rel="noreferrer">Next.js</a> — this UI.
          </li>
          <li>
            <a className="link" href="https://github.com/unjs/unpdf" target="_blank" rel="noreferrer">unpdf</a>{" "}
            — PDF text extraction.
          </li>
          <li>
            <a className="link" href="https://www.mediawiki.org/wiki/API:Main_page" target="_blank" rel="noreferrer">MediaWiki API</a>{" "}
            — the Wikipedia corpus source.
          </li>
          <li>
            <a className="link" href="https://highlightjs.org/" target="_blank" rel="noreferrer">highlight.js</a> and{" "}
            <a className="link" href="https://marked.js.org/" target="_blank" rel="noreferrer">marked</a> — code and Markdown rendering on document pages.
          </li>
        </ul>
      </Section>

      <footer className="eng-footer">
        <span>shardly — built from first principles, no database, no search library</span>
        <Link href="/app">open the workspace →</Link>
      </footer>
    </div>
  );
}
