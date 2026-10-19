import Link from "next/link";
import IndexAnimation from "@/components/landing/IndexAnimation";
import SignalPath from "@/components/landing/SignalPath";
import TryItSearch from "@/components/landing/TryItSearch";
import ThemeToggle from "@/components/ThemeToggle";
import { Brand, Icon } from "@/components/ui";

export default function Landing() {
  return (
    <div className="landing">
      <header className="topbar">
        <div className="topbar-left"><Brand /></div>
        <nav className="topbar-right" aria-label="Site">
          <Link href="/engineering" className="nav-link hide-sm">engineering</Link>
          <ThemeToggle />
          <a className="button ink small hide-sm" href="https://github.com/whynotramaa/shardly" target="_blank" rel="noreferrer"><Icon name="github" size={14} />GitHub</a>
          <Link href="/app" className="button primary small">Open app<Icon name="arrow" size={14} /></Link>
        </nav>
      </header>

      <main>
        <section className="hero">
          <h1>Find the line you wrote six months ago.</h1>
          <p>Search documents and code on your machine. Get passages you can verify, with exact search, optional hybrid retrieval, and a read-only interface for your agent.</p>
          <TryItSearch />
          <IndexAnimation />
        </section>

        <section className="proof" aria-labelledby="proof-title">
          <p className="label">Historical synthetic benchmark · 50,000 documents · 5-run average</p>
          <h2 id="proof-title">An index makes the difference.</h2>
          <div className="race big">
            <div className="race-row"><span>Full scan</span><span className="race-track"><span className="race-bar slow" style={{ width: "100%" }} /></span><span className="mono">747.4 ms</span></div>
            <div className="race-row"><span>Shardly</span><span className="race-track"><span className="race-bar" style={{ width: "1.5%" }} /></span><span className="mono">5.98 ms</span></div>
          </div>
          <p className="hint">One recorded workload, not a latency guarantee. Indexed lexical search and full scan returned the same top hit. Literal search uses a bounded scan. Run the benchmark on your own index from Engine.</p>
        </section>

        <section className="signal-section" aria-labelledby="signal-title">
          <p className="label" id="signal-title">The signal path a query follows</p>
          <SignalPath />
          <p className="hint">Each stage in depth: <Link href="/engineering" className="text-link">the engineering guide</Link>.</p>
        </section>
        <section className="signal-section" aria-labelledby="agent-title">
          <h2 id="agent-title">Give your agent evidence it can check.</h2>
          <p>Search returns original-text passages and versioned references. Fetch checks that the document still matches. Byte budgets keep context bounded; read scopes keep private documents out of results.</p>
          <p className="hint">Run <code>npm run mcp</code> alongside the API to connect a compatible agent. Configure optional embeddings and reranking from your own inference endpoint; lexical search works without a model.</p>
          <Link href="/app?view=engine" className="text-link">Configure your workspace</Link>
        </section>
      </main>

      <footer className="site-foot">
        <Brand />
        <span className="hint mono">append-only storage · WAL recovery · BM25</span>
        <Link href="/app" className="text-button">Open app<Icon name="arrow" size={14} /></Link>
      </footer>
    </div>
  );
}
