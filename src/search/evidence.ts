import { createHash } from "node:crypto";
import { documentFields } from "./tokenizer.js";
import type { Document, SearchSnippet } from "../types.js";

export interface Block { field: string; kind: "heading" | "code" | "text" | "table"; start: number; end: number; heading?: string; line: number; page?: number }
export interface Passage extends Block { revision: string; reference: string; chunkId: string; text: string; offsetUnit: "utf16"; matches: Array<{ start: number; end: number }> }
export interface EvidenceReference { documentId: string; revision: string; field: string; start: number; end: number }
export const ANALYSIS_VERSION = "blocks-1";

export function reference(value: EvidenceReference): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeReference(value: unknown): EvidenceReference {
  if (typeof value !== "string" || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid evidence reference");
  const r = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EvidenceReference;
  if (!r || typeof r.documentId !== "string" || r.documentId.length > 128 || typeof r.revision !== "string" || !/^[a-f0-9]{64}$/.test(r.revision) || typeof r.field !== "string" || r.field.length > 256 || !Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || r.start < 0 || r.end < r.start || r.end - r.start > 65536) throw new Error("invalid evidence reference");
  return r;
}

/** Locations refer to original field text; normalized model input is always separate. */
export function blocks(doc: Document, maxChars = 1600): Block[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 2 || maxChars > 65536) throw new Error("invalid chunk character budget");
  const result: Block[] = [];
  for (const { field, text } of documentFields(doc)) {
    let heading = "", code = false, offset = 0, line = 1, start = 0, startLine = 1;
    const emit = (end: number, kind: Block["kind"]) => {
      for (let at = start; at < end;) {
        let stop = Math.min(end, at + maxChars);
        if (stop < end && /[\uD800-\uDBFF]/.test(text[stop - 1]!) && /[\uDC00-\uDFFF]/.test(text[stop]!)) stop--;

        if (text.slice(at, stop).trim()) {
          const page = field === "content" && Array.isArray(doc.pageOffsets) ? (doc.pageOffsets as Array<{page:number;start:number;end:number}>).find(p => at >= p.start && at < p.end)?.page : undefined;
          result.push({ field, kind, start: at, end: stop, heading: heading || undefined, line: startLine + text.slice(start, at).split("\n").length - 1, ...(page === undefined ? {} : { page }) });
        }
        at = stop;
      }
      start = end;
    };
    for (const row of text.split(/(?<=\n)/)) {
      const title = !code && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(row.trimEnd());
      if (title || /^\s*```/.test(row)) {
        emit(offset, code ? "code" : "text"); startLine = line;
        if (title) { heading = title[2]!; emit(offset + row.length, "heading"); }
        else if (code) { emit(offset + row.length, "code"); code = false; startLine = line + 1; }
        else code = true;
      } else if (!code && !row.trim()) { emit(offset + row.length, "text"); startLine = line + 1; }
      offset += row.length; line++;
    }
    emit(text.length, code ? "code" : "text");
  }
  return result;
}

export function passage(documentId: string, revision: string, doc: Document, snippet: SearchSnippet | Block): Passage {
  const text = documentFields(doc).find(f => f.field === snippet.field)?.text ?? "";
  const location = blocks(doc).find(b => b.field === snippet.field && snippet.start >= b.start && snippet.start < b.end);
  const id = reference({ documentId, revision, field: snippet.field, start: snippet.start, end: snippet.end });
  return { ...location, revision, kind: location?.kind ?? "text", line: location?.line ?? 1, ...snippet, text: text.slice(snippet.start, snippet.end), reference: id, chunkId: id, offsetUnit: "utf16", matches: "matches" in snippet ? snippet.matches : [] };
}

export function chunkHash(revision: string, block: Block): string {
  return createHash("sha256").update(JSON.stringify([ANALYSIS_VERSION, revision, block.field, block.start, block.end])).digest("hex");
}
