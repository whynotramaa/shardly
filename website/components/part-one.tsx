import { Section, Head, Figure, Marks, SECTIONS, Stat } from "./chrome";
import {
  TwoMaps,
  RecordAnatomy,
  AppendVsUpdate,
  RecoveryTree,
  FsyncMath,
  CompactTimeline,
  VersionGuard,
} from "./diagrams-storage";
import { Scale, CircleField } from "./lineart";
import Reveal from "./reveal";
import LabWal from "./lab-wal";
import LabSeek from "./lab-seek";

const S = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

export default function PartOne() {
  return (
    <>
      {/* ============================================================ 01 */}
      <Section meta={S.idea!}>
        <Head
          title={
            <>
              Everything below follows from{" "}
              <em className="italic ac">one claim</em>
            </>
          }
          lede={
            <>
              You can find the bytes of any document without reading any other
              document. You can find every document containing a word without
              reading any document at all.
            </>
          }
        />

        <div className="cols">
          <div className="c-7">
            <div className="prose">
              <p>
                Two maps do the work. <code>OffsetIndex</code> takes a document
                id and gives back a segment file, a byte offset, and a byte
                length. <code>InvertedIndex</code> takes a term and gives back
                the list of documents containing it, with how often each one
                uses it.
              </p>
              <p>
                Both maps live in memory. Neither is the source of truth. The
                segment files on disk are, and both maps can be rebuilt from
                them. Everything else in Shardly is the machinery that keeps the
                maps honest when the power goes out.
              </p>
              <p>
                A read is one <code>fs.readSync</code> call at a known offset. A
                search walks posting lists and does not open a segment file
                until it already knows which ten documents to return. If you
                understand those two sentences, the rest of this page is detail.
              </p>
            </div>
          </div>

          <div className="c-5">
            <div className="cut panel panel-2" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 18 }}>
                The two maps
              </p>
              <dl className="dl" style={{ margin: 0 }}>
                <div className="dl-row">
                  <dt>A · offset</dt>
                  <dd className="mono" style={{ fontSize: 12 }}>
                    Map&lt;string, {"{"} segment, byteOffset, length, deleted {"}"}&gt;
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>B · inverted</dt>
                  <dd className="mono" style={{ fontSize: 12 }}>
                    Map&lt;string, Array&lt;{"{"} docId, termFrequency {"}"}&gt;&gt;
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>Truth</dt>
                  <dd>Neither. The segments are.</dd>
                </div>
                <div className="dl-row">
                  <dt>On restart</dt>
                  <dd>Load a snapshot, or rebuild from segments.</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <Reveal>
          <div style={{ marginTop: 44 }}>
            <Figure
              n="01.1"
              cap="Both maps in memory, and the one place they meet. Search resolves candidates from B, then asks A for the bytes of the winners only."
            >
              <TwoMaps />
            </Figure>
          </div>
        </Reveal>
      </Section>

      {/* ============================================================ 02 */}
      <Section meta={S.record!}>
        <Head
          title={
            <>
              What a document <em className="italic">actually is</em> once it
              lands
            </>
          }
          lede="One line of JSON in a file called segment-0000.log, and four numbers in memory that say where to find it."
        />

        <Reveal>
          <Figure
            n="02.1"
            cap="The record, the byte range that describes it, and the newline that is deliberately outside that range."
          >
            <RecordAnatomy />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-6">
            <div className="prose">
              <h4>The length stops at the closing brace</h4>
              <p>
                Records are separated by newlines, so the file is valid NDJSON
                and you can read it with <code>tail</code>. But{" "}
                <code>length</code> counts only the JSON itself. That way the
                buffer handed to <code>JSON.parse</code> holds exactly one
                object and nothing else, with no trimming step that could go
                wrong on the last record in a file.
              </p>
              <h4>Many readers, one writer</h4>
              <p>
                <code>Storage</code> keeps a read-only file descriptor per
                segment in <code>this.readFds</code>, so a hot read never pays
                for <code>open</code>. It keeps exactly one write descriptor,
                on the newest segment, in append mode. That asymmetry removes
                the need for any lock: writes only ever touch the end of one
                file, and reads only ever touch bytes that are already final.
              </p>
              <h4>An id carries no order, and that is a real cost</h4>
              <p>
                Every id comes from <code>randomUUID()</code>. Random ids spread
                evenly and never collide, which is what you want. They also mean
                two documents written a second apart sort next to each other by
                pure accident. There is no way to ask for &quot;every document
                after this one&quot; without a full pass, and{" "}
                <code>liveDocIds()</code> returns insertion order because that
                is what a JavaScript <code>Map</code> happens to preserve, not
                because anything guarantees it. A monotonic id would buy range
                scans and cursor pagination. Shardly does not need them, so it
                does not have them.
              </p>
            </div>
          </div>
          <div className="c-6">
            <pre className="code">
{`// src/storage/storage.ts

`}<span className="c">{`// The whole read path.`}</span>{`
read(docId: string): Document | null {
  `}<span className="k">const</span>{` entry = this.offsetIndex.get(docId);
  `}<span className="k">if</span>{` (!entry || entry.deleted) `}<span className="k">return</span>{` null;

  `}<span className="k">const</span>{` fd  = this.readFd(entry.segment);
  `}<span className="k">const</span>{` buf = Buffer.allocUnsafe(entry.length);
  fs.readSync(fd, buf, 0, entry.length, entry.byteOffset);

  `}<span className="k">return</span>{` (JSON.parse(buf.toString(`}<span className="s">{`"utf8"`}</span>{`))
    `}<span className="k">as</span>{` StoredDocument).doc;
}`}
            </pre>
            <div className="cols" style={{ marginTop: 26 }}>
              <div className="c-6">
                <Stat v="1" u="syscall per read" />
              </div>
              <div className="c-6">
                <Stat v="0" u="neighbours parsed" />
              </div>
            </div>
          </div>
        </div>

        <Reveal>
          <div style={{ marginTop: 44 }}>
            <LabSeek />
          </div>
        </Reveal>
      </Section>

      {/* ============================================================ 03 */}
      <Section meta={S.append!}>
        <Head
          title={
            <>
              Appending is the only write that is{" "}
              <em className="italic ac">cheap and safe</em> at once
            </>
          }
          lede="An in-place update has to fit, or move. Both paths need the old state and the new state to be consistent if the power fails between them."
        />

        <Reveal>
          <Figure
            n="03.1"
            cap="The rejected design on the left, the chosen one on the right. Appending moves the problem from correctness to housekeeping."
          >
            <AppendVsUpdate />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-4">
            <div className="prose">
              <h4>Why 64 MiB, and not any other number</h4>
              <p>
                <code>SEGMENT_MAX_BYTES</code> caps each file at 64 MiB. Nothing
                in the read path cares how large a segment is, because reads
                seek directly to an offset. The cap is not a performance knob.
              </p>
              <p>
                It exists so compaction has units to work with, and so a
                corrupted file loses a bounded amount of data instead of
                everything. Pick 4 GiB and one bad sector takes the corpus. Pick
                1 MiB and you drown in file descriptors.
              </p>
            </div>
          </div>
          <div className="c-4">
            <div className="prose">
              <h4>The file is the authority on its own size</h4>
              <p>
                <code>openCurrentSegment()</code> sets{" "}
                <code>currentSegmentSize</code> from{" "}
                <code>fs.statSync(p).size</code>, never from the snapshot. This
                looks like a detail and is not.
              </p>
              <p>
                Recovery can restore a write the snapshot never saw. If the next
                append trusted the snapshot, it would place a new record on top
                of a live one and silently destroy it. Asking the filesystem
                costs one syscall at startup and removes the entire class of
                bug.
              </p>
            </div>
          </div>
          <div className="c-4">
            <div className="cut panel" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 16 }}>
                The bill for appending
              </p>
              <div className="prose">
                <p>
                  Space is never reclaimed until you compact. A store that
                  deletes as much as it writes grows without bound.
                </p>
                <p>
                  That is a real cost, paid in disk, on a schedule you choose.
                  The alternative was a cost paid in correctness, on a schedule
                  the power company chooses.
                </p>
              </div>
              <div style={{ marginTop: 20, opacity: 0.6 }}>
                <CircleField />
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 04 */}
      <Section meta={S.wal!}>
        <Head
          title={
            <>
              A single write to disk{" "}
              <em className="italic">is not atomic</em>
            </>
          }
          lede="The power can fail with half a JSON object on disk, and nothing about those bytes says they are half. That is the entire problem the write-ahead log solves."
        />

        <div className="cols">
          <div className="c-5">
            <pre className="code">
{`// Storage.append(), in order.

`}<span className="c">{`// 1 · Say where the record is about`}</span>{`
`}<span className="c">{`//     to go, before any of it exists.`}</span>{`
wal.logPending({ docId, segment,
                 byteOffset, length });
fsync(walFd);

`}<span className="c">{`// 2 · Put it there.`}</span>{`
fs.writeSync(segFd, record + `}<span className="s">{`"\\n"`}</span>{`);
fsync(segFd);

`}<span className="c">{`// 3 · Reflect it, then prove it.`}</span>{`
offsetIndex.set(docId, entry);
wal.logCommitted({ docId, segment,
                   byteOffset, length });
fsync(walFd);

`}<span className="c">{`// Only now does write() return.`}</span>{``}
            </pre>
          </div>
          <div className="c-7">
            <div className="prose">
              <h4>Two records per write looks wasteful. It is not.</h4>
              <p>
                Ask what a single record would tell you. A lone &quot;I intend
                to write 231 bytes at offset 4096&quot; leaves recovery unable
                to separate a finished write from a torn one. A lone &quot;I
                wrote 231 bytes at offset 4096&quot; is a lie if the process
                dies before the segment <code>fsync</code> returns, because the
                log entry is durable and the data is not.
              </p>
              <p>
                You need the pair. The pending record bounds{" "}
                <strong>where</strong> the damage can be. The committed record
                proves the damage <strong>is not there</strong>. Neither one is
                enough alone.
              </p>
              <h4>What Shardly actually promises</h4>
              <p>
                <code>write()</code> returns to the caller only after step 3. An
                acknowledged write survives any crash, full stop. A write still
                in flight might survive and might not, and both outcomes are
                correct, because nobody was told it succeeded.
              </p>
              <p>
                That is the whole contract. It is narrower than
                &quot;nothing is ever lost&quot;, and it is the only kind of
                promise a single machine can actually keep.
              </p>
            </div>
          </div>
        </div>

        <Reveal>
          <div style={{ marginTop: 48 }}>
            <LabWal />
          </div>
        </Reveal>
      </Section>

      {/* ============================================================ 05 */}
      <Section meta={S.recovery!}>
        <Head
          title={
            <>
              Recovery, and the case it{" "}
              <em className="italic ac">deliberately drops</em>
            </>
          }
          lede="Two passes over the log. The first trusts, the second interrogates."
        />

        <Reveal>
          <Figure
            n="05.1"
            cap="Committed records are applied without inspection. Pending records without a committed twin face four checks, and one failure discards the record."
          >
            <RecoveryTree />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-7">
            <div className="prose">
              <h4>Why a tombstone is committed from birth</h4>
              <p>
                Delete records are written as <code>committed</code> straight
                away, with no pending phase. A tombstone is a flag in memory,
                and the WAL record is the only durable part of it. There is no
                second file to keep in step, so there is nothing to be
                half-done.
              </p>
              <h4>Where the honesty is</h4>
              <p>
                The four checks confirm structure. They cannot confirm meaning.
                A record that is byte-complete, parses as JSON, and carries the
                right id can still have a flipped bit inside a string value, and
                every check will pass it. Detecting that needs a checksum per
                record, and Shardly does not have one.
              </p>
              <p>
                Adding a CRC to the record format is the single most valuable
                change left in this file. I am saying so here rather than
                letting you discover it.
              </p>
              <h4>A torn tail should not condemn the file</h4>
              <p>
                <code>readAll()</code> swallows parse errors on individual
                lines. That is narrow and intentional. The last line of the log
                is the one most likely to be torn by the exact crash being
                recovered from, and one bad tail should not make the whole log
                unreadable.
              </p>
            </div>
          </div>

          <div className="c-5">
            <div className="cut panel panel-2" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 6 }}>
                Crash harness · npx tsx scripts/crash-test.ts 6
              </p>
              <p className="label" style={{ marginBottom: 24 }}>
                Spawn a writer, SIGKILL it after a random 150 to 550 ms, reopen
                the store, verify every id ever acknowledged.
              </p>
              <div className="cols">
                <div className="c-6" style={{ marginBottom: 22 }}>
                  <Stat v="125,719" u="acknowledged writes" />
                </div>
                <div className="c-6" style={{ marginBottom: 22 }}>
                  <Stat v="6" u="hard kills" />
                </div>
                <div className="c-6">
                  <Stat v="0" u="missing" />
                </div>
                <div className="c-6">
                  <Stat v="0" u="corrupt" />
                </div>
              </div>
            </div>

            <div
              className="cut"
              style={{
                marginTop: 20,
                padding: "22px 24px",
                background: "var(--acc-6)",
                borderColor: "var(--acc-30)",
              }}
            >
              <p className="label label-ac" style={{ marginBottom: 12 }}>
                The bug that made the test lie
              </p>
              <div className="prose">
                <p>
                  The writer acknowledges each id over a pipe.{" "}
                  <code>fs.writeSync</code> on a non-blocking pipe throws{" "}
                  <code>EAGAIN</code> once the parent&apos;s buffer fills.
                </p>
                <p>
                  A dropped acknowledgement does not fail the test. It quietly
                  shrinks the set under test, which is worse, because it looks
                  exactly like success.{" "}
                  <code>scripts/crash-writer.ts</code> retries on{" "}
                  <code>EAGAIN</code> instead of dropping the line. A harness you
                  have not tried to break is a harness you are trusting on
                  faith.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 06 */}
      <Section meta={S.fsync!}>
        <Head
          title={
            <>
              <em className="italic">fsync</em> costs the same for 200 bytes and
              200 kilobytes
            </>
          }
          lede="Which means the number of fsync calls, not the number of bytes, sets the ingest ceiling."
        />

        <Reveal>
          <Figure
            n="06.1"
            cap="Writing 1,000 documents one at a time against writing the same 1,000 through writeBatch(). Each block is one fsync."
          >
            <FsyncMath />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-7">
            <div className="prose">
              <h4>The fiddly part is the arithmetic, not the protocol</h4>
              <p>
                <code>writeBatch()</code> builds the whole NDJSON blob in memory
                first, assigning ids and computing offsets as it goes, rotating
                segments where the 64 MiB cap demands. Every offset is measured
                against <code>this.currentSegmentSize</code> plus{" "}
                <code>Buffer.byteLength(chunk, &quot;utf8&quot;)</code>, which is
                the committed size plus the bytes buffered but not yet flushed.
              </p>
              <p>
                It has to be <code>Buffer.byteLength</code> and not{" "}
                <code>String.length</code>. One multi-byte character puts every
                later offset in the batch off by the difference. That bug is
                invisible on ASCII test data and corrupts every read on real
                text, which is the worst combination a bug can have.
              </p>
            </div>
          </div>
          <div className="c-5">
            <div className="cut panel" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 20 }}>
                npx tsx scripts/seed.ts 20000 /tmp/shardly-demo
              </p>
              <div className="cols">
                <div className="c-6" style={{ marginBottom: 20 }}>
                  <Stat v="20,000" u="documents" />
                </div>
                <div className="c-6" style={{ marginBottom: 20 }}>
                  <Stat v="6.4 s" u="wall clock" />
                </div>
                <div className="c-6">
                  <Stat v="3,100" u="docs per second" />
                </div>
                <div className="c-6">
                  <Stat v="1,000" u="batch size" />
                </div>
              </div>
              <hr className="dot-rule" style={{ margin: "24px 0 18px" }} />
              <p className="label">
                The ordering guarantee never changed. The invariant was never
                &quot;one document at a time&quot;, it was &quot;intent durable
                before data, data durable before commit&quot;.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 07 */}
      <Section meta={S.compact!}>
        <Head
          title={
            <>
              Compaction is four steps, and{" "}
              <em className="italic ac">only one of them commits</em>
            </>
          }
          lede="Deleting a document sets a flag. The bytes stay. Compaction is how the disk finds out."
        />

        <Reveal>
          <Figure
            n="07.1"
            cap="Old files stay complete and readable until the snapshot lands. A crash on either side of step 3 leaves a consistent store."
          >
            <CompactTimeline />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-6">
            <div className="prose">
              <h4>New segments are numbered past the current one</h4>
              <p>
                They start at <code>currentSegmentIndex + 1</code>, so a fresh
                file can never collide with one that live offsets point at. The
                old files are readable through the entire operation. Nothing is
                unlinked until the new snapshot is durable.
              </p>
              <h4>Leaving the orphan is a decision, not an oversight</h4>
              <p>
                A crash before step 3 leaves a partial new segment that nothing
                references. No startup sweep removes it, and that is a choice
                rather than an omission.
              </p>
              <p>
                A sweep that unlinks unreferenced segments is exactly the code
                that deletes real data the day a snapshot goes missing for an
                unrelated reason. Leaving the orphan costs disk. The next
                compaction reclaims it anyway, because it reuses the same number
                and opens with <code>&quot;w&quot;</code>. Even if a normal
                rotation reaches that number first, it opens with{" "}
                <code>&quot;a&quot;</code> and sizes itself from the file, so
                new records land after the dead bytes and every offset stays
                correct.
              </p>
              <p>
                Wasted space, never corruption. I will take that trade every
                time.
              </p>
            </div>
          </div>
          <div className="c-6">
            <div className="cut panel panel-2" style={{ position: "relative" }}>
              <Marks />
              <p className="label label-ac" style={{ marginBottom: 20 }}>
                Measured · 20,000 seeded documents, half deleted
              </p>
              <div className="cols">
                <div className="c-6" style={{ marginBottom: 20 }}>
                  <Stat v="9.75 MB" u="reclaimed" />
                </div>
                <div className="c-6" style={{ marginBottom: 20 }}>
                  <Stat v="141 ms" u="to rewrite" />
                </div>
              </div>
              <hr className="dot-rule" style={{ margin: "6px 0 20px" }} />
              <dl className="dl" style={{ margin: 0 }}>
                <div className="dl-row">
                  <dt>Trigger</dt>
                  <dd>
                    Manual, through <code style={{ color: "var(--accent-hi)" }}>POST /compact</code>. No
                    background thread decides for you.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>Blocking</dt>
                  <dd>
                    Yes. All I/O in Shardly is synchronous, so a compaction
                    stalls every concurrent request for its duration.
                  </dd>
                </div>
                <div className="dl-row">
                  <dt>Commit point</dt>
                  <dd style={{ color: "var(--accent)" }}>
                    snapshot(), step 3 of 4
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ 08 */}
      <Section meta={S.snapshot!}>
        <Head
          title={
            <>
              Counting documents{" "}
              <em className="italic">cannot</em> tell you a snapshot is current
            </>
          }
          lede="Delete one document, add another, and the count matches while the contents do not. That case is not hypothetical, it is what a normal workload does all day."
        />

        <Reveal>
          <Figure
            n="08.1"
            cap="The check that failed, above. The monotonic version counter that replaced it, below."
          >
            <VersionGuard />
          </Figure>
        </Reveal>

        <div className="cols" style={{ marginTop: 44 }}>
          <div className="c-6">
            <div className="prose">
              <h4>Renaming a file is atomic, and that is not the same as durable</h4>
              <p>
                <code>writeJsonAtomic()</code> writes to{" "}
                <code>${"{"}target{"}"}.tmp</code>, calls <code>fsync</code> on
                it, renames it over the target, and then calls{" "}
                <code>fsync</code> on the parent directory. That last step is
                easy to skip and it matters here more than usual.
              </p>
              <p>
                A rename is atomic with respect to readers, but the directory
                entry is not durable until the directory itself is flushed.{" "}
                <code>snapshot()</code> truncates the write-ahead log
                immediately afterward. Without the directory{" "}
                <code>fsync</code>, a power failure in that gap loses the
                snapshot <em>and</em> the log that would have rebuilt it. Two
                durable-looking writes, zero durable state.
              </p>
            </div>
          </div>
          <div className="c-6">
            <div className="prose">
              <h4>Why the two snapshots are not written atomically together</h4>
              <p>
                The offset snapshot and the inverted-index snapshot are written
                in sequence. A crash between them leaves a fresh offset file
                next to a stale index file.
              </p>
              <p>
                The version check catches that on the next start and rebuilds.
                Making the pair atomic would need a two-phase write across two
                files for no gain, because the inverted index is derived data.
                Rebuilding it is always safe and never wrong. Spending
                complexity to protect something you can always regenerate is how
                storage layers get hard to read.
              </p>
              <h4>The rule</h4>
              <p>
                <code>SNAPSHOT_EVERY_N_WRITES</code> is 500. Anything other than
                an exact version match rebuilds the index from the segments.
                Equal counts no longer pass for equal state.
              </p>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 56 }}>
          <Scale label="END OF PART ONE · STORAGE AND DURABILITY" />
        </div>
      </Section>
    </>
  );
}
