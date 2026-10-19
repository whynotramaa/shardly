const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "of",
  "at",
  "by",
  "for",
  "with",
  "about",
  "to",
  "from",
  "in",
  "on",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "as",
  "so",
  "than",
  "then",
  "there",
  "here",
  "not",
  "no",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
]);
const WORD = /[\p{L}\p{M}\p{N}_]+/gu;
export const CONTENT_LANGUAGES = ["en", "hi", "zh", "ja", "ko", "tr", "fr", "de", "es", "ar"] as const;
export function documentLanguage(doc: Record<string, unknown>): string {
  return CONTENT_LANGUAGES.includes(doc.contentLanguage as typeof CONTENT_LANGUAGES[number]) ? String(doc.contentLanguage) : "en";
}

export interface TokenInfo {
  term: string;
  original: string;
  start: number;
  end: number;
  position: number;
  field: string;
}

export function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("edly")) return token.slice(0, -4);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("ies") && token.length > 4)
    return token.slice(0, -3) + "y";
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function identifierParts(raw: string): string[] {
  return raw
    .split(/[_\-.]+|(?<=[a-z\d])(?=[A-Z])/)
    .filter(Boolean)
    .map((x) => x.toLowerCase());
}

export function tokenizeDetailed(text: string, field = "text", language = "en"): TokenInfo[] {
  if (language !== "en") {
    if (!CONTENT_LANGUAGES.includes(language as typeof CONTENT_LANGUAGES[number])) throw new Error("unsupported content language");
    return [...new Intl.Segmenter(language, { granularity: "word" }).segment(text)].filter(segment => segment.isWordLike).map((segment, position) => ({ term: segment.segment.normalize("NFC").toLocaleLowerCase(language), original: segment.segment, start: segment.index, end: segment.index + segment.segment.length, position, field }));
  }
  const out: TokenInfo[] = [];
  let position = 0;
  for (const m of text.matchAll(WORD)) {
    const original = m[0]!;
    const start = m.index ?? 0;
    // NFC makes composed and decomposed Unicode equivalent without changing source offsets.
    const raw = original.normalize("NFC").toLocaleLowerCase();
    const parts = identifierParts(original);
    const terms = parts.length > 1 ? [raw, ...parts] : [stem(raw)];
    if (!STOPWORDS.has(raw))
      for (const term of terms)
        out.push({
          term,
          original,
          start,
          end: start + original.length,
          position,
          field,
        });
    position++;
  }
  return out;
}

export function tokenize(text: string): string[] {
  return tokenizeDetailed(text).map((t) => t.term);
}

export function tokenizeDocument(doc: unknown): string[] {
  return tokenize(documentFields(doc).map(field => field.text).join(" "));
}

export function tokenizeDocumentDetailed(doc: unknown): TokenInfo[] {
  return documentFields(doc).flatMap(({ field, text }) =>
    tokenizeDetailed(text, field),
  );
}

export function documentFields(
  doc: unknown,
): Array<{ field: string; text: string }> {
  const fields: Array<{ field: string; text: string }> = [];
  const policy = doc && typeof doc === "object" ? (doc as Record<string, unknown>)._search : undefined;
  const selected = policy && typeof policy === "object" && Array.isArray((policy as { fields?: unknown }).fields) ? (policy as { fields: unknown[] }).fields : undefined;
  if (doc && typeof doc === "object" && !Array.isArray(doc))
    for (const [field, value] of Object.entries(
      doc as Record<string, unknown>,
    )) {
      if (["_search", "_access", "_extraction"].includes(field) || selected && !selected.includes(field)) continue;
      const values: string[] = [];
      collectStrings(value, values);
      if (values.length) fields.push({ field, text: values.join(" ") });
    }
  if (!fields.length && (!doc || typeof doc !== "object" || Array.isArray(doc))) {
    const values: string[] = [];
    collectStrings(doc, values);
    fields.push({ field: "text", text: values.join(" ") });
  }
  return fields;
}

function collectStrings(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  if (["string", "number", "boolean"].includes(typeof value))
    out.push(String(value));
  else if (Array.isArray(value))
    for (const item of value) collectStrings(item, out);
  else if (typeof value === "object")
    for (const v of Object.values(value as Record<string, unknown>))
      collectStrings(v, out);
}

/** Unstemmed surface words include stopwords for exact positional phrases. */
export function surfaceTokens(text: string, field = "text"): TokenInfo[] {
  return [...text.matchAll(WORD)].map((m, position) => ({
    term: m[0].normalize("NFC").toLowerCase(),
    original: m[0],
    start: m.index!,
    end: m.index! + m[0].length,
    position,
    field,
  }));
}
