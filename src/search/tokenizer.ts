


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







