import { Section, Head, Figure, Marks, SECTIONS, Stat } from "./chrome";
import {
  TokenLoss,
  DeleteCost,
  Bm25Anatomy,
  TwoPasses,
  IngestContract,
} from "./diagrams-search";
import { Scale, Triangulation, ArcStack } from "./lineart";
import Reveal from "./reveal";
import LabTokenizer from "./lab-tokenizer";
import LabIndex from "./lab-index";
import LabBm25 from "./lab-bm25";
import LabBench from "./lab-bench";

const S = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

const ROUTES: Array<[string, string, string]> = [
  ["GET", "/health", "Liveness check"],
  ["GET", "/stats", "Live document count"],
  ["POST", "/documents", "Add one JSON document"],
  ["POST", "/documents/bulk", "Add an array of documents through writeBatch()"],
  ["POST", "/documents/upload", "Multipart text, code, JSON, NDJSON, and PDF"],
  ["POST", "/ingest/github", "Index a user or repository, optionally deep"],
  ["GET", "/corpus/wikipedia/status", "Bundled count against indexed count"],
  ["POST", "/corpus/wikipedia/index", "Stream indexing progress as NDJSON"],
  ["POST", "/corpus/wikipedia/deindex", "Remove the articles, keep the file"],
  ["GET", "/documents", "Paginated list with truncated previews"],
  ["GET", "/documents/:id", "Full document, never truncated"],
  ["DELETE", "/documents/:id", "Tombstone and de-index"],
  ["GET", "/search", "Ranked hits with snippets and BM25 breakdowns"],
  ["GET", "/benchmark", "Indexed and naive timings plus top-hit agreement"],
  ["POST", "/compact", "Rewrite segments, drop tombstoned records"],
  ["POST", "/reset", "Clear the store and the index"],
];

const COSTS: Array<[string, string, string]> = [
  ["write(doc)", "O(1) work, 3 fsync", "fsync latency, nothing else"],
  ["writeBatch(docs)", "O(k) work, 3 fsync total", "Disk bandwidth"],
  ["read(id)", "O(1), one readSync", "OS page cache"],
  ["delete(id)", "O(terms in that document)", "Document size, not corpus size"],
  ["search(q, limit)", "O(Σ postings of query terms + n log k)", "How common the query words are"],
  ["naiveSearch(q)", "O(corpus bytes), re-tokenized every call", "CPU, then disk"],
  ["compact()", "O(live records)", "Disk bandwidth"],
  ["startup, snapshot valid", "O(offset entries), JSON.parse", "Parsing JSON"],
  ["startup, snapshot stale", "O(corpus), full re-tokenize", "CPU"],
];

const LUCENE: Array<[string, string, string]> = [
  ["Posting storage", "Plain JS objects on the heap", "Delta and variable-byte encoded blocks on disk"],
  ["Skipping", "None. Walk the whole list.", "Skip lists over posting blocks"],
  ["Term dictionary", "A JavaScript Map", "A finite state transducer, prefix-compressed, memory-mapped"],
  ["Positions", "Not stored", "Positions, offsets, and payloads per posting"],
  ["Query language", "Bag of words", "Boolean, phrase, span, fuzzy, wildcard, function score"],
  ["Segments", "Append log plus manual compaction", "Immutable segments plus a tiered merge policy"],
  ["Deletes", "A flag in the offset map", "A deleted-docs bitset per segment"],
  ["Durability", "WAL, fsync per write or per batch", "Translog, with refresh and flush phases"],
  ["Concurrency", "One process, synchronous I/O", "Lock-free readers over immutable segments"],
  ["Scale-out", "None", "Shards, replicas, a coordinator, a cluster state"],
];

