import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractDocuments, excludedPath } from "../src/ingest/extract.js";
import { visibleHtml, delimitedRows } from "../src/ingest/formats.js";
import { extractIsolated } from "../src/runtime/extraction.js";

const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)]))));

it("extracts visible HTML and multiline CSV records without indexing executable markup", async () => {
  expect(visibleHtml('<h1>Guide</h1><script>hiddenneedle</script><p>Visible &amp; useful</p><div hidden>secret <span>nested</span></div><p>after</p>')).toBe("Guide\n\nVisible & useful\n\nafter");
  const html = await extractDocuments("guide.html", Buffer.from('<p>hello</p><style>badneedle</style>'));
  expect(html.docs[0]?.content).toBe("hello");
  const csv = await extractDocuments("records.csv", Buffer.from('name,note\r\nAlice,"line one\nline two, with ""quote"""\r\n'));
  expect(csv.docs).toHaveLength(1);
  expect(csv.docs[0]?.content).toContain('note: line one\nline two, with "quote"');
  expect(csv.docs[0]?.row).toBe(2);
  expect(() => delimitedRows('x,"bad', ",")).toThrow();
});

it("extracts real zipped Office XML with slide and spreadsheet source locations", async () => {
  const docx = await extractDocuments("guide.docx", zip({ "word/document.xml": '<w:document><w:p><w:r><w:t>Durable recovery</w:t></w:r></w:p></w:document>' }));
  expect(docx.docs[0]?.content).toBe("Durable recovery");
  const pptx = await extractDocuments("slides.pptx", zip({ "ppt/slides/slide2.xml": '<p:sld><a:p><a:r><a:t>Slide evidence</a:t></a:r></a:p></p:sld>', "ppt/slides/_rels/slide2.xml.rels": '<Relationships><Relationship Type="example/notesSlide" Target="../notesSlides/notesSlide4.xml"/></Relationships>', "ppt/notesSlides/notesSlide4.xml": '<a:p><a:t>Speaker note</a:t></a:p>' }));
  expect(pptx.docs[0]).toMatchObject({ slide: 2, content: "Slide evidence", notes: "Speaker note" });
  const xlsx = await extractDocuments("data.xlsx", zip({ "xl/workbook.xml": '<workbook><sheets><sheet name="Revenue" r:id="sheet1"/></sheets></workbook>', "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>', "xl/sharedStrings.xml": '<sst><si><t>Total revenue</t></si></sst>', "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><f>SUM(B1)</f><v>42</v></c></row></sheetData></worksheet>' }));
  expect(xlsx.docs[0]).toMatchObject({ sheet: "Revenue", row: 2, content: "A2: Total revenue\nB2: 42" });
  expect((xlsx.docs[0]?.cells as unknown[])[1]).toMatchObject({ cell: "B2", formula: "SUM(B1)", value: "42" });
});

it("blocks unsafe XML declarations, secret paths, and reports isolated extraction results", async () => {
  const bad = await extractDocuments("bad.docx", zip({ "word/document.xml": '<!DOCTYPE x [<!ENTITY x "payload">]><w:p><w:t>&x;</w:t></w:p>' }));
  expect(bad.status).toBe("skipped");
  for (const name of [".env", "src/.env.local", ".ssh/id_rsa", "node_modules/module/index.js", "private.key"]) expect(excludedPath(name)).toBe(true);
  expect(excludedPath("src/environment.ts")).toBe(false);
  const result = await extractIsolated("isolated.md", Buffer.from("# Search\n\nworker evidence"));
  expect(result.docs[0]?.content).toContain("worker evidence");
});

it("extracts MIME email, RTF, and EPUB chapters from actual format payloads", async () => {
  const email = await extractDocuments("message.eml", Buffer.from("From: Alice <alice@example.com>\r\nTo: Bob <bob@example.com>\r\nSubject: Recovery guide\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nDurable email evidence."));
  expect(email.docs[0]).toMatchObject({ type: "email", title: "Recovery guide", content: "Durable email evidence." });
  const rtf = await extractDocuments("guide.rtf", Buffer.from('{\\rtf1\\ansi Durable \\b recovery\\b0 evidence.}'));
  expect(rtf.docs[0]?.content).toContain("recovery");
  const epub = await extractDocuments("guide.epub", zip({
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
    "OEBPS/book.opf": '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
    "OEBPS/chapter.xhtml": '<html><body><h1>Recovery</h1><p>Chapter evidence</p><script>badneedle</script></body></html>',
  }));
  expect(epub.docs[0]).toMatchObject({ type: "epub", chapter: 1, path: "OEBPS/chapter.xhtml" });
  expect(epub.docs[0]?.content).toContain("Chapter evidence");
  expect(epub.docs[0]?.content).not.toContain("badneedle");
});

it.skipIf(spawnSync("tesseract", ["--version"]).error !== undefined || spawnSync("pdftoppm", ["-v"]).error !== undefined)("OCRs an image-only PDF with real installed tools and labels the extracted mapping", async () => {
  const { readFileSync } = await import("node:fs");
  const input = readFileSync(new URL("../fixtures/ocr-search.pdf", import.meta.url));
  const previous = process.env.SHARDLY_OCR;
  try {
    delete process.env.SHARDLY_OCR;
    expect((await extractDocuments("scan.pdf", input)).status).toBe("skipped");
    process.env.SHARDLY_OCR = "1";
    const extracted = await extractDocuments("scan.pdf", input);
    expect(extracted.status).toBe("indexed");
    expect(extracted.docs[0]?.content).toMatch(/Durable recovery evidence/i);
    expect(extracted.docs[0]?._extraction).toMatchObject({ mapping: "ocr-page-text" });
    expect(extracted.docs[0]?.pageOffsets).toEqual([expect.objectContaining({ page: 1, start: 0 })]);
  } finally { if (previous === undefined) delete process.env.SHARDLY_OCR; else process.env.SHARDLY_OCR = previous; }
}, 30000);


it("preserves DOCX heading levels and table cell boundaries", async () => {
  const parsed = await extractDocuments("structured.docx", zip({ "word/document.xml": '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Recovery</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Commit</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Durable</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' }));
  expect(parsed.docs[0]?.content).toContain("## Recovery");
  expect(parsed.docs[0]?.content).toContain("| Commit | Durable |");
});
