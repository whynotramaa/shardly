import Link from "next/link";
import IndexAnimation from "@/components/landing/IndexAnimation";
import SignalPath from "@/components/landing/SignalPath";
import TryItSearch from "@/components/landing/TryItSearch";
import ThemeToggle from "@/components/ThemeToggle";

/* Thin single-weight line icons for the pipeline (no fills). */
function IconUpload() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M12 15V3M12 3l-4 4M12 3l4 4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}
function IconIndex() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 9h18M9 9v11M3 14h6" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5" />
    </svg>
  );
}

const STEPS = [
  {
    n: "01",
    icon: <IconUpload />,
    title: "Upload",
    desc: "Drop files, PDFs, or point at a whole GitHub account. Text is extracted and written to an append-only segment log.",
  },
  {
    n: "02",
    icon: <IconIndex />,
    title: "Index",
    desc: "Every document is tokenized and folded into an in-memory inverted index — term → postings — with corpus statistics for BM25.",
  },
  {
    n: "03",
    icon: <IconSearch />,
    title: "Search",
    desc: "Query terms jump straight to their posting lists. Ranked BM25 results come back in single-digit milliseconds.",
  },
];

export default function Landing() {
  return (
    <div className="lp">
      {/* Nav */}
      <nav className="nav">
        <span className="nav-brand">
          Shardly<span className="dot">.</span>
        </span>
        <div className="nav-links">
          <a href="#how" className="hide-sm">how</a>
          <a href="#benchmark" className="hide-sm">benchmark</a>
          <Link href="/engineering" className="hide-sm">engineering</Link>
          <ThemeToggle />
          <a
            className="gh"
            href="https://github.com/whynotramaa/shardly"
            target="_blank"
            rel="noreferrer"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            GitHub
          </a>
          <Link href="/app" className="cta">
            Try it <span className="arrow">→</span>
          </Link>
        </div>
      </nav>

      <hr className="lp-rule" />

      {/* Hero */}
      <header className="hero">
        <span className="eyebrow">A document store that searches itself</span>
        <h1 className="display hero-head">
          Find the line you wrote six months ago.
        </h1>
        <p className="hero-sub">
          Upload your own documents or a GitHub repository. Shardly stores them
          in a hand-rolled, crash-safe engine and gives you ranked full-text
          search back in milliseconds — no database, no search library.
        </p>
        <div className="hero-cta-row">
          <Link href="/app" className="cta">
            Try it <span className="arrow">→</span>
          </Link>
          <span className="hero-cta-note">no signup · runs locally</span>
        </div>

        <IndexAnimation />
      </header>

      <hr className="lp-rule" />

      {/* Pipeline */}
      <section className="section" id="how">
        <div className="section-label">The path a document takes</div>
        <div className="pipeline">
          {STEPS.map((s, i) => (
            <div className="pipe-step" key={s.n}>
              <div className="pipe-num">{s.n}</div>
              <div className="pipe-node">
                <span className="pipe-dot" />
                {i < STEPS.length - 1 && <span className="pipe-connector" />}
              </div>
              <div className="pipe-icon">{s.icon}</div>
              <h3 className="pipe-title">{s.title}</h3>
              <p className="pipe-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="lp-rule" />

      {/* Benchmark — real measured numbers */}
      <section className="section" id="benchmark">
        <div className="section-label">
          Benchmark · query “vector” · 50,000 documents · 5-run average
        </div>
        <div className="bench-grid">
          <div className="bench-cell">
            <div className="bench-cell-label">Naive scan</div>
            <div className="bench-num">
              747.4<span className="bench-unit">ms</span>
            </div>
            <div className="bench-cell-sub">reads + tokenizes all 50,000</div>
          </div>
          <div className="bench-cell">
            <div className="bench-cell-label">Inverted index</div>
            <div className="bench-num accent">
              5.98<span className="bench-unit">ms</span>
            </div>
            <div className="bench-cell-sub">jumps to the posting lists</div>
          </div>
          <div className="bench-cell">
            <div className="bench-cell-label">Speedup</div>
            <div className="bench-num">125×</div>
            <div className="bench-cell-sub">identical BM25 top hit</div>
          </div>
        </div>
        <p className="bench-foot">
          Measured locally on this machine. Run it yourself against your own
          index in the workspace &rarr; Benchmark.
        </p>
      </section>

      <hr className="lp-rule" />

      {/* Architecture — the signal path a query actually follows */}
      <section className="section" id="architecture">
        <div className="section-label">
          How it actually works · the signal path
        </div>
        <SignalPath />
        <p className="bench-foot">
          Same four stages every query walks. See each one in depth in the{" "}
          <Link href="/engineering" style={{ color: "var(--ember)" }}>
            engineering deep-dive
          </Link>
          .
        </p>
      </section>

      <hr className="lp-rule" />

      {/* Try it — live search */}
      <section className="section" id="tryit">
        <div className="section-label">Try it — search the live index</div>
        <TryItSearch />
      </section>

      <hr className="lp-rule" />

      <footer className="lp-footer">
        <span className="prompt">shardly — append-only storage · WAL recovery · BM25</span>
        <span style={{ display: "flex", gap: 20 }}>
          <Link href="/engineering">engineering deep-dive →</Link>
          <Link href="/app">open the workspace →</Link>
        </span>
      </footer>
    </div>
  );
}
