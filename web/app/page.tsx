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
    desc: "Every document is tokenized and folded into an in-memory inverted index ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â term ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ postings ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â with corpus statistics for BM25.",
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
          <Link href="/app" className="cta">
            Try it <span className="arrow">ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢</span>
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
          search back in milliseconds ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no database, no search library.
        </p>
        <div className="hero-cta-row">
          <Link href="/app" className="cta">
            Try it <span className="arrow">ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢</span>
          </Link>
          <span className="hero-cta-note">no signup Ãƒâ€šÃ‚Â· runs locally</span>
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

      {/* Benchmark ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â real measured numbers */}
      <section className="section" id="benchmark">
        <div className="section-label">
          Benchmark Ãƒâ€šÃ‚Â· query ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œvectorÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Ãƒâ€šÃ‚Â· 50,000 documents Ãƒâ€šÃ‚Â· 5-run average
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
            <div className="bench-num">125ÃƒÆ’Ã¢â‚¬â€</div>
            <div className="bench-cell-sub">identical BM25 top hit</div>
          </div>
        </div>
        <p className="bench-foot">
          Measured locally on this machine. Run it yourself against your own
          index in the workspace &rarr; Benchmark.
        </p>
      </section>

      <hr className="lp-rule" />

      {/* Architecture ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the signal path a query actually follows */}
      <section className="section" id="architecture">
        <div className="section-label">
          How it actually works Ãƒâ€šÃ‚Â· the signal path
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

      {/* Try it ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â live search */}
      <section className="section" id="tryit">
        <div className="section-label">Try it ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â search the live index</div>
        <TryItSearch />
      </section>

      <hr className="lp-rule" />

      <footer className="lp-footer">
        <span className="prompt">shardly ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â append-only storage Ãƒâ€šÃ‚Â· WAL recovery Ãƒâ€šÃ‚Â· BM25</span>
        <span style={{ display: "flex", gap: 20 }}>
          <Link href="/engineering">engineering deep-dive ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢</Link>
          <Link href="/app">open the workspace ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢</Link>
        </span>
      </footer>
    </div>
  );
}





