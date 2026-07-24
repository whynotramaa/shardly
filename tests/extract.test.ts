import { describe, it, expect } from "vitest";
import { extractDocuments } from "../src/ingest/extract.js";

/** Build a minimal but valid single-page PDF with correct xref offsets, so the
 * test exercises real PDF text extraction rather than a mock. */
function buildMinimalPdf(text: string): Buffer {
  const header = "%PDF-1.4\n";
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "";
  const offsets: number[] = [];
  let pos = Buffer.byteLength(header, "latin1");
  objects.forEach((o, i) => {
    const obj = `${i + 1} 0 obj\n${o}\nendobj\n`;
    offsets.push(pos);
    body += obj;
    pos += Buffer.byteLength(obj, "latin1");
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "latin1");
}

describe("extractDocuments", () => {
  it("decodes a plain text file", async () => {
    const r = await extractDocuments("notes.txt", Buffer.from("hello storage world"));
    expect(r.status).toBe("indexed");
    expect(r.docs).toEqual([{ filename: "notes.txt", content: "hello storage world" }]);
  });

  it("keeps a JSON object structured and tags the filename", async () => {
    const r = await extractDocuments(
      "doc.json",
      Buffer.from(JSON.stringify({ title: "Report", body: "revenue" })),
    );
    expect(r.status).toBe("indexed");
    expect(r.docs).toEqual([
      { title: "Report", body: "revenue", filename: "doc.json" },
    ]);
  });

  it("splits a JSON array into multiple documents", async () => {
    const r = await extractDocuments("many.json", Buffer.from(JSON.stringify([{ a: 1 }, { b: 2 }])));
    expect(r.docs).toHaveLength(2);
    expect(r.docs[1]).toEqual({ b: 2, filename: "many.json" });
  });

  it("parses ndjson line by line", async () => {
    const r = await extractDocuments(
      "log.ndjson",
      Buffer.from('{"x":1}\n\n{"y":2}\n'),
    );
    expect(r.docs).toHaveLength(2);
  });

  it("skips a binary file instead of indexing garbage", async () => {
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff, 0x00]);
    const r = await extractDocuments("image.png", bin);
    expect(r.status).toBe("skipped");
    expect(r.docs).toHaveLength(0);
    expect(r.reason).toMatch(/binary/i);
  });

  it("skips an empty file", async () => {
    const r = await extractDocuments("empty.txt", Buffer.from(""));
    expect(r.status).toBe("skipped");
  });

  it("extracts real text from a PDF", async () => {
    const pdf = buildMinimalPdf("Hello Shardly PDF extraction test");
    const r = await extractDocuments("paper.pdf", pdf);
    expect(r.status).toBe("indexed");
    expect(r.docs).toHaveLength(1);
    const content = String(r.docs[0]!.content);
    expect(content).toContain("Shardly");
    expect(content).toContain("extraction");
    expect(r.docs[0]!.type).toBe("pdf");
  });
});
