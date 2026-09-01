/* Static technical drawings for the storage half of the system.
   Every diagram shares one line vocabulary defined in globals.css. */

/** A small numbered index tag, drawn as a hairline square. */
function Tag({ x, y, n }: { x: number; y: number; n: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x="0" y="0" width="15" height="15" className="d-line" />
      <text x="7.5" y="10.5" textAnchor="middle" className="d-t-ac">
        {n}
      </text>
    </g>
  );
}

/** A dotted dimension line with end serifs and a label above it. */
function Dim({
  x1,
  x2,
  y,
  label,
  color = "var(--accent)",
}: {
  x1: number;
  x2: number;
  y: number;
  label: string;
  color?: string;
}) {
  return (
    <g>
      <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} stroke={color} strokeWidth="1" />
      <line x1={x2} y1={y - 5} x2={x2} y2={y + 5} stroke={color} strokeWidth="1" />
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={color}
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <text
        x={(x1 + x2) / 2}
        y={y - 9}
        textAnchor="middle"
        className="d-t-ac"
        style={{ fill: color }}
      >
        {label}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ 00 */

export function SystemMap() {
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    sub?: string,
    accent?: boolean,
    hint?: string,
  ) => (
    <g className={hint ? "d-hit" : undefined}>
      {hint ? <title>{hint}</title> : null}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        className={accent ? "d-box" : "d-box-2"}
        stroke={accent ? "var(--accent)" : undefined}
      />
      <text
        x={x + 12}
        y={h >= 48 ? y + 21 : y + h / 2 + 4}
        className="d-t-lg"
        style={{ fontSize: 12 }}
      >
        {title}
      </text>
      {sub && h >= 48 ? (
        <text x={x + 12} y={y + 37} className="d-t-s">
          {sub}
        </text>
      ) : null}
    </g>
  );

  return (
    <svg viewBox="0 0 1180 430" role="img" aria-label="Shardly component map">
      <text x="0" y="12" className="d-t-s">
        SHARDLY · COMPONENT MAP · SINGLE PROCESS, SINGLE MACHINE
      </text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      {/* intake */}
      <text x="0" y="52" className="d-t-ac">INTAKE</text>
      {box(0, 62, 172, 34, "HTTP client", "POST /documents", false, "One JSON body, or an array through /documents/bulk. The route validates, the engine writes.")}
      {box(0, 104, 172, 34, "File upload", "txt · md · json · pdf", false, "extractDocuments() dispatches on extension. PDFs go through unpdf; unknown extensions get a binary check before decoding.")}
      {box(0, 146, 172, 34, "GitHub", "user · owner/repo", false, "Metadata and README always. Deep mode walks the file tree behind a worker pool and a request budget.")}
      {box(0, 188, 172, 34, "Wikipedia corpus", "corpus/wikipedia.ndjson", false, "2,386 articles streamed from disk with readline, 500 at a time, so the file never lands in memory whole.")}

      <path d="M172 79 H210 M172 121 H210 M172 163 H210 M172 205 H210" className="d-line" />
      <path d="M210 79 V142 M210 205 V142 M210 121 V142 M210 163 V142" className="d-line" />
      <path d="M210 142 H252" className="d-ac" markerEnd="url(#ah-ac)" />

      {/* api */}
      <text x="262" y="52" className="d-t-ac">EDGE</text>
      {box(262, 62, 176, 160, "Fastify routes", "src/api/routes.ts", false, "Validates input, clamps limits, truncates previews. No business logic, which is why the engine is testable without a server.")}
      <text x="274" y="124" className="d-t-s">VALIDATE INPUT</text>
      <text x="274" y="142" className="d-t-s">CLAMP LIMITS</text>
      <text x="274" y="160" className="d-t-s">TRUNCATE PREVIEWS</text>
      <text x="274" y="178" className="d-t-s">NO BUSINESS LOGIC</text>
      <line x1="274" y1="192" x2="426" y2="192" className="d-dash" />
      <text x="274" y="210" className="d-t-s" style={{ fill: "var(--accent)" }}>
        18 ROUTES
      </text>

      <path d="M438 142 H490" className="d-ac" markerEnd="url(#ah-ac)" />

      {/* engine */}
      <text x="500" y="52" className="d-t-ac">COORDINATOR</text>
      <rect x="500" y="62" width="176" height="160" className="d-box" stroke="var(--accent)" />
      <text x="512" y="86" className="d-t-lg">Engine</text>
      <text x="512" y="104" className="d-t-s">src/engine.ts · 236 LOC</text>
      <line x1="512" y1="118" x2="664" y2="118" className="d-dash" />
      <text x="512" y="138" className="d-t">write → storage + index</text>
      <text x="512" y="156" className="d-t">read → storage only</text>
      <text x="512" y="174" className="d-t">search → index only</text>
      <text x="512" y="200" className="d-t-s">KNOWS NOTHING OF HTTP</text>

      {/* split */}
      <path d="M676 142 H716 M716 142 V100 M716 142 V212" className="d-line-2" />
      <path d="M716 100 H756" className="d-line-2" markerEnd="url(#ah-fg)" />
      <path d="M716 212 H756" className="d-line-2" markerEnd="url(#ah-fg)" />

      {/* storage branch */}
      <text x="766" y="52" className="d-t-ac">DURABILITY</text>
      {box(766, 62, 190, 34, "Storage", "offset index in memory", false, "Owns the offset map, one write descriptor, and a read descriptor per segment. Many readers, one writer, no locking.")}
      {box(766, 104, 190, 34, "WriteAheadLog", "pending → committed", false, "Two records per write. The pending one bounds where damage can be; the committed one proves it is not there.")}
      {box(766, 146, 190, 34, "segment-NNNN.log", "append only · 64 MiB cap", false, "One JSON record per line. Old bytes are never touched, so a crash can only ever damage the tail.")}
      <path d="M861 96 V104 M861 138 V146" className="d-line" markerEnd="url(#ah)" />

      {/* search branch */}
      <text x="766" y="248" className="d-t-ac">RELEVANCE</text>
      {box(766, 258, 190, 34, "tokenize()", "fold · strip · stem", false, "Lowercase, split on anything outside a-z0-9, drop 51 stopwords, apply six suffix rules. Query and document share it.")}
      {box(766, 300, 190, 34, "InvertedIndexStore", "term → postings", false, "Four maps: postings, document frequency, document lengths, and the per-document term list that makes delete cheap.")}
      {box(766, 342, 190, 34, "rankBM25()", "k1 = 1.5 · b = 0.75", false, "Scores in one pass, selects with a bounded heap, then builds a term-by-term breakdown for the winners only.")}
      <path d="M861 292 V300 M861 334 V342" className="d-line" markerEnd="url(#ah)" />

      {/* rejoin */}
      <path d="M956 163 H1000 M1000 163 V255" className="d-dash" />
      <path d="M956 359 H1000" className="d-ac" />
      <path d="M1000 359 V270 M1000 255 V270" className="d-ac" />
      <path d="M1000 270 H1046" className="d-ac" markerEnd="url(#ah-ac)" />

      <rect x="1046" y="240" width="134" height="60" className="d-box" stroke="var(--accent)" />
      <text x="1058" y="264" className="d-t-lg" style={{ fontSize: 12 }}>
        Ranked hits
      </text>
      <text x="1058" y="281" className="d-t-s">SCORE + BREAKDOWN</text>

      <text x="1010" y="180" className="d-t-s">SEEK ONLY</text>
      <text x="1010" y="194" className="d-t-s">THE WINNERS</text>

      <line x1="0" y1="408" x2="1180" y2="408" className="d-line" />
      <text x="0" y="424" className="d-t-s">
        NO CLUSTER · NO REPLICATION · NO EMBEDDED DATABASE · NO SEARCH LIBRARY
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 01 */

export function TwoMaps() {
  const rows = [
    ["a1f3…c07", "segment-0000", "0", "184"],
    ["b8e2…9d1", "segment-0000", "185", "231"],
    ["c4a9…22f", "segment-0000", "417", "196"],
    ["d0b7…8ae", "segment-0001", "0", "308"],
  ];
  const terms: Array<[string, string[]]> = [
    ["storag", ["a1f3 ×4", "c4a9 ×1"]],
    ["index", ["a1f3 ×2", "b8e2 ×7", "d0b7 ×1"]],
    ["crash", ["b8e2 ×3"]],
  ];

  return (
    <svg viewBox="0 0 1180 400" role="img" aria-label="The two in-memory maps">
      <text x="0" y="12" className="d-t-s">RESIDENT IN MEMORY · REBUILDABLE FROM DISK</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      {/* offset index */}
      <Tag x={0} y={40} n="A" />
      <text x="24" y="52" className="d-t-lg">OffsetIndex</text>
      <text x="0" y="76" className="d-t-s">Map&lt;docId, {"{"} segment, byteOffset, length, deleted {"}"}&gt;</text>

      <rect x="0" y="88" width="520" height="150" className="d-box-2" />
      <line x1="0" y1="114" x2="520" y2="114" className="d-line" />
      {["DOC ID", "SEGMENT", "OFFSET", "LENGTH"].map((h, i) => (
        <text key={h} x={12 + i * 130} y="106" className="d-t-s">{h}</text>
      ))}
      {rows.map((r, ri) => (
        <g key={ri}>
          {ri === 1 ? (
            <rect x="1" y={115 + ri * 30} width="518" height="30" fill="var(--acc-10)" />
          ) : null}
          {r.map((c, ci) => (
            <text
              key={ci}
              x={12 + ci * 130}
              y={135 + ri * 30}
              className="d-t"
              style={ri === 1 ? { fill: "var(--accent)" } : undefined}
            >
              {c}
            </text>
          ))}
          {ri < 3 ? (
            <line x1="0" y1={145 + ri * 30} x2="520" y2={145 + ri * 30} className="d-line" />
          ) : null}
        </g>
      ))}

      {/* inverted index */}
      <Tag x={660} y={40} n="B" />
      <text x="684" y="52" className="d-t-lg">InvertedIndex</text>
      <text x="660" y="76" className="d-t-s">Map&lt;term, [{"{"} docId, termFrequency {"}"}]&gt;</text>

      <rect x="660" y="88" width="520" height="150" className="d-box-2" />
      {terms.map(([term, posts], ti) => (
        <g key={term}>
          <text x="672" y={112 + ti * 42} className="d-t" style={{ fill: "var(--accent)" }}>
            {term}
          </text>
          <path
            d={`M732 ${108 + ti * 42} H768`}
            className="d-line"
            markerEnd="url(#ah)"
          />
          {posts.map((p, pi) => (
            <g key={p}>
              <rect
                x={778 + pi * 108}
                y={97 + ti * 42}
                width="98"
                height="20"
                className="d-box"
              />
              <text x={787 + pi * 108} y={111 + ti * 42} className="d-t">{p}</text>
            </g>
          ))}
          {ti < 2 ? (
            <line x1="660" y1={128 + ti * 42} x2="1180" y2={128 + ti * 42} className="d-dash" />
          ) : null}
        </g>
      ))}

      {/* the join. The dashed run stops either side of its own caption. */}
      <path d="M260 238 V282" className="d-ac" markerEnd="url(#ah-ac)" />
      <path d="M920 238 V270 H852" className="d-dash" />
      <path d="M428 270 H300 V282" className="d-dash" />
      <text x="640" y="274" className="d-t-s" textAnchor="middle">
        SEARCH RESOLVES CANDIDATES HERE, THEN ASKS A FOR THEIR BYTES
      </text>

      <rect x="0" y="290" width="1180" height="52" className="d-box-2" />
      <text x="14" y="312" className="d-t-s">segment-0000.log</text>
      {[0, 185, 417].map((off, i) => {
        const x = 14 + off * 0.9;
        const w = [184, 231, 196][i]! * 0.9;
        return (
          <g key={off}>
            <rect
              x={x}
              y={318}
              width={w}
              height={14}
              fill={i === 1 ? "var(--accent)" : "url(#hatch)"}
              className={i === 1 ? undefined : "d-line"}
            />
          </g>
        );
      })}
      <text x="1166" y="330" textAnchor="end" className="d-t-s">…64 MiB</text>

      <Dim x1={14 + 185 * 0.9} x2={14 + 185 * 0.9 + 231 * 0.9} y={362} label="ONE readSync, 231 BYTES" />

      <line x1="0" y1="382" x2="1180" y2="382" className="d-line" />
      <text x="0" y="396" className="d-t-s">
        NEITHER MAP IS THE SOURCE OF TRUTH. THE SEGMENTS ARE. BOTH MAPS REBUILD FROM THEM.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 02 */

export function RecordAnatomy() {
  return (
    <svg viewBox="0 0 1180 320" role="img" aria-label="Anatomy of one stored record">
      <text x="0" y="12" className="d-t-s">SEGMENT-0000.LOG · NDJSON · ONE RECORD PER LINE</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      {/* byte ruler */}
      <text x="0" y="52" className="d-t-ac">BYTE RULER</text>
      {Array.from({ length: 25 }, (_, i) => (
        <g key={i}>
          <line
            x1={i * 47}
            y1={62}
            x2={i * 47}
            y2={i % 5 === 0 ? 74 : 68}
            className="d-line"
          />
          {i % 5 === 0 ? (
            <text x={i * 47 + 4} y={72} className="d-t-s">
              {i * 32}
            </text>
          ) : null}
        </g>
      ))}
      <line x1="0" y1="62" x2="1128" y2="62" className="d-line" />

      {/* records */}
      <rect x="0" y="88" width="330" height="30" fill="url(#hatch)" className="d-line" />
      <text x="12" y="107" className="d-t-s">RECORD 0 · 184 B</text>

      <rect x="336" y="88" width="418" height="30" className="d-box" stroke="var(--accent)" fill="var(--acc-10)" />
      <text x="348" y="107" className="d-t" style={{ fill: "var(--accent)" }}>
        {"{\"id\":\"b8e2-…\",\"doc\":{\"title\":\"Raft\",…}}"}
      </text>

      <rect x="754" y="88" width="14" height="30" fill="url(#hatch-ac)" className="d-ac" />
      <rect x="772" y="88" width="356" height="30" fill="url(#hatch)" className="d-line" />
      <text x="784" y="107" className="d-t-s">RECORD 2 · 196 B</text>

      <Dim x1={0} x2={336} y={142} label="byteOffset = 185" color="var(--wash-50)" />
      <Dim x1={336} x2={754} y={175} label="length = 231" />

      <path d="M761 118 V196" className="d-ac" />
      <text x="769" y="196" className="d-t-ac">THE \n IS NOT COUNTED</text>
      <text x="769" y="210" className="d-t-s">
        length STOPS AT THE LAST BRACE, SO JSON.parse GETS EXACTLY ITS OBJECT
      </text>

      <line x1="0" y1="232" x2="1180" y2="232" className="d-dash" />

      <text x="0" y="256" className="d-t-ac">THE READ</text>
      <rect x="0" y="266" width="640" height="40" className="d-box-2" />
      <text x="14" y="291" className="d-t">
        fs.readSync(fd, buf, 0, 231, 185) → JSON.parse(buf) → doc
      </text>
      <text x="664" y="279" className="d-t-s">ONE SYSCALL. NO SCAN. NO PARSE OF ANY NEIGHBOUR.</text>
      <text x="664" y="297" className="d-t-s">COST IS THE SAME AT 100 DOCUMENTS AND AT 100 MILLION.</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 03 */

export function AppendVsUpdate() {
  return (
    <svg viewBox="0 0 1180 340" role="img" aria-label="In-place update versus append">
      <line x1="590" y1="0" x2="590" y2="340" className="d-dash" />

      {/* in place */}
      <text x="0" y="14" className="d-t-ac">REJECTED · UPDATE IN PLACE</text>
      <text x="0" y="42" className="d-t-s">RECORD GREW FROM 184 TO 240 BYTES</text>

      <rect x="0" y="56" width="140" height="26" fill="url(#hatch)" className="d-line" />
      <rect x="146" y="56" width="180" height="26" className="d-box" />
      <rect x="332" y="56" width="200" height="26" fill="url(#hatch)" className="d-line" />
      <text x="156" y="74" className="d-t">OLD RECORD</text>

      <path d="M236 92 V112" className="d-ac" markerEnd="url(#ah-ac)" />

      <rect x="0" y="120" width="140" height="26" fill="url(#hatch)" className="d-line" />
      <rect x="146" y="120" width="236" height="26" className="d-box" stroke="var(--accent)" fill="var(--acc-10)" />
      <rect x="388" y="120" width="144" height="26" fill="url(#hatch)" className="d-line" />
      <text x="156" y="138" className="d-t" style={{ fill: "var(--accent)" }}>NEW RECORD OVERRUNS</text>
      <path d="M332 114 V152" className="d-ac" strokeDasharray="2 3" />
      <text x="340" y="168" className="d-t-ac">56 BYTES OF THE NEXT RECORD ARE GONE</text>

      <text x="0" y="204" className="d-t-s">SO THE OPTIONS ARE:</text>
      <text x="0" y="226" className="d-t">1 · Pad every record and cap growth</text>
      <text x="0" y="246" className="d-t">2 · Move the record, leave a hole, rewrite the map</text>
      <text x="0" y="266" className="d-t">3 · Rewrite the whole segment</text>
      <line x1="0" y1="284" x2="532" y2="284" className="d-dash" />
      <text x="0" y="306" className="d-t-ac">EVERY OPTION NEEDS A CRASH-SAFE TWO-STEP.</text>
      <text x="0" y="322" className="d-t-ac">NONE OF THEM IS FREE.</text>

      {/* append */}
      <text x="640" y="14" className="d-t-ac">CHOSEN · APPEND</text>
      <text x="640" y="42" className="d-t-s">OLD BYTES ARE NEVER TOUCHED</text>

      <rect x="640" y="56" width="140" height="26" fill="url(#hatch)" className="d-line" />
      <rect x="786" y="56" width="180" height="26" className="d-box" />
      <rect x="972" y="56" width="140" height="26" fill="url(#hatch)" className="d-line" />
      <text x="796" y="74" className="d-t">OLD RECORD</text>

      <rect x="1118" y="56" width="62" height="26" className="d-box" stroke="var(--accent)" fill="var(--acc-10)" />
      <text x="1128" y="74" className="d-t" style={{ fill: "var(--accent)" }}>NEW</text>

      <path d="M876 92 V116" className="d-dash" />
      <text x="640" y="132" className="d-t-s">THE MAP MOVES, THE BYTES DO NOT</text>
      <rect x="640" y="142" width="472" height="26" className="d-box-2" />
      <text x="652" y="160" className="d-t">
        offsetIndex.set(&quot;b8e2…&quot;, {"{"} byteOffset: 1_204_886, … {"}"})
      </text>

      <line x1="640" y1="192" x2="1180" y2="192" className="d-dash" />
      <text x="640" y="214" className="d-t-ac">WHAT IT BUYS</text>
      <text x="640" y="234" className="d-t">A crash can only ever damage the tail</text>
      <text x="640" y="254" className="d-t">One writer, no locking, no in-place torn state</text>
      <text x="640" y="274" className="d-t">Sequential writes, which every disk prefers</text>
      <text x="640" y="302" className="d-t-ac">WHAT IT COSTS</text>
      <text x="640" y="322" className="d-t">Dead bytes accumulate until compaction runs</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 05 */

export function RecoveryTree() {
  const node = (x: number, y: number, w: number, label: string, sub?: string) => (
    <g>
      <rect x={x} y={y} width={w} height={sub ? 46 : 32} className="d-box-2" />
      <text x={x + 12} y={y + 20} className="d-t">{label}</text>
      {sub ? (
        <text x={x + 12} y={y + 36} className="d-t-s">{sub}</text>
      ) : null}
    </g>
  );

  const checks = [
    ["Does the segment file exist?", "A rotation that never landed"],
    ["Is the file long enough?", "The write was cut short"],
    ["Do those bytes parse as JSON?", "The write was cut mid-object"],
    ["Does the embedded id match?", "The offset points at a stranger"],
  ];

  return (
    <svg viewBox="0 0 1180 430" role="img" aria-label="The recovery decision path">
      <text x="0" y="12" className="d-t-s">Storage.replayWal() · TWO PASSES OVER wal.log</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      <text x="0" y="50" className="d-t-ac">PASS 1 · APPLY WITHOUT INSPECTION</text>
      {node(0, 60, 340, "status: committed", "Proven durable. Trust it.")}
      <path d="M340 83 H392" className="d-line-2" markerEnd="url(#ah-fg)" />
      {node(400, 60, 300, "offsetIndex.set(...)", "Or set deleted: true for tombstones")}

      <line x1="0" y1="130" x2="1180" y2="130" className="d-dash" />

      <text x="0" y="158" className="d-t-ac">PASS 2 · THE CRASH WINDOW</text>
      {node(0, 168, 340, "pending with no committed twin", "Keyed by segment:byteOffset")}

      <path d="M170 214 V236" className="d-ac" markerEnd="url(#ah-ac)" />

      {checks.map(([q, why], i) => {
        const y = 244 + i * 42;
        return (
          <g key={q} className="d-hit">
            <title>{`Check ${i + 1}: ${q} ${why}.`}</title>
            <rect x="0" y={y} width="470" height="32" className="d-box" stroke="var(--accent)" />
            <text x="14" y={y + 20} className="d-t" style={{ fill: "var(--accent)" }}>
              {i + 1} · {q}
            </text>
            <text x="490" y={y + 20} className="d-t-s">{why}</text>
            <path d={`M235 ${y + 32} V ${y + 42}`} className="d-ac" />
            <path d={`M470 ${y + 16} H 940`} className="d-dash" />
          </g>
        );
      })}

      <text x="235" y="424" textAnchor="middle" className="d-t-ac">ALL FOUR PASS → APPLY</text>

      <rect x="940" y="244" width="240" height="74" className="d-box-2" />
      <text x="954" y="266" className="d-t" style={{ fill: "var(--accent)" }}>ANY CHECK FAILS</text>
      <text x="954" y="286" className="d-t-s">DISCARD THE RECORD</text>
      <text x="954" y="304" className="d-t-s">THE CALLER NEVER GOT AN ACK</text>

      <rect x="940" y="330" width="240" height="88" className="d-box-2" />
      <text x="954" y="352" className="d-t" style={{ fill: "var(--accent)" }}>WHAT SLIPS THROUGH</text>
      <text x="954" y="372" className="d-t-s">A FLIPPED BIT INSIDE A STRING</text>
      <text x="954" y="388" className="d-t-s">STRUCTURE IS INTACT, MEANING IS NOT</text>
      <text x="954" y="410" className="d-t-s" style={{ fill: "var(--accent)" }}>FIX: A CRC PER RECORD</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 06 */

export function FsyncMath() {
  const bar = (x: number, y: number, n: number, gap: number, accent: boolean) =>
    Array.from({ length: n }, (_, i) => (
      <rect
        key={i}
        x={x + i * gap}
        y={y}
        width={gap - 2}
        height="22"
        fill={accent ? "var(--accent)" : "var(--wash-16)"}
      />
    ));

  return (
    <svg viewBox="0 0 1180 330" role="img" aria-label="fsync count per document versus per batch">
      <text x="0" y="12" className="d-t-s">fsync COSTS THE SAME FOR 200 BYTES AND FOR 200 KILOBYTES</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      <text x="0" y="52" className="d-t-ac">ONE AT A TIME · 1,000 DOCUMENTS</text>
      <text x="0" y="72" className="d-t-s">3 fsync PER DOCUMENT</text>
      {bar(0, 84, 60, 19, false)}
      <text x="1150" y="100" textAnchor="end" className="d-t">3,000</text>
      <text x="0" y="126" className="d-t-s">WAL PENDING · SEGMENT · WAL COMMITTED · REPEAT ×1000</text>

      <line x1="0" y1="150" x2="1180" y2="150" className="d-dash" />

      <text x="0" y="180" className="d-t-ac">writeBatch() · SAME 1,000 DOCUMENTS</text>
      <text x="0" y="200" className="d-t-s">3 fsync PER BATCH</text>
      {bar(0, 212, 3, 19, true)}
      <text x="1150" y="228" textAnchor="end" className="d-t" style={{ fill: "var(--accent)" }}>3</text>

      <text x="0" y="254" className="d-t-s">
        1 · ALL INTENTS 2 · ALL DATA 3 · ALL COMMITS
      </text>

      <line x1="0" y1="278" x2="1180" y2="278" className="d-line" />
      <text x="0" y="300" className="d-t">
        The invariant was never &quot;one document at a time&quot;.
      </text>
      <text x="0" y="320" className="d-t" style={{ fill: "var(--accent)" }}>
        It was &quot;intent durable before data, data durable before commit&quot;. Batching keeps both.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 07 */

export function CompactTimeline() {
  const steps = [
    ["1", "Write live records into fresh segments", "Numbered from currentSegmentIndex + 1"],
    ["2", "fsync every new segment", "Data durable, nothing references it yet"],
    ["3", "snapshot() writes new offsets, truncates the WAL", "THE COMMIT POINT"],
    ["4", "Unlink the old segment files", "Reclaim the dead bytes"],
  ];
  return (
    <svg viewBox="0 0 1180 360" role="img" aria-label="Compaction ordering and its commit point">
      <text x="0" y="12" className="d-t-s">Storage.compact() · ORDERING IS THE WHOLE DESIGN</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      <line x1="20" y1="60" x2="20" y2="286" className="d-line" />
      {steps.map(([n, label, sub], i) => {
        const y = 68 + i * 56;
        const commit = i === 2;
        return (
          <g key={n} className="d-hit">
            <title>{`Step ${n}. ${label}. ${sub}`}</title>
            <circle cx="20" cy={y} r={commit ? 7 : 4} className={commit ? "d-ac-f" : "d-line-2"} fill={commit ? "var(--accent)" : "var(--ink-3)"} stroke={commit ? "none" : "var(--hair-solid)"} />
            <text x="44" y={y + 4} className="d-t" style={commit ? { fill: "var(--accent)" } : undefined}>
              {n} · {label}
            </text>
            <text x="44" y={y + 20} className="d-t-s" style={commit ? { fill: "var(--accent)" } : undefined}>
              {sub}
            </text>
          </g>
        );
      })}

      <line x1="620" y1="50" x2="620" y2="300" className="d-dash" />

      <text x="660" y="62" className="d-t-ac">CRASH BEFORE STEP 3</text>
      <rect x="660" y="72" width="520" height="70" className="d-box-2" />
      <text x="674" y="94" className="d-t">Old snapshot + old segments, both intact.</text>
      <text x="674" y="114" className="d-t-s">ONE ORPHANED PARTIAL FILE IS LEFT ON DISK.</text>
      <text x="674" y="132" className="d-t-s">NOTHING POINTS AT IT. NOTHING IS LOST.</text>

      <text x="660" y="182" className="d-t-ac">CRASH AFTER STEP 3</text>
      <rect x="660" y="192" width="520" height="70" className="d-box-2" />
      <text x="674" y="214" className="d-t">New snapshot valid, old files still present.</text>
      <text x="674" y="234" className="d-t-s">WASTED DISK UNTIL THE NEXT COMPACTION.</text>
      <text x="674" y="252" className="d-t-s">NOTHING IS LOST HERE EITHER.</text>

      <line x1="0" y1="304" x2="1180" y2="304" className="d-line" />
      <text x="0" y="326" className="d-t-ac">
        NO STARTUP SWEEP REMOVES THE ORPHAN, ON PURPOSE.
      </text>
      <text x="0" y="346" className="d-t">
        A sweep that unlinks unreferenced segments is the exact code that deletes real data when a snapshot goes missing for an unrelated reason. Orphans cost disk. Sweeps cost documents.
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ 08 */

export function VersionGuard() {
  return (
    <svg viewBox="0 0 1180 340" role="img" aria-label="Why a document count cannot detect a stale snapshot">
      <text x="0" y="12" className="d-t-s">IS THE SNAPSHOT I JUST LOADED STILL TRUE?</text>
      <line x1="0" y1="22" x2="1180" y2="22" className="d-line" />

      <text x="0" y="52" className="d-t-ac">THE CHECK THAT FAILED · COMPARE DOCUMENT COUNTS</text>

      {([
        ["t0", "3 documents indexed", "count = 3", false],
        ["t1", "delete b8e2…", "count = 2", false],
        ["t2", "add f19c…", "count = 3", true],
      ] as Array<[string, string, string, boolean]>).map(([t, what, count, bad], i) => {
        const x = i * 300;
        return (
          <g key={t}>
            <rect x={x} y="66" width="270" height="86" className="d-box-2" stroke={bad ? "var(--accent)" : undefined} />
            <text x={x + 14} y="90" className="d-t-ac">{t}</text>
            <text x={x + 14} y="112" className="d-t">{what}</text>
            <text x={x + 14} y="134" className="d-t-s" style={bad ? { fill: "var(--accent)" } : undefined}>
              {count}
            </text>
            {i < 2 ? (
              <path d={`M${x + 270} 109 H ${x + 296}`} className="d-line" markerEnd="url(#ah)" />
            ) : null}
          </g>
        );
      })}

      <path d="M135 152 V186 H770 V152" className="d-ac" />
      <text x="452" y="180" textAnchor="middle" className="d-t-ac">
        SAME COUNT. COMPLETELY DIFFERENT CONTENT. THE STALE INDEX LOADS AND SEARCH LIES.
      </text>

      <line x1="0" y1="206" x2="1180" y2="206" className="d-dash" />

      <text x="0" y="234" className="d-t-ac">THE CHECK THAT WORKS · A MONOTONIC VERSION</text>
      <rect x="0" y="248" width="560" height="76" className="d-box" stroke="var(--accent)" />
      <text x="14" y="272" className="d-t">Storage.version++ on every mutation</text>
      <text x="14" y="292" className="d-t">Written into both snapshot files</text>
      <text x="14" y="312" className="d-t" style={{ fill: "var(--accent)" }}>
        index.load(...) === storage.stateVersion() → keep, else rebuild
      </text>

      <text x="600" y="272" className="d-t-s">t0 → version 3 · t1 → version 4 · t2 → version 5</text>
      <text x="600" y="292" className="d-t-s">
        DELETE AND ADD BOTH BUMP IT, SO THEY CANNOT CANCEL OUT.
      </text>
      <text x="600" y="312" className="d-t-s">
        ANYTHING BUT AN EXACT MATCH REBUILDS FROM THE SEGMENTS.
      </text>
    </svg>
  );
}
