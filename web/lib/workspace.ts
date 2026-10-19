import type { SearchGroup, SearchOptions, SearchSnippet } from "./api";

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  options: SearchOptions;
  exact?: boolean;
}
export interface Collection {
  id: string;
  name: string;
  docIds: string[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const id = (value: unknown): value is string =>
  text(value, 128) && /^[a-zA-Z0-9_-]+$/.test(value);
const ids = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 1000 &&
  value.every(id) &&
  new Set(value).size === value.length;

export function validSynonyms(
  value: unknown,
): value is Record<string, string[]> {
  return (
    object(value) &&
    JSON.stringify(value).length <= 8000 &&
    Object.entries(value).length <= 32 &&
    Object.entries(value).every(
      ([term, aliases]) =>
        text(term, 80) &&
        Array.isArray(aliases) &&
        aliases.length <= 8 &&
        aliases.every((alias) => text(alias, 80)),
    )
  );
}

export function validSearchOptions(value: unknown): value is SearchOptions {
  if (!object(value)) return false;
  return Object.entries(value).every(([key, v]) => {
    if (v === undefined) return true;
    switch (key) {
      case "strategy":
        return ["lexical", "dense", "hybrid"].includes(String(v));
      case "rerank":
        return typeof v === "boolean";
      case "contentLanguage":
        return ["en", "hi", "zh", "ja", "ko", "tr", "fr", "de", "es", "ar"].includes(String(v));
      case "match":
        return v === "text" || v === "literal" || v === "substring";
      case "mode":
        return v === "all" || v === "any";
      case "groupBy":
        return v === "none" || v === "repo" || v === "source";
      case "profile":
        return v === "baseline" || v === "tuned";
      case "prefix":
      case "typos":
      case "inspect":
        return typeof v === "boolean";
      case "limit":
        return Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 100;
      case "offset":
        return Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 100000;
      case "source":
      case "repo":
      case "type":
      case "language":
        return text(v, 256);
      case "docIds":
        return ids(v);
      case "synonyms":
        return validSynonyms(v);
      default:
        return false;
    }
  });
}

export function validSavedSearches(value: unknown): value is SavedSearch[] {
  return (
    Array.isArray(value) &&
    value.length <= 1000 &&
    value.every(
      (x) =>
        object(x) &&
        id(x.id) &&
        text(x.name, 256) &&
        text(x.query, 2000) &&
        (x.exact === undefined || typeof x.exact === "boolean") &&
        validSearchOptions(x.options),
    ) &&
    new Set(value.map((x) => x.id)).size === value.length
  );
}
export function validCollections(value: unknown): value is Collection[] {
  return (
    Array.isArray(value) &&
    value.length <= 1000 &&
    value.every(
      (x) => object(x) && id(x.id) && text(x.name, 256) && ids(x.docIds),
    ) &&
    new Set(value.map((x) => x.id)).size === value.length
  );
}

function read<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function loadSavedSearches(): SavedSearch[] {
  return read("shardly-saved-searches", [], validSavedSearches);
}
export function recentSearches(next: SavedSearch, previous: SavedSearch[]): SavedSearch[] {
  const signature = JSON.stringify(searchParams(next.query, next.options, Boolean(next.exact)).toString());
  return [next, ...previous.filter((item) => JSON.stringify(searchParams(item.query, item.options, Boolean(item.exact)).toString()) !== signature)].slice(0, 8);
}
export function loadRecentSearches(): SavedSearch[] {
  return read("shardly-recent-searches", [], validSavedSearches);
}
export function loadCollections(): Collection[] {
  return read("shardly-collections", [], validCollections);
}
export function portableWorkspace() { return { version: 1 as const, collections: loadCollections(), searches: loadSavedSearches() }; }
export function importWorkspace(value: unknown) {
  if (!object(value) || value.version !== 1 || !validCollections(value.collections) || !validSavedSearches(value.searches) || JSON.stringify(value).length > 2 * 1024 * 1024) throw new Error("This file does not contain valid saved searches and collections.");
  const oldCollections = localStorage.getItem("shardly-collections"), oldSearches = localStorage.getItem("shardly-saved-searches");
  try {
    localStorage.setItem("shardly-collections", JSON.stringify(value.collections));
    localStorage.setItem("shardly-saved-searches", JSON.stringify(value.searches));
  } catch {
    try {
      if (oldCollections === null) localStorage.removeItem("shardly-collections"); else localStorage.setItem("shardly-collections", oldCollections);
      if (oldSearches === null) localStorage.removeItem("shardly-saved-searches"); else localStorage.setItem("shardly-saved-searches", oldSearches);
    } catch { throw new Error("Browser storage failed during import and rollback. Your export file remains intact; check the Library before trying again."); }
    throw new Error("Could not import saved work. Browser storage may be full or disabled.");
  }
  return { collections: value.collections, searches: value.searches };
}
export function saveWorkspace(
  key: "shardly-saved-searches" | "shardly-recent-searches" | "shardly-collections",
  value: unknown,
): string | null {
  if (
    !(key === "shardly-collections"
      ? validCollections(value)
      : validSavedSearches(value))
  ) {
    return "Changes could not be saved. Check names, IDs, and search options.";
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch {
    return "Could not save changes in this browser (storage may be full or blocked).";
  }
}

export function searchParams(
  q: string,
  options: SearchOptions,
  exact = false,
): URLSearchParams {
  const params = new URLSearchParams({ q });
  if (exact) params.set("exact", "true");
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== false) {
      params.set(
        key,
        key === "synonyms"
          ? JSON.stringify(value)
          : Array.isArray(value)
            ? value.join(",")
            : String(value),
      );
    }
  }
  return params;
}
export function readSearchOptions(params: URLSearchParams): SearchOptions {
  const options: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (key === "q" || key === "exact") continue;
    if (key === "synonyms") {
      try {
        options[key] = JSON.parse(value);
      } catch {
        throw new Error("Synonyms in the URL must be valid JSON.");
      }
    } else if (key === "docIds") options[key] = value ? value.split(",") : [];
    else if (key === "limit" || key === "offset")
      options[key] = /^\d+$/.test(value) ? Number(value) : NaN;
    else if (["prefix", "typos", "inspect", "rerank"].includes(key))
      options[key] =
        value === "true" ? true : value === "false" ? false : value;
    else if (
      [
        "mode",
        "strategy",
        "contentLanguage",
        "match",
        "groupBy",
        "profile",
        "source",
        "repo",
        "type",
        "language",
      ].includes(key)
    )
      options[key] = value;
  }
  if (!validSearchOptions(options))
    throw new Error(
      "Invalid search options in the URL. Clear the filters and try again.",
    );
  return options;
}

