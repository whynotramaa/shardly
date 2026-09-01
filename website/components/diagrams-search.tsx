/* Static technical drawings for the search and ranking half. */

/* ------------------------------------------------------------------ 09 */

export function TokenLoss() {
  const stages = [
    ["toLowerCase()", "Zürich Café", "zürich café", "Case is gone. Acronyms and names flatten into common words."],
    ["replace(/[^a-z0-9\\s]+/g, ' ')", "zürich café", "z rich caf", "Every non-ASCII letter is a separator. 東京 becomes nothing at all."],
    ["stopword filter", "the storage layer", "storage layer", "51 surface forms, checked before stemming."],
    ["stem()", "storage layer", "storag layer", "Six suffix rules. Not Porter. It over-stems and under-stems."],
  ];

  return (
    <svg viewBox="0 0 1180 400" role="img" aria-label="Where the tokenizer loses information">
      <text x="0" y="12" className="d-t-s">tokenize() · FOUR STAGES, FOUR KINDS OF LOSS</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      {stages.map(([fn, before, after, note], i) => {
        const y = 48 + i * 84;
        return (
          <g key={fn} className="d-hit">
            <title>{`${fn} — ${note}`}</title>
            <text x="0" y={y + 4} className="d-t-ac">{String(i + 1).padStart(2, "0")}</text>
            <text x="28" y={y + 4} className="d-t">{fn}</text>

            <rect x="330" y={y - 14} width="210" height="26" className="d-box-2" />
            <text x="342" y={y + 4} className="d-t">{before}</text>

            <path d={`M548 ${y - 1} H584`} className="d-ac" markerEnd="url(#ah-ac)" />

            <rect x="592" y={y - 14} width="210" height="26" className="d-box" stroke="var(--accent)" />
            <text x="604" y={y + 4} className="d-t" style={{ fill: "var(--accent)" }}>{after}</text>

            <text x="824" y={y + 4} className="d-t-s">{note}</text>
            <line x1="0" y1={y + 40} x2="1180" y2={y + 40} className="d-dash" />
          </g>
        );
      })}

      <text x="0" y={392} className="d-t">
        Query text and document text go through the identical function, so every
        collision hurts precision on both sides rather than silently breaking recall on one.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 10 */

export function DeleteCost() {
  return (
    <svg viewBox="0 0 1180 400" role="img" aria-label="Deleting from an inverted index, before and after docTerms">
      <text x="0" y="12" className="d-t-s">REMOVE ONE DOCUMENT FROM EVERY POSTING LIST IT APPEARS IN</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      {/* naive */}
      <text x="0" y="52" className="d-t-ac">NAIVE · WALK THE WHOLE VOCABULARY</text>
      {Array.from({ length: 40 }, (_, i) => (
        <rect
          key={i}
          x={i * 14}
          y={64}
          width="11"
          height="18"
          fill={[3, 11, 12, 26, 33].includes(i) ? "var(--accent)" : "var(--wash-10)"}
        />
      ))}
      <text x="576" y="78" className="d-t-s">… × 20,000 TERMS</text>
      <text x="0" y="102" className="d-t-s">
        FIVE HITS. 19,995 ARRAYS ALLOCATED AND THROWN AWAY.
      </text>

      <line x1="0" y1="126" x2="1180" y2="126" className="d-dash" />

      {/* docTerms */}
      <text x="0" y="156" className="d-t-ac">WITH docTerms · WALK ONLY THIS DOCUMENT&apos;S TERMS</text>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={i * 14} y={168} width="11" height="18" fill="var(--accent)" />
      ))}
      <text x="90" y="182" className="d-t-s">FIVE LOOKUPS. NOTHING ELSE IS TOUCHED.</text>
      <text x="0" y="206" className="d-t-s">
        COST NOW TRACKS THE SIZE OF THE DOCUMENT, NOT THE SIZE OF THE CORPUS.
      </text>

      <line x1="0" y1="230" x2="1180" y2="230" className="d-line" />

      {/* measured */}
      <text x="0" y="258" className="d-t-ac">MEASURED</text>
      {([
        ["2,386 Wikipedia articles", 2313, 311, "7×"],
        ["3,000 synthetic docs · 20,000-word vocabulary", 14555, 215, "68×"],
      ] as Array<[string, number, number, string]>).map(([label, before, after, ratio], i) => {
        const y = 282 + i * 60;
        const scale = 900 / 14555;
        return (
          <g key={label} className="d-hit">
            <title>{`${label}: ${before.toLocaleString()} ms walking the whole vocabulary, ${after} ms with docTerms. ${ratio} faster.`}</title>
            <text x="0" y={y} className="d-t">{label}</text>
            <rect x="0" y={y + 8} width={before * scale} height="10" fill="var(--wash-16)" />
            <text x={before * scale + 10} y={y + 17} className="d-t-s">{before.toLocaleString()} ms</text>
            <rect x="0" y={y + 22} width={Math.max(after * scale, 2)} height="10" fill="var(--accent)" />
            <text x={Math.max(after * scale, 2) + 10} y={y + 31} className="d-t-s" style={{ fill: "var(--accent)" }}>
              {after} ms
            </text>
            <text x="1180" y={y + 20} textAnchor="end" className="d-t-lg" style={{ fill: "var(--accent)", fontSize: 20 }}>
              {ratio}
            </text>
          </g>
        );
      })}

      <text x="0" y="396" className="d-t-s">
        docTerms IS NOT IN THE SNAPSHOT FORMAT. load() REBUILDS IT IN ONE PASS OVER POSTINGS ALREADY BEING PARSED.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 11 */

export function Bm25Anatomy() {
  return (
    <svg viewBox="0 0 1180 430" role="img" aria-label="The BM25 formula, part by part">
      <text x="0" y="12" className="d-t-s">score(D, Q) FOR ONE QUERY TERM · SUMMED OVER THE QUERY</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      {/* formula */}
      <text x="0" y="118" className="d-t-lg" style={{ fontSize: 22, fill: "var(--d-text)" }}>
        score(D, Q) =
      </text>
      <text x="168" y="118" className="d-t-lg" style={{ fontSize: 30, fill: "var(--d-text-2)" }}>
        Σ
      </text>
      <text x="163" y="140" className="d-t-s">q ∈ Q</text>

      <rect x="212" y="94" width="128" height="34" className="d-box" stroke="var(--accent)" />
      <text x="226" y="118" className="d-t-lg" style={{ fontSize: 19, fill: "var(--accent)" }}>
        idf(q)
      </text>

      <text x="356" y="118" className="d-t-lg" style={{ fontSize: 19, fill: "var(--d-text-2)" }}>×</text>

      {/* fraction */}
      <rect x="392" y="66" width="278" height="30" className="d-box" stroke="var(--accent)" />
      <text x="406" y="87" className="d-t-lg" style={{ fontSize: 17, fill: "var(--accent)" }}>
        tf(q,D) · (k₁ + 1)
      </text>

      <line x1="392" y1="110" x2="1000" y2="110" stroke="var(--d-text)" strokeWidth="1" />

      <text x="406" y="140" className="d-t-lg" style={{ fontSize: 17, fill: "var(--d-text)" }}>
        tf(q,D) + k₁ · ( 1 − b + b ·
      </text>
      <rect x="768" y="120" width="126" height="30" className="d-box" stroke="var(--accent)" />
      <text x="782" y="141" className="d-t-lg" style={{ fontSize: 17, fill: "var(--accent)" }}>
        |D| / avgdl
      </text>
      <text x="902" y="140" className="d-t-lg" style={{ fontSize: 17, fill: "var(--d-text)" }}>
        )
      </text>

      {/* callouts */}
      <path d="M276 128 V172 H80 V196" className="d-ac" markerEnd="url(#ah-ac)" />
      <path d="M670 81 H700 V172 H480 V196" className="d-ac" markerEnd="url(#ah-ac)" />
      <path d="M831 150 V172 H874 V196" className="d-ac" markerEnd="url(#ah-ac)" />

      {([
        [0, "A", "How surprising is this word?", [
          "log((N − n + 0.5) / (n + 0.5) + 1)",
          "A term in every document contributes almost nothing.",
          "A term in three documents dominates the score.",
          "The + 1 keeps IDF positive. Without it, a word in more",
          "than half the corpus would cost a document points.",
        ]],
        [396, "B", "Do repeats keep helping?", [
          "k₁ = 1.5 makes term frequency saturate.",
          "The tenth occurrence adds far less than the second.",
          "Raw frequency would let a page that repeats one word",
          "400 times beat a page genuinely about the topic.",
          "That failure is what BM25 was designed against.",
        ]],
        [792, "C", "Is it long, or is it thorough?", [
          "b = 0.75 applies three quarters of the correction.",
          "A long document has more chances to contain any term,",
          "so its frequencies are discounted by |D| / avgdl.",
          "At b = 0, long documents win everything.",
          "At b = 1, depth gets punished as padding.",
        ]],
      ] as Array<[number, string, string, string[]]>).map(([x, tag, title, lines]) => (
        <g key={tag} className="d-hit">
          <title>{`${title} ${lines.join(" ")}`}</title>
          <rect x={x} y="200" width="15" height="15" className="d-line" />
          <text x={x + 7.5} y="211" textAnchor="middle" className="d-t-ac">{tag}</text>
          <text x={x + 26} y="212" className="d-t-lg" style={{ fontSize: 13 }}>{title}</text>
          <line x1={x} y1="228" x2={x + 350} y2="228" className="d-dash" />
          {lines.map((l, li) => (
            <text key={li} x={x} y={250 + li * 18} className="d-t-s" style={{ letterSpacing: "0.04em" }}>
              {l}
            </text>
          ))}
        </g>
      ))}

      <line x1="0" y1="368" x2="1180" y2="368" className="d-line" />
      <text x="0" y="392" className="d-t">
        Every hit carries a breakdown: each term&apos;s frequency, its IDF, and its contribution, sorted by contribution.
      </text>
      <text x="0" y="414" className="d-t" style={{ fill: "var(--accent)" }}>
        A test asserts the contributions sum to the total. That is what lets the UI answer &quot;why did this rank here&quot;.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 12 */

export function TwoPasses() {
  return (
    <svg viewBox="0 0 1180 380" role="img" aria-label="Scoring in one pass, explaining in another">
      <text x="0" y="12" className="d-t-s">rankBM25() · 20,000 CANDIDATES, LIMIT 10</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      <text x="0" y="52" className="d-t-ac">PASS 1 · NUMBERS ONLY</text>
      <rect x="0" y="64" width="360" height="82" className="d-box-2" />
      <text x="14" y="88" className="d-t">Map&lt;docId, number&gt;</text>
      <text x="14" y="110" className="d-t-s">NO OBJECTS. NO BREAKDOWN ARRAYS.</text>
      <text x="14" y="128" className="d-t-s">ONE FLOAT PER MATCHED DOCUMENT.</text>

      <path d="M368 105 H414" className="d-ac" markerEnd="url(#ah-ac)" />

      <text x="424" y="52" className="d-t-ac">SELECT · BOUNDED HEAP</text>
      <rect x="424" y="64" width="360" height="82" className="d-box" stroke="var(--accent)" />
      <text x="438" y="88" className="d-t" style={{ fill: "var(--accent)" }}>MinHeap(capacity = 10)</text>
      <text x="438" y="110" className="d-t-s">THE WEAKEST OF THE TEN SITS AT THE ROOT.</text>
      <text x="438" y="128" className="d-t-s">ONE COMPARISON DECIDES EACH CANDIDATE.</text>

      <path d="M792 105 H838" className="d-ac" markerEnd="url(#ah-ac)" />

      <text x="848" y="52" className="d-t-ac">PASS 2 · EXPLAIN THE WINNERS</text>
      <rect x="848" y="64" width="332" height="82" className="d-box-2" />
      <text x="862" y="88" className="d-t">Map&lt;docId, Map&lt;term, tf&gt;&gt;</text>
      <text x="862" y="110" className="d-t-s">ONE WALK PER TERM, KEYED BY WINNER IDS.</text>
      <text x="862" y="128" className="d-t-s">NOT ONE WALK PER WINNER.</text>

      <line x1="0" y1="172" x2="1180" y2="172" className="d-dash" />

      {/* heap picture */}
      <text x="0" y="200" className="d-t-ac">WHY A HEAP AND NOT A SORT</text>

      {[
        [200, 226, "4.1"],
        [120, 274, "6.8"],
        [280, 274, "5.2"],
        [80, 322, "9.4"],
        [160, 322, "7.1"],
        [240, 322, "5.9"],
        [320, 322, "8.3"],
      ].map(([x, y, v], i) => (
        <g key={i}>
          <rect x={Number(x) - 20} y={Number(y) - 13} width="40" height="26" className={i === 0 ? "d-box" : "d-box-2"} stroke={i === 0 ? "var(--accent)" : undefined} />
          <text x={Number(x)} y={Number(y) + 4} textAnchor="middle" className="d-t" style={i === 0 ? { fill: "var(--accent)" } : undefined}>{v}</text>
        </g>
      ))}
      <path d="M186 236 L134 262 M214 236 L266 262 M106 286 L92 310 M134 286 L152 310 M266 286 L248 310 M294 286 L312 310" className="d-line" />
      <text x="230" y="215" className="d-t-ac">MINIMUM AT THE ROOT</text>

      <path d="M380 274 H430" className="d-ac" markerEnd="url(#ah-ac)" />
      <text x="440" y="252" className="d-t">
        New candidate scores 3.9. One comparison against 4.1 rejects it.
      </text>
      <text x="440" y="274" className="d-t">
        New candidate scores 7.7. It replaces the root, then sifts down. log₂(10) steps.
      </text>
      <text x="440" y="300" className="d-t" style={{ fill: "var(--accent)" }}>
        20,000 comparisons and 10 slots, against 20,000 · log 20,000 for a full sort.
      </text>
      <text x="440" y="330" className="d-t-s">
        WHEN limit IS Infinity OR EXCEEDS THE CANDIDATE COUNT, IT SORTS INSTEAD.
      </text>
      <text x="440" y="348" className="d-t-s">
        A HEAP CANNOT BEAT A SORT WHEN YOU WANT THE WHOLE LIST.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 14 */

export function IngestContract() {
  const adapters = [
    ["Files and PDFs", "src/ingest/extract.ts", [
      "Dispatch on extension",
      "PDF text via unpdf",
      "JSON array → one doc per element",
      "NDJSON → skip malformed lines",
      "Binary check before decoding",
    ]],
    ["GitHub", "src/ingest/github.ts", [
      "user · owner/repo · full URL",
      "Metadata and README always",
      "Deep mode walks the file tree",
      "mapLimit() worker pool, 18 lines",
      "Token optional, never stored",
    ]],
    ["Wikipedia", "src/ingest/corpus.ts", [
      "readline over the NDJSON file",
      "Batches of 500, never loads whole",
      "Live fetcher builds the file",
      "Honors Retry-After on 429 and 503",
      "Backoff with jitter, 25-failure limit",
    ]],
  ];

  return (
    <svg viewBox="0 0 1180 360" role="img" aria-label="Three ingestion adapters, one contract">
      <text x="0" y="12" className="d-t-s">ADDING A FOURTH SOURCE TOUCHES ONE FILE</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      {(adapters as Array<[string, string, string[]]>).map(([name, file, points], i) => {
        const x = i * 400;
        return (
          <g key={name} className="d-hit">
            <title>{`${name} (${file}): ${points.join("; ")}.`}</title>
            <rect x={x} y="44" width="360" height="176" className="d-box-2" />
            <text x={x + 14} y="70" className="d-t-lg" style={{ fontSize: 13 }}>{name}</text>
            <text x={x + 14} y="88" className="d-t-s">{file}</text>
            <line x1={x + 14} y1="100" x2={x + 346} y2="100" className="d-dash" />
            {points.map((p, pi) => (
              <g key={p}>
                <rect x={x + 14} y={114 + pi * 20} width="4" height="1" fill="var(--accent)" />
                <text x={x + 26} y={118 + pi * 20} className="d-t-s">{p}</text>
              </g>
            ))}
            <path d={`M${x + 180} 220 V 250`} className="d-ac" />
          </g>
        );
      })}

      <path d="M180 250 H980" className="d-ac" />
      <path d="M580 250 V282" className="d-ac" markerEnd="url(#ah-ac)" />

      <rect x="330" y="290" width="500" height="60" className="d-box" stroke="var(--accent)" />
      <text x="580" y="316" textAnchor="middle" className="d-t-lg" style={{ fontSize: 14, fill: "var(--accent)" }}>
        Engine.addDocuments(docs: Document[]): string[]
      </text>
      <text x="580" y="338" textAnchor="middle" className="d-t-s">
        NO ADAPTER KNOWS ABOUT SEGMENTS, THE WAL, OR THE INDEX
      </text>
    </svg>
  );
}
