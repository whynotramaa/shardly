import Nav from "../components/nav";
import PartOne from "../components/part-one";
import PartTwo from "../components/part-two";
import { SECTIONS, Figure, Marks, Ticks, Microtext, Stat } from "../components/chrome";
import { SystemMap } from "../components/diagrams-storage";
import { Target, Scale } from "../components/lineart";
import Reveal from "../components/reveal";

export default function Page() {
  return (
    <>
      <Nav />
      <main id="top">
        {/* ======================================================== hero */}
        <header className="shell" style={{ paddingTop: 40, paddingBottom: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 24,
              flexWrap: "wrap",
              borderBottom: "1px solid var(--hair)",
              paddingBottom: 14,
            }}
          >
            <p className="label label-ac">
              Shardly · technical manual · edition 01
            </p>
            <p className="label">
              A document store with full-text search, built from nothing
            </p>
          </div>

          <div style={{ margin: "10px 0 34px" }}>
            <Microtext text="segment · offset · length · posting · term frequency · idf" times={10} />
          </div>

          <div className="cols" style={{ alignItems: "end" }}>
            <div className="c-8">
              <h1
                className="display d-xl"
                style={{ marginLeft: "-0.055em" }}
              >
                Two maps
                <br />
                do all the
                <br />
                <em className="italic ac">work.</em>
              </h1>
            </div>

            <div className="c-4" style={{ paddingBottom: "0.6em" }}>
              <div style={{ marginBottom: 30, marginLeft: -8, opacity: 0.9 }}>
                <Target size={150} />
              </div>
              <p className="lede">
                Shardly stores JSON documents on disk and searches them by
                relevance. No database, no Lucene, no search library. Around
                2,200 lines of TypeScript, and this page walks through all of
                it.
              </p>
              <p
                style={{
                  marginTop: 18,
                  fontSize: 14.5,
                  color: "var(--fg-2)",
                  maxWidth: "46ch",
                }}
              >
                Where a document&apos;s bytes live. Why a crash cannot lose an
                acknowledged write. How a word becomes a posting list. What BM25
                is really asking. And every place the design knowingly stops
                short.
              </p>
            </div>
          </div>

          <div style={{ margin: "40px 0 0" }}>
            <Ticks n={60} />
          </div>
        </header>

        {/* ================================================== stat band */}
        <div className="shell" style={{ marginTop: 34 }}>
          <div
            className="cut accent"
            style={{ position: "relative", padding: "38px clamp(20px,3vw,42px)" }}
          >
            <Marks />
            <div className="cols">
              {[
                ["2,211", "Lines of TypeScript"],
                ["0", "Storage or search dependencies"],
                ["125,719", "Acknowledged writes, 0 lost"],
                ["172×", "Best indexed-over-naive ratio"],
              ].map(([v, u]) => (
                <div className="c-3" key={u}>
                  <span className="stat">
                    <span className="v" style={{ color: "var(--on-accent)" }}>
                      {v}
                    </span>
                    <span className="u">{u}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* =================================================== the map */}
        <div className="shell" style={{ marginTop: 56 }}>
          <Reveal>
            <Figure
              n="00"
              cap="The whole system on one line. Intake normalizes anything into Document objects, the engine writes them twice (once durably, once searchably), and a query walks the index without touching the disk until it knows which documents to fetch."
            >
              <SystemMap />
            </Figure>
          </Reveal>
        </div>

        {/* ================================================== contents */}
        <div className="shell" style={{ marginTop: 64 }}>
          <div
            className="paper bleed"
            style={{ paddingBlock: "clamp(44px,5vw,76px)" }}
          >
          <div className="cols">
            <div className="c-4">
              <h2 className="display d-sm" style={{ marginBottom: 20 }}>
                How to read this
              </h2>
              <div className="prose">
                <p>
                  Top to bottom is the path a document takes. Sections 01 to 08
                  follow it onto the disk and prove it survives a crash.
                  Sections 09 to 13 follow it into the index and back out as a
                  ranked result. Sections 14 to 18 are the edges: how documents
                  get in, what the API promises, what everything costs, and
                  where the design stops.
                </p>
                <p>
                  Six sections carry a lab you can drive. They run the real
                  tokenizer and the real BM25 in your browser, ported without
                  changes, so nothing here shows a number the engine would not
                  produce.
                </p>
              </div>
            </div>

            <div className="c-8">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
                }}
                className="cellgrid chapters"
              >
                {SECTIONS.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    style={{
                      padding: "18px 18px 20px",
                      textDecoration: "none",
                      display: "block",
                    }}
                  >
                    <span className="label ch-n">{s.n}</span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 8,
                        fontSize: 15,
                        lineHeight: 1.25,
                      }}
                    >
                      {s.title}
                    </span>
                    <span
                      className="label"
                      style={{ display: "block", marginTop: 6 }}
                    >
                      {s.kicker}
                    </span>
                    <span className="ch-go" aria-hidden>
                      &#8594;
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>
          </div>

          <div style={{ marginTop: 48 }}>
            <Scale label="BEGIN · PART ONE" />
          </div>
        </div>

        {/* =================================================== content */}
        <div className="shell">
          <PartOne />
          <PartTwo />
        </div>

        {/* ==================================================== footer */}
        <footer className="foot">
          <div className="shell">
            <div className="cols" style={{ alignItems: "end" }}>
              <div className="c-7">
                <h2 className="display d-lg" style={{ marginLeft: "-0.04em" }}>
                  Read the
                  <br />
                  <em className="italic ac">source.</em>
                </h2>
              </div>
              <div className="c-5">
                <div className="prose" style={{ marginBottom: 26 }}>
                  <p>
                    Everything on this page points at a file you can open. The
                    storage layer is 447 lines. The ranker is 181. The tokenizer
                    is 60. That is the argument.
                  </p>
                </div>
                <pre className="code">
{`git clone <repo> shardly
cd shardly && npm install
npm run dev            `}<span className="c">{`# API on :3001`}</span>{`

npm test               `}<span className="c">{`# unit + API suite`}</span>{`
npm run seed           `}<span className="c">{`# 50,000 documents`}</span>{`
npm run bench          `}<span className="c">{`# your own numbers`}</span>{`
npm run crash-test     `}<span className="c">{`# repeated SIGKILL`}</span>{``}
                </pre>
              </div>
            </div>

            <div style={{ margin: "56px 0 34px" }}>
              <Ticks n={60} />
            </div>

            <div className="cols">
              <div className="c-3">
                <p className="label label-ac" style={{ marginBottom: 12 }}>
                  Colophon
                </p>
                <p className="label">
                  Set in Newsreader, Syne, and Geist Mono. Diagrams
                  are hand-written SVG. No charting library, no icon set, no UI
                  framework beyond React.
                </p>
              </div>
              <div className="c-3">
                <p className="label label-ac" style={{ marginBottom: 12 }}>
                  Companion documents
                </p>
                <p className="label">
                  README.md is what the system does and how to run it.
                  ENGINEERING.md is the argument behind it. This page is both,
                  drawn.
                </p>
              </div>
              <div className="c-3">
                <p className="label label-ac" style={{ marginBottom: 12 }}>
                  On the numbers
                </p>
                <p className="label">
                  Every measurement here came from a run on one machine. They
                  are results, not guarantees. Seed and bench on your own
                  hardware.
                </p>
              </div>
              <div className="c-3">
                <p className="label label-ac" style={{ marginBottom: 12 }}>
                  Scope
                </p>
                <p className="label">
                  Single process, single machine. No clustering, replication,
                  authentication, multi-tenancy, or SQL layer. On purpose.
                </p>
              </div>
            </div>

            <div style={{ marginTop: 44 }}>
              <Microtext
                text="shardly · offset index · write-ahead log · inverted index · bm25"
                times={8}
              />
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
