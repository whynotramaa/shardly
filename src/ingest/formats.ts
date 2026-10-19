import { parseDocument, DomUtils, Parser } from "htmlparser2";
import { unzipSync } from "fflate";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Document } from "../types.js";
import { simpleParser } from "mailparser";
import rtf from "rtf-parser";

const exec = promisify(execFile);
const meta = (parser: string) => ({ parser, version: 1, mapping: "extracted-text" });

export async function emailDocument(filename: string, buffer: Buffer): Promise<Document> {
  const mail = await simpleParser(buffer, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  if (mail.attachments.length > 100) throw new Error("email exceeds attachment metadata budget");
  return { filename, type: "email", title: mail.subject ?? filename, sender: mail.from?.text, recipients: mail.to ? (Array.isArray(mail.to) ? mail.to.map(value => value.text).join(", ") : mail.to.text) : undefined, sentAt: mail.date?.toISOString(), content: mail.text ?? (mail.html ? visibleHtml(mail.html) : ""), _extraction: { ...meta("mailparser"), attachments: mail.attachments.map(a => ({ filename: a.filename, bytes: a.size, contentType: a.contentType })), warnings: ["Attachments require separate import."] } };
}

export async function richText(input: string): Promise<string> {
  if (!/^\s*\{\\rtf/.test(input)) throw new Error("invalid RTF header");
  return new Promise((resolve, reject) => rtf.string(input, (error, document) => {
    if (error) { reject(error); return; }
    try {
      const text = (node: { value?: string; content?: typeof document.content }): string => node.value ?? node.content?.map(text).join("") ?? "";
      resolve(document.content.map(node => text(node) + (node.content ? "\n" : "")).join("").trim());
    } catch (failure) { reject(failure); }
  }));
}

export function epubDocuments(filename: string, buffer: Buffer): Document[] {
  let bytes = 0, entries = 0;
  const files = unzipSync(buffer, { filter(info) { if (++entries > 10000 || info.originalSize > 16 * 1024 * 1024 || (bytes += info.originalSize) > 64 * 1024 * 1024) throw new Error("EPUB exceeds extraction budget"); return /\.(xml|opf|html|xhtml|htm)$/.test(info.name); } });
  const xml = (name: string) => {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(files[name] ?? new Uint8Array());
    if (/<!ENTITY/i.test(content)) throw new Error("EPUB entities are not supported");
    return parseDocument(content, { xmlMode: true, decodeEntities: true });
  };
  const packagePath = DomUtils.getElementsByTagName("rootfile", xml("META-INF/container.xml"), true)[0]?.attribs["full-path"];
  if (!packagePath || !files[packagePath]) throw new Error("invalid EPUB package");
  const root = xml(packagePath), manifest = DomUtils.getElementsByTagName("item", root, true);
  return DomUtils.getElementsByTagName("itemref", root, true).flatMap((item, i) => {
    const href = manifest.find(node => node.attribs.id === item.attribs.idref)?.attribs.href;
    const entry = href ? path.posix.normalize(path.posix.join(path.posix.dirname(packagePath), decodeURIComponent(href.split("#")[0]!))) : "";
    if (!files[entry]) return [];
    return [{ filename, type: "epub", chapter: i + 1, path: entry, content: visibleHtml(new TextDecoder("utf-8", { fatal: true }).decode(files[entry])), _extraction: meta("epub-spine") }];
  });
}

export function visibleHtml(input: string): string {
  let out = "", hidden = 0;
  const parser = new Parser({
    onopentag(name, attributes) { if (hidden || ["script", "style", "template", "noscript"].includes(name) || attributes.hidden !== undefined || attributes["aria-hidden"] === "true") hidden++; else if (["h1", "h2", "h3", "p", "div", "li", "tr", "br"].includes(name)) out += "\n"; },
    ontext(text) { if (!hidden) out += text; },
    onclosetag(name) { if (hidden) hidden--; else if (["p", "div", "li", "tr", "h1", "h2", "h3"].includes(name)) out += "\n"; },
  }, { decodeEntities: true });
  parser.write(input); parser.end();
  return out.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
}

export function delimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || cell.length === 0) quoted = !quoted; else throw new Error("invalid quote in delimited file"); }
    else if (!quoted && (c === delimiter || c === "\n" || c === "\r")) {
      row.push(cell); cell = "";
      if (c !== delimiter) { if (c === "\r" && text[i + 1] === "\n") i++; rows.push(row); row = []; }
    } else cell += c;
    if (rows.length > 100000 || cell.length > 4 * 1024 * 1024) throw new Error("delimited file exceeds extraction budget");
  }
  if (quoted) throw new Error("unterminated quoted field");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function officeDocuments(filename: string, buffer: Buffer, ext: string): Document[] {
  let expanded = 0, entries = 0;
  const zip = unzipSync(buffer, { filter(info) {
    if (++entries > 10000 || info.originalSize > 16 * 1024 * 1024 || (expanded += info.originalSize) > 64 * 1024 * 1024) throw new Error("archive exceeds extraction budget");
    return /\.(xml|rels)$/.test(info.name) && !/(^|\/)\.\.(\/|$)/.test(info.name);
  } });
  const xml = (name: string) => {
    const content = zip[name];
    if (!content) return parseDocument("", { xmlMode: true });
    const value = new TextDecoder("utf-8", { fatal: true }).decode(content);
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error("XML declarations with entities are not supported");
    return parseDocument(value, { xmlMode: true, decodeEntities: true });
  };
  const text = (name: string, paragraph: string) => DomUtils.getElementsByTagName(paragraph, xml(name), true).map(node => DomUtils.getElementsByTagName(n => ["w:t", "a:t", "text:p"].includes(n), node, true).map(DomUtils.textContent).join(" ")).join("\n");
  if (ext === "docx") {
    if (!zip["word/document.xml"]) throw new Error("invalid DOCX package");
    const root = xml("word/document.xml");
    const paragraphs = (node: Parameters<typeof DomUtils.textContent>[0]) => DomUtils.getElementsByTagName("w:p", node, true).map(paragraph => {
      const value = DomUtils.getElementsByTagName("w:t", paragraph, true).map(DomUtils.textContent).join("");
      const style = DomUtils.getElementsByTagName("w:pStyle", paragraph, true)[0]?.attribs["w:val"];
      const level = /^Heading([1-6])$/i.exec(style ?? "")?.[1];
      return level ? `${"#".repeat(Number(level))} ${value}` : value;
    }).join("\n");
    const body = DomUtils.getElementsByTagName("w:body", root, true)[0] ?? DomUtils.getElementsByTagName("w:document", root, true)[0];
    const content = body?.children.map(node => {
      if ("name" in node && node.name === "w:tbl") {
        return DomUtils.getElementsByTagName("w:tr", node, true).map(row => "| " + row.children.filter(cell => "name" in cell && cell.name === "w:tc").map(cell => paragraphs(cell).replace(/\n/g, " ")).join(" | ") + " |").join("\n");
      }
      return paragraphs(node);
    }).filter(Boolean).join("\n\n") ?? paragraphs(root);
    return [{ filename, type: "docx", content, _extraction: meta("office-xml") }];
  }
  if (ext === "pptx") {
    return Object.keys(zip).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1])).map(name => {
      const slide = Number(name.match(/(\d+)\.xml$/)![1]);
      const note = DomUtils.getElementsByTagName("Relationship", xml(`ppt/slides/_rels/slide${slide}.xml.rels`), true).find(r => r.attribs.Type?.endsWith("/notesSlide"))?.attribs.Target;
      const noteFile = note ? path.posix.normalize(note.startsWith("/") ? note.slice(1) : `ppt/slides/${note}`) : "";
      return { filename, type: "pptx", slide, title: `${filename}, slide ${slide}`, content: text(name, "a:p"), notes: noteFile.startsWith("ppt/notesSlides/") ? text(noteFile, "a:p") : "", _extraction: meta("office-xml") };
    });
  }
  if (!zip["xl/workbook.xml"]) throw new Error("invalid XLSX package");
  const strings = DomUtils.getElementsByTagName("si", xml("xl/sharedStrings.xml"), true).map(DomUtils.textContent);
  const sheets = DomUtils.getElementsByTagName("sheet", xml("xl/workbook.xml"), true);
  const relationships = DomUtils.getElementsByTagName("Relationship", xml("xl/_rels/workbook.xml.rels"), true);
  const documents: Document[] = [];
  for (const sheet of sheets) {
    const target = relationships.find(r => r.attribs.Id === sheet.attribs["r:id"])?.attribs.Target;
    const sheetFile = target ? path.posix.normalize(target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "";
    if (!sheetFile.startsWith("xl/worksheets/")) continue;
    for (const row of DomUtils.getElementsByTagName("row", xml(sheetFile), true)) {
      const cells = DomUtils.getElementsByTagName("c", row, true).map(cell => {
        const v = DomUtils.getElementsByTagName("v", cell, true)[0];
        const raw = v ? DomUtils.textContent(v) : DomUtils.getElementsByTagName("t", cell, true).map(DomUtils.textContent).join("");
        const formula = DomUtils.getElementsByTagName("f", cell, true)[0];
        return { cell: cell.attribs.r ?? "", value: cell.attribs.t === "s" ? strings[Number(raw)] ?? "" : raw, formula: formula ? DomUtils.textContent(formula) : undefined };
      });
      documents.push({ filename, type: "xlsx", sheet: sheet.attribs.name, row: Number(row.attribs.r), title: `${filename}, ${sheet.attribs.name} row ${row.attribs.r}`, content: cells.map(c => `${c.cell}: ${c.value}`).join("\n"), cells, _extraction: meta("office-xml") });
      if (documents.length > 100000) throw new Error("workbook exceeds row budget");
    }
  }
  return documents;
}

export async function ocrPdf(buffer: Buffer, pages: number): Promise<string[]> {
  if (pages > 50) throw new Error("OCR exceeds 50-page budget; split the document");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shardly-ocr-"));
  try {
    const file = path.join(dir, "input.pdf"); await fs.writeFile(file, buffer, { mode: 0o600 });
    await exec("pdftoppm", ["-f", "1", "-l", String(pages), "-scale-to", "2000", "-png", file, path.join(dir, "page")], { timeout: 45000, maxBuffer: 1024 * 1024 });
    const images = (await fs.readdir(dir)).filter(name => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const result = [];
    for (const image of images) result.push((await exec("tesseract", [path.join(dir, image), "stdout", "-l", process.env.SHARDLY_OCR_LANG ?? "eng"], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim());
    return result;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
