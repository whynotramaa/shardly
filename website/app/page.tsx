import Nav from "../components/nav";
import PartOne from "../components/part-one";
import PartTwo from "../components/part-two";
import { REPO, appUrl, source } from "../lib/facts";

export default function Page() {
  return <>
    <a className="skip-link" href="#guide">Skip to the guide</a>
    <Nav />
    <main id="top" className="manual">
      <header className="guide-hero shell">
        <div className="hero-copy"><h1>How a document becomes <em>searchable.</em></h1>
          <p>Shardly stores documents on disk, searches their text, and returns evidence tied to the current source. Its storage and lexical search engine are written in TypeScript. The API, file parsers, and workspace use supporting libraries.</p>
          <p>This guide follows one document from extraction to a verified quote. You can inspect the write protocol, change the search inputs, and see where the design stops.</p>
          <div className="hero-actions"><a href="#ingest">Follow the document <span aria-hidden>↓</span></a><a href={appUrl}>Open the workspace <span aria-hidden>↗</span></a></div>
        </div>
        <div className="intro-mark" aria-hidden="true"><svg viewBox="0 0 120 130"><path d="M20 9H78L96 27V116H20Z" className="scene-plate"/><path d="M78 9V27H96M33 43H81M33 55H72M33 67H81M33 93H68" className="scene-detail"/><rect x="30" y="73" width="53" height="9" className="scene-fill"/></svg></div>
      </header>
      <div className="guide-layout shell" id="guide">
        <article className="guide-article"><PartOne /><PartTwo /></article>
      </div>
      <footer className="guide-footer shell"><h2>Read it. Run it. Check it.</h2>
        <div className="footer-columns"><div><p>The same path connects the system: extract text, commit records, build postings, rank candidates, and verify the source revision before returning evidence.</p><p>Run the project with a supported Node version from <a href={source("package.json")}>package.json</a>. These commands start the API. The workspace and this guide have separate Next.js development servers.</p>
          <pre><code>{`git clone ${REPO}.git\ncd shardly\nnpm install\nnpm test\nnpm run dev\n\n# In another terminal, start the workspace\ncd web && npm install && npm run dev`}</code></pre></div>
          <div className="further-reading"><h3>Continue in the source</h3><a href={source("README.md")}>README <span>Setup, commands, and supported workflows.</span></a><a href={source("ENGINEERING.md")}>Engineering notes <span>Implementation decisions and storage mechanics.</span></a><a href={source("VERIFICATION.md")}>Verification <span>Recorded checks, methodology, and unresolved limits.</span></a><a href={source("IMPLEMENTATION.md")}>Implementation status <span>What shipped and what still needs work.</span></a><a href={source("SEARCH_RESEARCH.md")}>Retrieval research <span>Alternatives considered and the work they imply.</span></a></div>
        </div>
        <div className="colophon"><a href="#top">Shardly / engineering</a><span>Coconat · Syne · Geist Mono · original SVG diagrams</span><a href={REPO}>View repository ↗</a></div>
      </footer>
    </main>
  </>;
}
