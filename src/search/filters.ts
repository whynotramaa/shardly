import type { Document } from "../types.js";

export const FILTER_FIELDS = ["source", "repo", "type", "language", "contentLanguage", "path", "filename", "title", "modifiedAt", "tags", "collection"] as const;
export type Filter = { and: Filter[] } | { or: Filter[] } | { field: string; op: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "prefix"; value: string | number | boolean | Array<string | number | boolean> };
export interface ReadScope { tenant?: string; principals?: string[]; sources?: string[] }

export function validateFilter(value: unknown): Filter | undefined {
  if (value === undefined) return;
  let clauses = 0;
  const visit = (node: unknown, depth: number): void => {
    if (++clauses > 64 || depth > 6 || !node || typeof node !== "object" || Array.isArray(node)) throw new Error("filter exceeds its depth/clause budget or is invalid");
    const row = node as Record<string, unknown>;
    if (Object.hasOwn(row, "and") || Object.hasOwn(row, "or")) {
      const key = Object.hasOwn(row, "and") ? "and" : "or";
      if (Object.keys(row).length !== 1 || !Array.isArray(row[key]) || !row[key].length) throw new Error("filter groups must contain conditions");
      for (const child of row[key]) visit(child, depth + 1);
    } else {
      if (Object.keys(row).some(k => !["field", "op", "value"].includes(k)) || !FILTER_FIELDS.includes(row.field as typeof FILTER_FIELDS[number]) || !["eq", "in", "gt", "gte", "lt", "lte", "prefix"].includes(String(row.op))) throw new Error("invalid filter field or operator");
      const primitive = (v: unknown) => typeof v === "boolean" || typeof v === "number" && Number.isFinite(v) || typeof v === "string" && v.length <= 1024;
      if (row.op === "in" ? !Array.isArray(row.value) || row.value.length > 100 || !row.value.every(primitive) : !primitive(row.value)) throw new Error("invalid filter value");
      if (row.op === "prefix" && typeof row.value !== "string") throw new Error("prefix requires a string");
    }
  };
  visit(value, 0);
  return value as Filter;
}

export function matchesFilter(doc: Document, filter?: Filter): boolean {
  if (!filter) return true;
  if ("and" in filter) return filter.and.every(f => matchesFilter(doc, f));
  if ("or" in filter) return filter.or.some(f => matchesFilter(doc, f));
  const values = Array.isArray(doc[filter.field]) ? doc[filter.field] as unknown[] : [doc[filter.field]];
  return values.some(value => {
    if (filter.op === "in") return (filter.value as unknown[]).includes(value);
    if (filter.op === "eq") return value === filter.value;
    if (filter.op === "prefix") return typeof value === "string" && value.startsWith(filter.value as string);
    if ((typeof value !== "number" && typeof value !== "string") || typeof value !== typeof filter.value) return false;
    const target = filter.value as typeof value;
    if (filter.op === "gt") return value > target;
    if (filter.op === "gte") return value >= target;
    if (filter.op === "lt") return value < target;
    return value <= target;
  });
}

export function authorized(doc: Document, scope?: ReadScope): boolean {
  if (!scope) return true;
  if (scope.sources && !scope.sources.includes(String(doc.source))) return false;
  const access = doc._access as { tenant?: string; principals?: string[] } | undefined;
  if (scope.tenant !== undefined && access?.tenant !== scope.tenant) return false;
  if (access?.principals !== undefined) return Array.isArray(access.principals) && access.principals.some(p => scope.principals?.includes(p));
  return true;
}

/** Validate reserved policies before any durable write, including batch imports. */
export function validateDocumentPolicy(doc: Document): void {
  const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  for (const key of ["_access", "_search"] as const) {
    const value = doc[key];
    if (value === undefined) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${key} must be an object`);
    const row = value as Record<string, unknown>;
    const allowed = key === "_access" ? ["tenant", "principals"] : ["fields"];
    if (Object.keys(row).some(field => !allowed.includes(field))) fail(`unknown ${key} policy field`);
    if (row.tenant !== undefined && (typeof row.tenant !== "string" || !row.tenant || row.tenant.length > 256)) fail("invalid access tenant");
    for (const field of ["principals", "fields"]) if (row[field] !== undefined) {
      const values = row[field];
      if (!Array.isArray(values) || values.length > 100 || values.some(value => typeof value !== "string" || !value || value.length > 256)) fail(`invalid ${key}.${field}`);
    }
  }
}
