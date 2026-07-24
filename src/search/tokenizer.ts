/**
 * Hand-written tokenizer. No NLP library — the pipeline is deliberately simple
 * and fully explainable:
 *
 *   1. lowercase
 *   2. strip everything that isn't a letter/digit/space
 *   3. split on whitespace
 *   4. drop stopwords
 *   5. lightweight rule-based stemming (plurals + common verb suffixes)
 *
 * `rank.ts` and `index.ts` both tokenize through here so a query is processed
 * identically to the documents it searches — the property that makes the
 * inverted index correct.
 */

/** ~40 highest-frequency English function words. Big enough to help, small
 * enough to read at a glance. */
const STOPWORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "if", "of", "at", "by", "for",
  "with", "about", "to", "from", "in", "on", "is", "are", "was", "were",
  "be", "been", "being", "am", "it", "its", "this", "that", "these",
  "those", "as", "so", "than", "then", "there", "here", "not", "no",
  "do", "does", "did", "have", "has", "had", "i", "you", "he", "she",
  "we", "they",
]);

/** Keep letters and digits; turn everything else into a split point. */
const NON_ALNUM = /[^a-z0-9\s]+/g;
const WHITESPACE = /\s+/;

/**
 * Very small rule-based stemmer. This is intentionally naive — a full Porter
 * stemmer is overkill and harder to explain. It collapses the most common
 * inflections so "runs"/"running"/"ran"... (well, not "ran") map together.
 *
 * Order matters: longer suffixes are checked first.
 */
export function stem(token: string): string {
  if (token.length <= 3) return token; // too short to safely strip

  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("edly")) return token.slice(0, -4);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);

  return token;
}

/**
 * Tokenize free text into normalized, stemmed terms ready for indexing or
 * querying. Returns an array (with duplicates preserved) so callers can count
 * term frequencies.
 */
export function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(NON_ALNUM, " ");
  const tokens: string[] = [];
  for (const raw of cleaned.split(WHITESPACE)) {
    if (raw.length === 0) continue;
    if (STOPWORDS.has(raw)) continue;
    tokens.push(stem(raw));
  }
  return tokens;
}

/**
 * Flatten an arbitrary JSON document into one searchable string, then tokenize.
 * Every string/number field contributes; nested objects and arrays are walked.
 * This is what makes "full-text search across all documents" work regardless of
 * document shape.
 */
export function tokenizeDocument(doc: unknown): string[] {
  const parts: string[] = [];
  collectStrings(doc, parts);
  return tokenize(parts.join(" "));
}

function collectStrings(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "string") {
    out.push(value as string);
  } else if (t === "number" || t === "boolean") {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (t === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
}