export default function PartTwo() {
  return (
    <>
      {/* ============================================================ 09 */}
      <Section meta={S.token!}>
        <Head
          title={
            <>
              A tokenizer is a{" "}
              <em className="italic ac">controlled loss</em> of information
            </>
          }
          lede="Four stages, and every one of them throws something away on purpose. The useful question is not whether it loses information. It is which information, and what that costs you."
        />

        <Reveal>
          <Figure
            n="09.1"
            cap="Each stage with its input, its output, and the thing it can no longer distinguish afterwards."
          >
            <TokenLoss />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-4">
            <div className="prose">
              <h4>The character class is ASCII-only</h4>
              <p>
                <code>/[^a-z0-9\s]+/g</code> runs after{" "}
                <code>toLowerCase()</code>, so every character outside{" "}
                <code>a-z0-9</code> becomes a separator.{" "}
                <code>tokenize(&quot;Zürich café&quot;)</code> gives{" "}
                <code>[&quot;z&quot;, &quot;rich&quot;, &quot;caf&quot;]</code>.{" "}
                <code>tokenize(&quot;東京 検索&quot;)</code> gives an empty
                array.
              </p>
              <p>
                Non-English text is not ranked poorly. It is unindexable. For
                the bundled English corpus this never shows up, which is exactly
                why it is worth writing down.
              </p>
            </div>
          </div>
          <div className="c-4">
            <div className="prose">
              <h4>The stemmer over-stems and under-stems</h4>
              <p>
                Six suffix rules, not Porter.{" "}
                <code>stem(&quot;cares&quot;)</code> returns{" "}
                <code>&quot;car&quot;</code>, colliding with the actual word{" "}
                <code>car</code>, so a query for cars matches documents about
                caring. That is over-stemming.
              </p>
              <p>
                Meanwhile <code>stem(&quot;running&quot;)</code> gives{" "}
                <code>&quot;runn&quot;</code> and{" "}
                <code>stem(&quot;runs&quot;)</code> gives{" "}
                <code>&quot;run&quot;</code>, so two forms of one verb never
                meet. That is under-stemming, and it is a plain defect rather
                than a trade-off. Porter handles it with a doubled-consonant
                rule.
              </p>
            </div>
          </div>
          <div className="c-4">
            <div className="prose">
              <h4>Why keep it anyway</h4>
              <p>
                It is a dozen lines you can read in full and reason about, and
                swapping in Porter is a contained change to one function that
                already has tests around it.
              </p>
              <p>
                The reason to write the failures down is simpler. A stemmer
                nobody has measured is a stemmer everyone trusts too much.
              </p>
              <h4>Symmetry saves it</h4>
              <p>
                Query text and document text go through the identical function.
                A collision costs precision on both sides evenly instead of
                breaking recall in one direction, which is the difference
                between a blunt tool and a broken one.
              </p>
            </div>
          </div>
        </div>

        <Reveal>
          <div style={{ marginTop: 48 }}>
            <LabTokenizer />
          </div>
        </Reveal>
      </Section>

      {/* ============================================================ 10 */}
      <Section meta={S.index!}>
        <Head
          title={
            <>
              Four maps, and the{" "}
              <em className="italic">interesting one</em> exists only for delete
            </>
          }
          lede="index, docFreq, and docLengths are what BM25 needs. docTerms is what keeps deletion from scaling with the size of the corpus."
        />

        <div className="cols">
          <div className="c-7">
            <div className="prose">
              <p>
                Removing a document means removing it from every posting list it
                appears in. The obvious way is to walk the whole index and
                filter each list. It is correct, it passes every unit test, and
                it costs O(vocabulary) per delete while allocating a replacement
                array for every term in the corpus, whether or not the document
                touched it.
              </p>
              <p>
                <code>docTerms</code> maps a document id to the distinct terms
                it contributed. The loop becomes O(terms in this document). The
                gap widens as the vocabulary grows, which is the direction real
                corpora go.
              </p>
              <p>
                <code>docTerms</code> is not in the snapshot format.{" "}
                <code>load()</code> rebuilds it by walking the postings once,
                which costs one pass over data already being parsed and keeps
                old snapshots readable. Deriving beats storing when the
                derivation is cheaper than the format change.
              </p>
              <p>
                The memory cost is one array of string references per document.
                The strings are the same objects already used as keys in{" "}
                <code>index</code>, so this is pointers, not text.
              </p>
            </div>
          </div>
          <div className="c-5">
            <div className="cut panel panel-2" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 18 }}>
                The four maps
              </p>
              <dl className="dl" style={{ margin: 0 }}>
                <div className="dl-row">
                  <dt>index</dt>
                  <dd>term → postings. The index itself.</dd>
                </div>
                <div className="dl-row">
                  <dt>docFreq</dt>
                  <dd>term → document count. IDF&apos;s n.</dd>
                </div>
                <div className="dl-row">
                  <dt>docLengths</dt>
                  <dd>docId → token count. BM25&apos;s |D|.</dd>
                </div>
                <div className="dl-row">
                  <dt>docTerms</dt>
                  <dd style={{ color: "var(--accent)" }}>
                    docId → its distinct terms. Delete only.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>totalTokens</dt>
                  <dd>
                    A running sum, so averageDocumentLength() is O(1) instead of
                    a scan.
                  </dd>
                </div>
              </dl>
              <hr className="dot-rule" style={{ margin: "22px 0 18px" }} />
              <p className="label">
                addDocument() calls removeDocument() first when the id is
                already known. Without that, re-adding an id would leave two
                postings for one document and double its score.
              </p>
              <div style={{ marginTop: 22, opacity: 0.7 }}>
                <Triangulation />
              </div>
            </div>
          </div>
        </div>

        <Reveal>
          <div style={{ marginTop: 48 }}>
            <Figure
              n="10.1"
              cap="Delete cost before and after docTerms, with the two corpora it was measured on."
            >
              <DeleteCost />
            </Figure>
          </div>
        </Reveal>

        <Reveal>
          <div style={{ marginTop: 48 }}>
            <LabIndex />
          </div>
        </Reveal>
      </Section>

      {/* ============================================================ 11 */}
      <Section meta={S.bm25!}>
        <Head
          title={
            <>
              BM25 asks three questions and{" "}
              <em className="italic ac">multiplies the answers</em>
            </>
          }
          lede="How surprising is this word? Do repeats keep helping? Is this document long, or is it thorough? Every part of the formula is one of those three."
        />

        <Reveal>
          <Figure
            n="11.1"
            tone="paper"
            cap="The formula with each region traced to the question it answers. k1 = 1.5 and b = 0.75 are the standard defaults, set in src/config.ts."
          >
            <Bm25Anatomy />
          </Figure>
        </Reveal>

        <Reveal>
          <div style={{ marginTop: 48 }}>
            <LabBm25 />
          </div>
        </Reveal>

        <div className="cols" style={{ marginTop: 48 }}>
          <div className="c-8">
            <div className="prose">
              <h4>The test that pins the middle setting</h4>
              <p>
                A ranker that punishes length is as broken as one that rewards
                it. <code>tests/rank.test.ts</code> covers both ends: a short
                document beats an over-long one at equal term frequency, and a
                genuinely more relevant long document still wins when it earns
                it. The second test is the one that catches an over-eager{" "}
                <code>b</code>.
              </p>
              <h4>Why every hit carries a breakdown</h4>
              <p>
                Each result includes a <code>TermScore[]</code> with the term,
                its frequency in that document, its IDF, and its contribution,
                sorted by contribution. A test asserts the contributions sum to
                the total.
              </p>
              <p>
                That is what lets an interface answer &quot;why did this rank
                here&quot; instead of showing a number nobody can check. A
                relevance score you cannot decompose is a relevance score you
                cannot debug.
              </p>
            </div>
          </div>
          <div className="c-4">
            <div className="cut panel" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 16 }}>
                Constants
              </p>
              <dl className="dl" style={{ margin: 0 }}>
                <div className="dl-row">
                  <dt>k1</dt>
                  <dd className="mono">1.5</dd>
                </div>
                <div className="dl-row">
                  <dt>b</dt>
                  <dd className="mono">0.75</dd>
                </div>
                <div className="dl-row">
                  <dt>Overridable</dt>
                  <dd>Yes, through RankOptions, so tests can pin them.</dd>
                </div>
              </dl>
              <div style={{ marginTop: 26, opacity: 0.75 }}>
                <ArcStack />
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 12 */}
      <Section meta={S.topn!}>
        <Head
          title={
            <>
              Score in one pass,{" "}
              <em className="italic">explain in another</em>
            </>
          }
          lede="Building a result object for every candidate would allocate for every document that matched any term. The answer is ten of them."
        />

        <Reveal>
          <Figure
            n="12.1"
            cap="Numbers only, then a bounded heap, then breakdowns for the winners. Each stage exists to stop the next one from doing work it does not need."
          >
            <TwoPasses />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-6">
            <div className="prose">
              <h4>The version that was replaced</h4>
              <p>
                The first implementation looked up each winner&apos;s term
                frequency by searching that term&apos;s posting list, once per
                winner. On a term appearing in 20,000 documents with a limit of
                10, it re-scanned 20,000 postings ten times to recover ten
                numbers.
              </p>
              <p>
                It now walks each term&apos;s postings once, filling a{" "}
                <code>Map&lt;docId, Map&lt;term, tf&gt;&gt;</code> keyed by a{" "}
                <code>Set</code> of winner ids. The work drops to O(terms ×
                postings) no matter what the limit is.
              </p>
            </div>
          </div>
          <div className="c-6">
            <div className="prose">
              <h4>total counts matches, not results</h4>
              <p>
                <code>total</code> reports every document matching at least one
                query term, which is <code>scores.size</code>, not the size of
                the returned page. Reporting the page size would make every
                search look like it found exactly ten things, and pagination
                would have nothing to paginate.
              </p>
              <h4>When the heap steps aside</h4>
              <p>
                If <code>limit</code> is <code>Infinity</code> or larger than
                the candidate count, <code>selectTopN()</code> sorts everything
                instead. A heap cannot beat a sort when you want the whole list,
                and pretending otherwise is how you end up with a slower
                &quot;optimized&quot; path.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 13 */}
      <Section meta={S.bench!}>
        <Head
          title={
            <>
              A search engine that cannot show its own speedup is{" "}
              <em className="italic ac">a claim, not a result</em>
            </>
          }
          lede="So Shardly ships the slow path too, runs both on the same corpus with the same constants, and checks that they agree on the winner."
        />

        <Reveal>
          <LabBench />
        </Reveal>

        <div className="cols" style={{ marginTop: 48 }}>
          <div className="c-6">
            <div className="prose">
              <h4>What the comparison is worth</h4>
              <p>
                Both sides compute BM25 over the same documents with the same{" "}
                <code>k1</code> and <code>b</code>, and{" "}
                <code>topHitsMatch</code> verifies the fast path returns the
                same answer as the slow one. A speedup with a different answer
                is a bug report, not a benchmark.
              </p>
              <h4>Where the number is soft</h4>
              <p>
                <code>speedup</code> divides by{" "}
                <code>Math.max(indexed.tookMs, 1e-6)</code>. On a small corpus
                where the indexed path finishes in microseconds, that ratio is
                measuring timer resolution as much as anything. Treat the
                ordering as real and the exact multiplier as approximate.
              </p>
              <p>
                These are local measurements on one machine, not a performance
                guarantee. Run <code>npm run seed</code> and{" "}
                <code>npm run bench</code> on your own hardware for numbers that
                mean something to you.
              </p>
            </div>
          </div>
          <div className="c-6">
            <div className="cut panel panel-2" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 18 }}>
                What each column contains
              </p>
              <dl className="dl" style={{ margin: 0 }}>
                <div className="dl-row">
                  <dt>Indexed</dt>
                  <dd>
                    Tokenize the query, union the posting lists, score the
                    candidates, seek the top ten. The index is already built.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>Unindexed</dt>
                  <dd>
                    Read every document from disk, tokenize it, compute document
                    frequencies, score the corpus. Every single call.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>Not measured</dt>
                  <dd style={{ color: "var(--accent)" }}>
                    Index build time. It is paid once at ingest and appears in
                    neither column.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>Missing third column</dt>
                  <dd>
                    A linear scan over pre-tokenized data. It would land between
                    the two, and it is the honest comparison nobody publishes.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 14 */}
      <Section meta={S.ingest!}>
        <Head
          title={
            <>
              Three sources,{" "}
              <em className="italic">one function signature</em>
            </>
          }
          lede="Every adapter returns plain Document objects and hands them to Engine.addDocuments(). None of them knows segments, the log, or the index exist."
        />

        <Reveal>
          <Figure
            n="14.1"
            cap="The contract is the whole integration story. Adding a fourth source touches one file and changes nothing downstream."
          >
            <IngestContract />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-4">
            <div className="prose">
              <h4>Detecting binary before decoding it</h4>
              <p>
                Files with an unrecognized extension get checked first.{" "}
                <code>isProbablyBinary()</code> reads the first 8 KiB and
                returns true on any NUL byte. Otherwise it flags files where
                more than 30% of bytes are C0 control characters outside tab,
                newline, and carriage return.
              </p>
              <p>
                A NUL byte is conclusive. The 30% threshold is a heuristic,
                tuned to let odd-but-real text through while rejecting compiled
                output. Extensions on the <code>TEXT_EXTENSIONS</code> list skip
                the check entirely, because a <code>.ts</code> file is text even
                if it opens with something strange.
              </p>
            </div>
          </div>
          <div className="c-4">
            <div className="prose">
              <h4>A PDF with no text is reported, not indexed</h4>
              <p>
                PDFs go through <code>unpdf</code>. If extraction yields
                nothing, the file is returned as skipped with a reason rather
                than stored as an empty document.
              </p>
              <p>
                A scanned page that silently produces zero tokens is precisely
                the thing you want to see in the response. Indexing it as an
                empty document hides the problem and pollutes{" "}
                <code>avgdl</code> at the same time.
              </p>
              <h4>Malformed NDJSON lines are skipped, not fatal</h4>
              <p>
                One bad line in a 200,000-line dump should not reject the dump.
                Same reasoning as the torn WAL tail.
              </p>
            </div>
          </div>
          <div className="c-4">
            <div className="prose">
              <h4>Politeness is a feature of the GitHub adapter</h4>
              <p>
                Concurrency runs through <code>mapLimit()</code>, an
                eighteen-line worker pool.{" "}
                <code>Promise.all</code> over every file would open hundreds of
                sockets and trip the rate limiter on the first repository. Caps
                on repositories, files per repository, total files, and file
                size are parameters with defaults, so the HTTP route holds a
                fixed policy while tests pick their own.
              </p>
              <h4>Progress is streamed, not awaited</h4>
              <p>
                <code>POST /corpus/wikipedia/index</code> streams NDJSON
                progress events as it works. A request that returns after 2,386
                documents tells the user nothing for the whole duration. The
                streaming version is about twenty lines.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 15 */}
      <Section meta={S.http!}>
        <Head
          title={
            <>
              The HTTP layer stays thin so the{" "}
              <em className="italic">engine stays testable</em>
            </>
          }
          lede="routes.ts validates input, shapes output, and calls Engine. Engine has no idea Fastify exists."
        />

        <div className="cols">
          <div className="c-7">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Route</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {ROUTES.map(([m, r, p]) => (
                    <tr key={r + m}>
                      <td className="mono" style={{ color: "var(--accent)", fontSize: 11 }}>
                        {m}
                      </td>
                      <td>
                        <code>{r}</code>
                      </td>
                      <td>{p}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="c-5">
            <div className="prose">
              <h4>previewDoc() had to learn to recurse</h4>
              <p>
                <code>GET /documents</code> and <code>GET /search</code> trim
                string values to 280 characters and set{" "}
                <code>_truncated</code>. The first version only walked top-level
                keys.
              </p>
              <p>
                A nested <code>{"{content: {body: \"…\"}}"}</code> from a deep
                GitHub index shipped whole, so responses ran to megabytes while{" "}
                <code>_truncated</code> was absent, which is the worst possible
                combination: wrong data and a flag saying it is fine. It now
                recurses through objects and arrays.{" "}
                <code>GET /documents/:id</code> still returns the full document,
                because that is the detail view.
              </p>
              <h4>parseLimit() clamps rather than trying</h4>
              <p>
                Unparseable or non-positive values fall back to the default, and
                everything is capped. A client asking for{" "}
                <code>limit=100000000</code> gets the cap, not an attempt and a
                heap crash.
              </p>
              <h4>buildServer() returns the engine too</h4>
              <p>
                Tests need the handle. Production needs the{" "}
                <code>onClose</code> hook that snapshots and closes descriptors.
                Both <code>SIGINT</code> and <code>SIGTERM</code> route through{" "}
                <code>app.close()</code>, so a container stop is a clean
                shutdown rather than a recovery on next boot.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 16 */}
      <Section meta={S.cost!} tone="paper">
        <Head
          title={
            <>
              The cost of{" "}
              <em className="italic ac">everything</em>
            </>
          }
          lede="One table for time, one for memory. Both are honest about what dominates in practice, which is rarely the term in the big-O."
        />

        <div className="cols">
          <div className="c-7">
            <p className="label" style={{ marginBottom: 16 }}>
              Time · n is candidate count, k is the result limit
            </p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Cost</th>
                    <th>What actually dominates</th>
                  </tr>
                </thead>
                <tbody>
                  {COSTS.map(([op, cost, dom]) => (
                    <tr key={op}>
                      <td>
                        <code>{op}</code>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {cost}
                      </td>
                      <td>{dom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="c-5">
            <div
              className="cut"
              style={{
                position: "relative",
                padding: "clamp(18px,2.2vw,30px)",
                background: "rgba(22,21,15,0.045)",
                borderColor: "rgba(22,21,15,0.28)",
              }}
            >
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 16 }}>
                Memory · rough, and rough on purpose
              </p>
              <div className="prose">
                <p>
                  V8 does not promise an object layout, so these are estimates
                  from typical heap snapshots rather than guarantees. They are
                  still the right order of magnitude, and the order of magnitude
                  is the point.
                </p>
              </div>
              <dl className="dl" style={{ margin: "20px 0 0" }}>
                <div className="dl-row">
                  <dt>Offset entry</dt>
                  <dd>
                    A 36-character UUID key plus a four-field object. Call it
                    180 bytes per document.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>1M documents</dt>
                  <dd style={{ color: "var(--accent)" }}>
                    Roughly 180 MB of heap before a single posting exists.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>One posting</dt>
                  <dd>
                    <code style={{ color: "var(--accent-hi)" }}>{"{ docId, termFrequency }"}</code> is
                    about 50 bytes, counting the shared string pointer.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>A 200-token doc</dt>
                  <dd>
                    Around 120 distinct terms, so roughly 6 KB of postings.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>Therefore</dt>
                  <dd>
                    A million such documents is several gigabytes of postings
                    alone. This is the ceiling, and it is a heap ceiling, not a
                    disk one.
                  </dd>
                </div>
              </dl>
              <hr className="dot-rule" style={{ margin: "22px 0 16px" }} />
              <p className="label">
                Lucene stores the same information as delta-encoded integers in
                memory-mapped blocks. That is not an optimization detail, it is
                the difference between a corpus that fits and one that does not.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 17 */}
      <Section meta={S.lucene!}>
        <Head
          title={
            <>
              What a real engine does{" "}
              <em className="italic">that this one does not</em>
            </>
          }
          lede="Shardly and Lucene solve the same problem with the same shapes. The difference is everywhere in the second column, and naming it is more useful than pretending the gap is small."
        />

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Concern</th>
                <th style={{ width: "36%" }}>Shardly</th>
                <th>Lucene, and Elasticsearch on top of it</th>
              </tr>
            </thead>
            <tbody>
              {LUCENE.map(([c, s, l]) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td style={{ color: "var(--accent)" }}>{s}</td>
                  <td>{l}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-6">
            <div className="prose">
              <h4>The structures are the same, which is the whole point</h4>
              <p>
                An inverted index is an inverted index whether the postings are
                JavaScript objects or variable-byte integers in a mapped file.
                BM25 is BM25 whether you compute it in TypeScript or in a JIT
                that has been tuned for twenty years. Segments are immutable and
                merged in both systems, and both put a durable log in front of
                the data.
              </p>
              <p>
                Every row in that table is an engineering answer to a scale
                Shardly does not operate at. Skip lists matter when a posting
                list has ten million entries. A finite state transducer for the
                term dictionary matters when the vocabulary does not fit in
                memory. Positions matter the moment somebody types a phrase in
                quotes.
              </p>
            </div>
          </div>
          <div className="c-6">
            <div className="prose">
              <h4>What you get for reading this one instead</h4>
              <p>
                You can read all of Shardly in an afternoon and hold it in your
                head afterwards. Every constant is in one file. Every fsync is
                on a line you can point at. When a search returns the wrong
                document, you can decompose the score term by term and find out
                why.
              </p>
              <p>
                That is not a substitute for Lucene and is not trying to be. It
                is the thing you build once, so that Lucene stops being magic.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 18 */}
      <Section meta={S.limits!}>
        <Head
          title={
            <>
              Said out loud,{" "}
              <em className="italic ac">before you find them</em>
            </>
          }
          lede="Seven limits, and the order I would fix them in. Effort and payoff both matter, and they rarely point the same way."
        />

        <div className="cols">
          <div className="c-7">
            {[
              [
                "01",
                "No checksums",
                "Recovery validates structure, not content. A flipped bit inside a string value survives JSON.parse and the id check, and every one of the four recovery tests passes it. A CRC per record is the fix, it is contained to the record format, and it closes the only silent-corruption hole in the design.",
                "Fix first. Small change, removes a whole failure class.",
              ],
              [
                "02",
                "All I/O is synchronous",
                "fs.readSync and fs.writeSync block the Node event loop, so one slow read stalls every concurrent request. At a scale where the page cache holds the working set this is fine, and it keeps the storage code linear and readable. At a larger scale it is the first thing to change, and it is not a small change.",
                "Second. Large diff, and the readability cost is real.",
              ],
              [
                "03",
                "Search is a bag of words",
                "No phrase queries, no boolean operators, no field weighting, no fuzzy matching. Position data has to go into the postings before any of that becomes possible, which means the posting format changes and the snapshot format changes with it.",
                "Third. Biggest jump in what the product can do.",
              ],
              [
                "04",
                "The stemmer is six rules",
                "Porter's algorithm fixes the doubled-consonant case and most of the over-stemming. It is a self-contained swap into one function that already has tests around it.",
                "Cheap. Do it any time.",
              ],
              [
                "05",
                "The inverted index is memory-resident",
                "Postings are JavaScript objects, nothing spills to disk, and the corpus has to fit in the heap. Real engines use skip lists and delta-encoded posting blocks on disk. See the memory table above for where the wall is.",
                "Only when the wall is actually hit.",
              ],
              [
                "06",
                "One writer, one process",
                "Nothing coordinates two processes against one data directory. There is no lock file. Opening the same directory twice will corrupt it. A lock file is twenty lines and would at least turn corruption into an error message.",
                "Twenty lines. Worth doing on principle.",
              ],
              [
                "07",
                "No authentication",
                "POST /reset destroys the store and DELETE /documents/:id removes a document, both unauthenticated, with CORS set to origin: true. Correct for a local demo, unacceptable the moment it is reachable from anywhere else.",
                "Blocking, if this is ever deployed.",
              ],
            ].map(([n, t, body, verdict]) => (
              <div
                key={n}
                style={{
                  borderTop: "1px solid var(--hair)",
                  padding: "22px 0",
                }}
              >
                <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                  <span className="label label-ac">{n}</span>
                  <h3
                    className="display d-sm"
                    style={{ fontSize: 24, margin: 0 }}
                  >
                    {t}
                  </h3>
                </div>
                <p
                  style={{
                    margin: "12px 0 0",
                    paddingLeft: 40,
                    color: "var(--fg-2)",
                    fontSize: 14.5,
                    maxWidth: "62ch",
                  }}
                >
                  {body}
                </p>
                <p
                  className="label label-ac"
                  style={{ margin: "12px 0 0", paddingLeft: 40 }}
                >
                  {verdict}
                </p>
              </div>
            ))}
          </div>

          <div className="c-5">
            <div
              className="cut accent"
              style={{ position: "relative", padding: "34px 32px" }}
            >
              <p className="label" style={{ marginBottom: 20 }}>
                Also true, and less fixable
              </p>
              <div className="prose">
                <p>
                  <strong>Snapshots are JSON.</strong> Human-readable and slow to
                  parse. A binary format would load faster and diff worse. For a
                  system whose entire point is being readable, JSON wins, and I
                  would make the same call again.
                </p>
                <p>
                  <strong>The tokenizer cannot index non-English text.</strong>{" "}
                  Not ranks it poorly. Cannot index it. Fixing that means a
                  Unicode-aware character class and a per-language stemmer, at
                  which point you are building a real analysis chain and should
                  probably use one.
                </p>
                <p>
                  <strong>Compaction blocks.</strong> Everything blocks. See
                  limit 02.
                </p>
              </div>
              <hr
                className="dot-rule"
                style={{ margin: "26px 0 20px", opacity: 0.4 }}
              />
              <p
                className="mono"
                style={{ margin: 0, fontSize: 11.5, color: "rgba(10,22,34,0.7)" }}
              >
                A limit you have written down is a decision. A limit you have not
                is a surprise waiting for someone else.
              </p>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 56 }}>
          <Scale label="END OF PART TWO · SEARCH, RANKING, AND SCOPE" />
        </div>
      </Section>
    </>
  );
}
