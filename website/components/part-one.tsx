import { Chapter, Drawing, TableScroll } from "./guide";
import EngineeringScene from "./engineering-scene";
import LabSeek from "./lab-seek";
import LabTokenizer from "./lab-tokenizer";
import LabBm25 from "./lab-bm25";

export default function PartOne() {
  return <>
    <Chapter id="ingest" title="Receive a document" files={["src/ingest/extract.ts", "src/ingest/formats.ts", "src/ingest/folders.ts"]}>
      <p>A search engine needs text before it can build an index. Shardly accepts JSON documents directly, or extracts text and metadata from uploaded files. The original file and the searchable document are different things. A PDF becomes extracted fields, not a complete copy of its page layout.</p>
      <p>Consider a note with the sentence “The WAL records each write.” We will follow that note through storage, search, and evidence retrieval. The examples use small, illustrative documents so you can inspect each step.</p>
      <h3>What extraction preserves</h3>
      <p>The parser depends on the file format. Keeping useful boundaries makes a search result easier to locate in its source.</p>
      <TableScroll label="Supported extraction formats"><table><caption>Supported extraction paths and their boundaries.</caption><thead><tr><th>Input</th><th>Searchable representation</th><th>Boundary</th></tr></thead><tbody>
        <tr><td>DOCX</td><td>Heading and table boundaries</td><td>No page-layout reconstruction</td></tr>
        <tr><td>PPTX</td><td>Slide text and speaker notes</td><td>No visual slide interpretation</td></tr>
        <tr><td>XLSX</td><td>Sheet, cell, value, and formula metadata</td><td>No workbook calculation engine</td></tr>
        <tr><td>HTML, CSV, TSV</td><td>Visible HTML text and structured rows</td><td>CSV supports quoted multiline cells</td></tr>
        <tr><td>RTF, EML, EPUB</td><td>Rich text, email fields, and book text</td><td>Email attachments need separate import</td></tr>
        <tr><td>PDF</td><td>Embedded text, or optional OCR</td><td>No full complex-layout recovery</td></tr>
      </tbody></table></TableScroll>
      <p><strong>Optical character recognition</strong>, or OCR, extracts text from page images. It is optional and needs installed Poppler and Tesseract tools, plus <code>SHARDLY_OCR=1</code>. Shardly limits OCR to 50 pages. It does not return word coordinates or confidence scores. A scanned page may still need a better source or manual correction.</p>
      <h3>Give the document a stable identity</h3>
      <p>An import has a source namespace and stable record keys. These let an update replace the intended document instead of creating another copy. The workspace defaults to adding documents. The legacy upload API defaults to replacing matching records. Choose the mode explicitly when integrating a client.</p>
      <p>Replacement has a precise boundary. An upload does not delete old rows that are missing from the new file. A managed folder source does reconcile missing files. Malformed newline-delimited JSON rejects extraction rather than silently dropping the bad line.</p>
      <p>Folder sources inspect paths on the API server. They poll file metadata every two seconds, follow Git ignore rules, and skip symbolic links. A preflight failure preserves the last good source. The folder staging limits are 10,000 supported files and 256 MiB. One MiB is 1,048,576 bytes.</p>
      <p>Secret-like paths and generated directories are skipped by default. A trusted local operator can explicitly include sensitive files. These rules reduce accidental intake. They do not replace access controls once a document enters the store.</p>
    </Chapter>

    <Chapter id="record" title="Put its bytes on disk" files={["src/storage/storage.ts", "src/types.ts", "src/config.ts"]}>
      <p>The storage layer appends serialized records to segment files. A segment is a file containing a sequence of records. Segments rotate at 64 MiB, so one file does not grow without a normal rotation boundary.</p>
      <p>An in-memory offset map connects each document ID to a segment, byte offset, and record length. The map tells the reader which range to load. Finding that range does not require scanning every document.</p>
      <p>Choose a document below to inspect the offset lookup. These byte lengths are illustrative, not measurements of the current data directory.</p>
      <Drawing caption="An illustrative segment and its offset entries. A deleted entry prevents a document read, even while old bytes remain on disk."><LabSeek /></Drawing>
      <p>The map lookup takes constant expected time. Reading, decoding, and checking the record still costs time proportional to its bytes. A large document does not become free to read because its offset is easy to find.</p>
      <p>Updates append another record and change the current offset. Deletion writes a deletion record and marks the document unavailable. Earlier bytes remain until compaction removes obsolete records. This avoids rewriting the segment for every small change.</p>
      <p>Only one writer can own a data directory. The directory lock prevents another engine from independently changing the same storage files. Read-only tools use the running API instead of opening another writer.</p>
    </Chapter>

    <Chapter id="wal" title="Make the write durable" files={["src/storage/storage.ts", "src/storage/wal.ts", "tests/storage.test.ts"]}>
      <p>Appending a record is not enough to promise durability. The process can stop between writing the bytes and updating its maps. Shardly needs enough information on disk to decide what happened when it opens again.</p>
      <p>A <strong>write-ahead log</strong>, or WAL, records an intended write before the segment changes. The filesystem synchronization operation, <code>fsync</code>, asks the operating system to synchronize file data with storage. The engine uses it in a defined order.</p>
      <p>The sequence below separates the three synchronization phases from the final acknowledgement.</p>
      <Drawing caption="The write protocol, slowed for reading. The diagram shows ordering, not the relative duration of disk operations."><EngineeringScene kind="write" /></Drawing>
      <p>A batch shares synchronization work within each phase. It still needs the pending log, segment data, and committed log to reach their required states. “One sync per batch” would describe the protocol incorrectly.</p>
      <h3>Recovery follows the durable evidence</h3>
      <p>If an intact pending record reached the segment, recovery can apply it even when the caller never received success. If the pending record is torn, recovery discards it. If a committed record is corrupt, the store fails closed rather than serving it as valid data.</p>
      <p>New records carry checksums so recovery can detect byte changes. Older records can lack these checksums until they are rewritten. A checksum detects corruption. It does not create another healthy copy of the data.</p>
      <p>A missing response therefore does not prove that a write failed. A client retry needs a stable identity and a deliberate replacement policy. This is especially relevant when a connection closes after the commit but before the response arrives.</p>
      <p>The recorded process-kill drill tests abrupt process termination. It does not simulate every filesystem, drive, controller, or physical power-loss failure. Independent backups still matter.</p>
    </Chapter>

    <Chapter id="compact" title="Maintain the store" files={["src/storage/storage.ts", "src/engine.ts", "src/search/index.ts"]}>
      <p>Append-only storage accumulates records that are no longer current. <strong>Compaction</strong> copies live records into new segments and builds a replacement offset snapshot. Publishing that snapshot is the commit point for the replacement storage view.</p>
      <p>The implementation coordinates snapshot renaming, directory synchronization, and rollback around that point. It keeps the old view usable until the replacement can be published. Compaction yields after every 16 live records so other worker requests can run between batches.</p>
      <p>A yield is a scheduling opportunity, not a maximum latency guarantee. Copying one large record and publishing a snapshot still contain synchronous work. Searches can proceed between batches, but a single worker does not execute all operations at once.</p>
      <h3>Stored documents and derived indexes have different roles</h3>
      <p>The stored records are the source for rebuilding search. A compatible lexical snapshot speeds startup by restoring a derived index. An incompatible snapshot is rebuilt from storage, rather than being treated as the only copy of the documents.</p>
      <p>An explicit search rebuild constructs a shadow index while the published index remains available. Before publication, it checks that the storage generation still matches. A generation change prevents a stale rebuild from replacing a current index.</p>
      <p>The tradeoff is memory. The old and replacement indexes coexist during a shadow rebuild. Postings and metadata also remain memory-resident during normal operation. The full-document cache has separate limits of 128 records and an 8 MiB serialized-text estimate. Those limits do not cap the engine’s total memory.</p>
    </Chapter>

    <Chapter id="token" title="Build the search index" files={["src/search/tokenizer.ts", "src/search/index.ts", "tests/website-analyzer.test.ts"]}>
      <p>The stored sentence remains readable text. Search builds another representation from it. A <strong>token</strong> is an analyzed term that the index can match. English analysis normalizes Unicode text, removes common stopwords, applies simple suffix rules, and splits identifiers into useful parts.</p>
      <p>The original sentence and the analyzed terms have different jobs. The sentence supplies evidence. The terms help find candidates. In the illustrative sequence below, “The” is removed and “records” becomes “record.”</p>
      <Drawing caption="English analysis and a small inverted index. The example is simplified to one field and one document; positions and field metadata are retained by the real engine."><EngineeringScene kind="index" /></Drawing>
      <p>An <strong>inverted index</strong> maps a term to its occurrences across documents. A posting identifies a document and its term information. Shardly keeps packed postings in memory, including information used by field and passage ranking.</p>
      <p>Try the English analyzer below. Its browser implementation has a parity test against the engine tokenizer. The lab explains that path; it does not simulate every locale setting.</p>
      <Drawing caption="The English analysis lab. Change the text to inspect which words survive and which suffix or identifier rules apply."><LabTokenizer /></Drawing>
      <p>Removing common words makes the index smaller, but it also removes distinctions. Simple stemming is not a complete language model. For example, suffix rules cannot reliably recover every irregular word form.</p>
      <p>The engine supports ten explicit content locales with platform segmentation for non-English text. It does not apply the English stemmer to every language. This is implementation support, not a measured claim about multilingual retrieval quality.</p>
      <p>Search also keeps offsets in the original field. These use JavaScript UTF-16 positions, which can differ from byte positions and visible character counts. Evidence extraction uses those original offsets rather than trying to reconstruct text from stems.</p>
    </Chapter>

    <Chapter id="bm25" title="Choose the results" files={["src/search/rank.ts", "src/search/index.ts", "src/engine.ts"]}>
      <p>A query looks up its analyzed terms and collects matching candidates. Finding a match does not decide which result should come first. A document repeating one common word should not automatically outrank a concise passage that answers the query.</p>
      <p><strong>BM25</strong> is a lexical ranking formula. It gives more weight to terms that appear in fewer documents. Repeated occurrences help, but their extra contribution decreases. Document length affects the normalization, so longer documents do not win simply by containing more words.</p>
      <p>The baseline uses <code>k1 = 1.5</code> and <code>b = 0.75</code>. The first parameter controls term-frequency saturation. The second controls length normalization. Move the controls to see those effects separately.</p>
      <Drawing caption="A baseline BM25 lab with illustrative inputs. These curves explain the formula; they are not a benchmark of the full tuned ranker."><LabBm25 /></Drawing>
      <p>The tuned path also considers fields and passage windows. A title match and a body match can contribute differently. A local passage can be useful even when the full document covers several unrelated subjects.</p>
      <p>A bounded heap retains the highest-scoring results without sorting every candidate into a complete result list. The ranker still visits matching candidates. Building explanations only for selected results saves explanation work, not the cost of scoring every possible match.</p>
      <h3>Use the matching mode that fits the question</h3>
      <p>Literal and substring search answer a different question from lexical ranking. They inspect scoped text directly and are bounded to 2,000 documents and 8 MiB of UTF-16 text. They are not backed by a dedicated substring index.</p>
      <p>Queries also have execution budgets and work checks. A limit can reject a request instead of allowing unbounded work. A normal result list should not be interpreted as a promise that every search mode exhaustively scanned an arbitrarily large collection.</p>
      <p>Ranking quality depends on the collection and the questions. The measurements at the end show an important example: the tuned path improves the authored repository tasks, while baseline BM25 performs better on SciFact.</p>
    </Chapter>
  </>;
}