export function passageMarks(
  passage: SearchSnippet,
): Array<{ start: number; end: number }> {
  const spans = passage.matches
    .map((m) => ({
      start: Math.max(0, m.start - passage.start),
      end: Math.min(passage.text.length, m.end - passage.start),
    }))
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}
export function distinctPassages(
  snippet: SearchSnippet | undefined,
  passages: SearchSnippet[] = [],
): SearchSnippet[] {
  const result: SearchSnippet[] = [];
  for (const passage of [...(snippet ? [snippet] : []), ...passages]) {
    if (
      !result.some(
        (p) =>
          p.text === passage.text ||
          (p.field === passage.field &&
            p.start < passage.end &&
            passage.start < p.end),
      )
    )
      result.push(passage);
    if (result.length === 3) break;
  }
  return result;
}

// Field offsets refer to the engine's recursively flattened original field values.
export function originalFieldText(
  doc: Record<string, unknown>,
  field: string,
): string {
  const values: string[] = [];
  function collect(value: unknown) {
    if (value === null || value === undefined) return;
    if (["string", "number", "boolean"].includes(typeof value))
      values.push(String(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === "object")
      Object.values(value as Record<string, unknown>).forEach(collect);
  }
  collect(Object.hasOwn(doc, field) ? doc[field] : undefined);
  return values.join(" ");
}
export function documentMatchHref(
  docId: string,
  query: string,
  passage?: SearchSnippet,
): string {
  const params = new URLSearchParams({ q: query });
  if (passage) {
    if (passage.revision) params.set("revision", passage.revision);
    params.set("field", passage.field);
    params.set("at", String(passage.matches[0]?.start ?? passage.start));
    params.set("end", String(passage.matches[0]?.end ?? passage.end));
  }
  return `/document/${encodeURIComponent(docId)}?${params}`;
}

export function visibleGroups(
  groups: SearchGroup[],
  total: number,
): SearchGroup[] {
  const unassigned =
    total - groups.reduce((sum, group) => sum + group.count, 0);
  return unassigned > 0 ? [...groups, { key: "", count: unassigned }] : groups;
}
