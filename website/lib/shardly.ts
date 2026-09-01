/**
 * Faithful browser ports of the pieces of Shardly the diagrams need to run
 * live. Kept byte-for-byte equivalent to the engine so the site never shows a
 * number the real system would not produce.
 *
 * Sources: src/search/tokenizer.ts, src/search/rank.ts, src/config.ts.
 */

export const STOPWORDS = [
  "the", "a", "an", "and", "or", "but", "if", "of", "at", "by", "for",
  "with", "about", "to", "from", "in", "on", "is", "are", "was", "were",
  "be", "been", "being", "am", "it", "its", "this", "that", "these",
  "those", "as", "so", "than", "then", "there", "here", "not", "no",
  "do", "does", "did", "have", "has", "had", "i", "you", "he", "she",
  "we", "they",
];

const STOPSET = new Set(STOPWORDS);

const NON_ALNUM = /[^a-z0-9\s]+/g;
const WHITESPACE = /\s+/;

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/** Which of the six suffix rules fired, so the UI can name it. */
export interface StemStep {
  rule: string;
  out: string;
}

export function stemExplained(token: string): StemStep {
  if (token.length <= 3) return { rule: "len ≤ 3, untouched", out: token };
  if (token.endsWith("ing") && token.length > 5)
    return { rule: '-ing, len > 5', out: token.slice(0, -3) };
  if (token.endsWith("edly")) return { rule: "-edly", out: token.slice(0, -4) };
  if (token.endsWith("ed") && token.length > 4)
    return { rule: "-ed, len > 4", out: token.slice(0, -2) };
  if (token.endsWith("ies") && token.length > 4)
    return { rule: "-ies → y", out: token.slice(0, -3) + "y" };
  if (token.endsWith("es") && token.length > 4)
    return { rule: "-es, len > 4", out: token.slice(0, -2) };
  if (token.endsWith("s") && !token.endsWith("ss"))
    return { rule: "-s, not -ss", out: token.slice(0, -1) };
  return { rule: "no rule matched", out: token };
}

export function stem(token: string): string {
  return stemExplained(token).out;
}

export function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(NON_ALNUM, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(WHITESPACE)) {
    if (raw.length === 0) continue;
    if (STOPSET.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** Every stage of the pipeline for one input word, for the playground. */
export interface TokenTrace {
  raw: string;
  lowered: string;
  /** Fragments after non-alphanumeric runs become separators. */
  pieces: string[];
  /** One entry per surviving fragment. */
  results: Array<{
    piece: string;
    dropped: boolean;
    rule: string;
    stem: string;
  }>;
}

export function traceTokens(text: string): TokenTrace[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return words.map((raw) => {
    const lowered = raw.toLowerCase();
    const pieces = lowered
      .replace(NON_ALNUM, " ")
      .split(WHITESPACE)
      .filter((p) => p.length > 0);
    return {
      raw,
      lowered,
      pieces,
      results: pieces.map((piece) => {
        if (STOPSET.has(piece))
          return { piece, dropped: true, rule: "stopword", stem: "" };
        const s = stemExplained(piece);
        return { piece, dropped: false, rule: s.rule, stem: s.out };
      }),
    };
  });
}

export function idf(totalDocs: number, docsContaining: number): number {
  return Math.log(
    (totalDocs - docsContaining + 0.5) / (docsContaining + 0.5) + 1,
  );
}

export function contribution(
  termIdf: number,
  tf: number,
  docLen: number,
  avgdl: number,
  k1 = BM25_K1,
  b = BM25_B,
): number {
  const denom = tf + k1 * (1 - b + (b * docLen) / avgdl);
  return (termIdf * (tf * (k1 + 1))) / denom;
}

/** Just the saturating term-frequency factor, without IDF. */
export function tfFactor(
  tf: number,
  docLen: number,
  avgdl: number,
  k1 = BM25_K1,
  b = BM25_B,
): number {
  return (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLen) / avgdl));
}

export interface MiniDoc {
  id: string;
  title: string;
  text: string;
}

export interface MiniPosting {
  docId: string;
  termFrequency: number;
}

export interface MiniIndex {
  postings: Map<string, MiniPosting[]>;
  docLengths: Map<string, number>;
  docCount: number;
  avgdl: number;
}

export function buildIndex(docs: MiniDoc[]): MiniIndex {
  const postings = new Map<string, MiniPosting[]>();
  const docLengths = new Map<string, number>();
  let totalTokens = 0;

  for (const doc of docs) {
    const tokens = tokenize(`${doc.title} ${doc.text}`);
    docLengths.set(doc.id, tokens.length);
    totalTokens += tokens.length;

    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, freq] of tf) {
      const list = postings.get(term) ?? [];
      list.push({ docId: doc.id, termFrequency: freq });
      postings.set(term, list);
    }
  }

  return {
    postings,
    docLengths,
    docCount: docs.length,
    avgdl: docs.length === 0 ? 0 : totalTokens / docs.length,
  };
}

export interface MiniHit {
  docId: string;
  score: number;
  breakdown: Array<{
    term: string;
    termFrequency: number;
    idf: number;
    contribution: number;
  }>;
}

export function rank(index: MiniIndex, queryTerms: string[]): MiniHit[] {
  if (index.docCount === 0 || index.avgdl === 0) return [];

  const terms = [...new Set(queryTerms)].filter(
    (t) => (index.postings.get(t) ?? []).length > 0,
  );

  const acc = new Map<string, MiniHit>();
  for (const term of terms) {
    const list = index.postings.get(term)!;
    const termIdf = idf(index.docCount, list.length);
    for (const { docId, termFrequency } of list) {
      const len = index.docLengths.get(docId) ?? 0;
      const c = contribution(termIdf, termFrequency, len, index.avgdl);
      const hit = acc.get(docId) ?? { docId, score: 0, breakdown: [] };
      hit.score += c;
      hit.breakdown.push({ term, termFrequency, idf: termIdf, contribution: c });
      acc.set(docId, hit);
    }
  }

  const hits = [...acc.values()];
  for (const h of hits) h.breakdown.sort((a, b) => b.contribution - a.contribution);
  hits.sort((a, b) => b.score - a.score);
  return hits;
}
