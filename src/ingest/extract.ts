import { extractText, getDocumentProxy } from "unpdf";
import type { Document } from "../types.js";
import { visibleHtml, delimitedRows, officeDocuments, ocrPdf, emailDocument, richText, epubDocuments } from "./formats.js";

export interface ExtractResult {
  parser?: string;
  warnings?: string[];
  filename: string;
  status: "indexed" | "skipped";
  /** Present when skipped — why we couldn't index it. */
  reason?: string;
  /** The documents to index (empty when skipped). */
  docs: Document[];
}

/** Extensions we confidently treat as UTF-8 text (source code, docs, data). */
export const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "csv", "tsv", "rtf",
  "json", "ndjson", "jsonl", "yaml", "yml", "toml", "ini", "env", "xml", "html", "htm",
  "css", "scss", "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cc",
  "cs", "php", "swift", "scala", "sh", "bash", "zsh", "sql", "graphql",
  "vue", "svelte", "dockerfile", "makefile", "gitignore", "lock", "conf",
]);
export const DOCUMENT_EXTENSIONS = new Set([...TEXT_EXTENSIONS, "pdf", "docx", "pptx", "xlsx", "eml", "epub"]);

export function excludedPath(filename: string): boolean {
  return filename.split(/[\\/]/).some(part => /^(node_modules|\.git|\.ssh|\.aws|\.cache|vendor)$/.test(part) || /^\.env(?:\.|$)/i.test(part) || /\.(pem|key|p12|pfx)$/i.test(part) || /^(id_rsa|id_ed25519|credentials)$/i.test(part));
}

export function extensionOf(filename: string): string {
  const base = filename.toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  // Handle dotfiles / extensionless names like "Dockerfile", "Makefile".
  if (dot <= 0) return base;
  return base.slice(dot + 1);
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true; // NUL — definitively binary
    // Allow tab(9), LF(10), CR(13); flag other C0 control chars.
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.3;
}

function withSource(value: unknown, filename: string): Document {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), filename };
  }
  return { filename, content: value };
}

async function extractPdf(filename: string, buffer: Buffer): Promise<ExtractResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  if (totalPages > 1000) throw new Error("PDF exceeds 1000-page extraction budget");
  let pageTexts = Array.isArray(text) ? text : [text ?? ""];
  let ocr = false;
  if (process.env.SHARDLY_OCR === "1" && pageTexts.some(page => !page.trim())) {
    const recognized = await ocrPdf(buffer, totalPages);
    pageTexts = pageTexts.map((page, i) => page.trim() ? page : recognized[i] ?? ""); ocr = true;
  }
  let offset = 0;
  const pageOffsets = pageTexts.map((page, index) => {
    const start = offset;
    offset += page.length + (index < pageTexts.length - 1 ? 2 : 0);
    return { page: index + 1, start, end: start + page.length };
  });
  const content = pageTexts.join("\n\n");
  if (content.trim().length === 0) {
    return {
      filename,
      status: "skipped",
      reason: "no extractable text (likely a scanned/image-only PDF)",
      docs: [],
    };
  }
  return {
    filename,
    status: "indexed",
    parser: ocr ? "unpdf+tesseract" : "unpdf",
    docs: [{ filename, type: "pdf", pages: totalPages, pageOffsets, content, ...(ocr ? { _extraction: { parser: "tesseract", version: 1, mapping: "ocr-page-text" } } : {}) }],
  };
}

export interface ExtractOptions { strictStructured?: boolean }

function extractJson(filename: string, text: string, strict: boolean): Document[] | null {
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((o) => withSource(o, filename));
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

function extractNdjson(filename: string, text: string): Document[] {
  const docs: Document[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const t = line.trim();
    if (!t) continue;
    try {
      docs.push(withSource(JSON.parse(t), filename));
    } catch {
      throw new Error(`invalid JSON on line ${index + 1}`);
    }
  }
  return docs;
}

export async function extractDocuments(
  filename: string,
  buffer: Buffer,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const ext = extensionOf(filename);

  try {
    if (buffer.length > 64 * 1024 * 1024) throw new Error("file exceeds 64 MiB extraction budget");
    if (ext === "eml") return { filename, status: "indexed", parser: "mailparser", warnings: ["Attachments require separate import."], docs: [await emailDocument(filename, buffer)] };
    if (ext === "epub") return { filename, status: "indexed", parser: "epub-spine", docs: epubDocuments(filename, buffer) };
    if (["docx", "pptx", "xlsx"].includes(ext)) {
      const docs = officeDocuments(filename, buffer, ext);
      if (!docs.length) throw new Error("document contains no extractable records");
      return { filename, status: "indexed", parser: "office-xml-1", docs };
    }
    if (ext === "pdf") return await extractPdf(filename, buffer);

    // For everything else we need UTF-8 text. Reject true binaries up front.
    if (isProbablyBinary(buffer)) {
      if (options.strictStructured && ["json", "ndjson", "jsonl"].includes(ext)) throw new Error("invalid structured file: binary content");
      return {
        filename,
        status: "skipped",
        reason: "unsupported binary file (no text to index)",
        docs: [],
      };
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (ext === "rtf") return { filename, status: "indexed", parser: "rtf-parser", warnings: ["Complex RTF tables are not reconstructed."], docs: [{ filename, type: "rtf", content: await richText(text), _extraction: { parser: "rtf-parser", version: 1, mapping: "extracted-text" } }] };

    if (text.trim().length === 0) {
      if (ext === "json" && options.strictStructured) throw new Error("invalid JSON: empty file");
      return { filename, status: "skipped", reason: "empty file", docs: [] };
    }
    if (["html", "htm"].includes(ext)) return { filename, status: "indexed", parser: "htmlparser2", docs: [{ filename, type: "html", content: visibleHtml(text), _extraction: { parser: "htmlparser2", version: 1, mapping: "visible-text" } }] };
    if (["csv", "tsv"].includes(ext)) {
      const rows = delimitedRows(text, ext === "tsv" ? "\t" : ","), headers = rows.shift() ?? [];
      return { filename, status: "indexed", parser: "delimited-1", docs: rows.map((cells, i) => ({ filename, type: ext, row: i + 2, content: cells.map((cell, j) => `${headers[j] ?? `Column ${j + 1}`}: ${cell}`).join("\n"), _extraction: { parser: "delimited", version: 1, mapping: "logical-record", headers } })) };
    }

    if (ext === "json") {
      const docs = extractJson(filename, text, options.strictStructured === true);
      if (docs) return { filename, status: "indexed", docs };
      // Not valid JSON — fall back to storing the raw text.
    }

    if (ext === "ndjson" || ext === "jsonl") {
      const docs = extractNdjson(filename, text);
      return { filename, status: "indexed", docs };
    }

    return {
      filename,
      status: "indexed",
      docs: [{ filename, content: text }],
    };
  } catch (e) {
    return {
      filename,
      status: "skipped",
      reason: e instanceof Error ? e.message : "failed to extract",
      docs: [],
    };
  }
}
