import { validateDocumentPolicy } from "../search/filters.js";
import type { Document } from "../types.js";

export class InputError extends Error {
  readonly statusCode = 400;
}

export function object(value: unknown, label = "body"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function documents(value: unknown): Document[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new InputError("documents must be an array of at most 10000 objects");
  }
  for (const doc of value) {
    object(doc, "document");
    validateJson(doc, 0);
    validateDocumentPolicy(doc as Document);
  }
  return value as Document[];
}

function validateJson(value: unknown, depth: number): void {
  if (depth > 64) throw new InputError("document nesting exceeds 64 levels");
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) validateJson(child, depth + 1);
  } else if (typeof value === "number" && !Number.isFinite(value)) {
    throw new InputError("document numbers must be finite");
  } else if (!["string", "number", "boolean"].includes(typeof value) && value !== null) {
    throw new InputError("documents must contain JSON values");
  }
}

export function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new InputError(`${label} must be a nonempty string of at most ${max} characters`);
  }
  return value.trim();
}

export function queryText(value: unknown, label = "query", max = 2000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new InputError(`${label} must be a nonempty string of at most ${max} characters`);
  }
  return value;
}

export function optionalText(value: unknown, label: string, max = 256): string | undefined {
  return value === undefined ? undefined : text(value, label, max);
}

export function flag(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new InputError(`${label} must be true or false`);
}

export function integer(value: unknown, label: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new InputError(`${label} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function choice<T extends string>(value: unknown, label: string, choices: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new InputError(`${label} must be one of ${choices.join(", ")}`);
  }
  return value as T;
}

export function synonyms(value: unknown): Record<string, string[]> | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (value.length > 8000) throw new InputError("synonyms are too large");
    try { value = JSON.parse(value); } catch { throw new InputError("synonyms must be valid JSON"); }
  }
  const entries = Object.entries(object(value, "synonyms"));
  if (entries.length > 32) throw new InputError("at most 32 synonym mappings are allowed");
  const result: Record<string, string[]> = Object.create(null);
  for (const [term, aliases] of entries) {
    text(term, "synonym term", 80);
    if (!Array.isArray(aliases) || aliases.length > 8) throw new InputError("each synonym accepts at most 8 alternatives");
    result[term] = aliases.map((alias) => text(alias, "synonym alternative", 80));
  }
  return result;
}
