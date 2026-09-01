import { extractText, getDocumentProxy } from "unpdf";
import type { Document } from "../types.js";

export interface ExtractResult {
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
  "json", "ndjson", "jsonl", "yaml", "yml", "toml", "ini", "env", "xml", "html",
  "css", "scss", "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cc",
  "cs", "php", "swift", "scala", "sh", "bash", "zsh", "sql", "graphql",
  "vue", "svelte", "dockerfile", "makefile", "gitignore", "lock", "conf",
]);

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
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const content = (text ?? "").trim();
  if (content.length === 0) {
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
    docs: [{ filename, type: "pdf", pages: totalPages, content }],
  };
}

function extractJson(filename: string, text: string): Document[] | null {
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((o) => withSource(o, filename));
  } catch {
    return null;
  }
}

function extractNdjson(filename: string, text: string): Document[] {
  const docs: Document[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      docs.push(withSource(JSON.parse(t), filename));
    } catch {
      /* skip malformed line */
    }
  }
  return docs;
}

export async function extractDocuments(
  filename: string,
  buffer: Buffer,
): Promise<ExtractResult> {
  const ext = extensionOf(filename);

  try {
    if (ext === "pdf") return await extractPdf(filename, buffer);

    // For everything else we need UTF-8 text. Reject true binaries up front.
    if (!TEXT_EXTENSIONS.has(ext) && isProbablyBinary(buffer)) {
      return {
        filename,
        status: "skipped",
        reason: "unsupported binary file (no text to index)",
        docs: [],
      };
    }

    const text = buffer.toString("utf8");

    if (ext === "json") {
      const docs = extractJson(filename, text);
      if (docs) return { filename, status: "indexed", docs };
      // Not valid JSON — fall back to storing the raw text.
    }

    if (ext === "ndjson" || ext === "jsonl") {
      const docs = extractNdjson(filename, text);
      if (docs.length > 0) return { filename, status: "indexed", docs };
    }

    if (text.trim().length === 0) {
      return { filename, status: "skipped", reason: "empty file", docs: [] };
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
