import type { Doc } from "./docmeta";
import { primaryText } from "./docmeta";

/** Plain words keep filenames and source text from becoming query operators. */
export function exampleQueries(docs: Doc[]): string[] {
  const queries = new Map<string, string>();
  for (const doc of docs) {
    const name = [doc.title, doc.name, doc.filename, doc.path].find(value => typeof value === "string" && value.trim());
    const title = typeof name === "string" ? name.split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, "") : "";
    for (const text of [title, primaryText(doc).slice(0, 200)]) {
      const words = (text.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []).filter(word => word.length >= 3 && word.length <= 40);
      const query = [...new Set(words)].slice(0, 2).join(" ");
      const key = query.normalize("NFC").toLocaleLowerCase();
      if (query && !queries.has(key)) queries.set(key, query);
      if (queries.size === 6) return [...queries.values()];
    }
  }
  return [...queries.values()];
}
