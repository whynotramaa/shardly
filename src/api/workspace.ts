import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { object, text } from "./validation.js";

export interface WorkspaceState { version: 1; collections: Array<{ id: string; name: string; docIds: string[] }>; searches: Array<{ id: string; name: string; query: string; options: Record<string, unknown>; exact?: boolean }> }

export function validateWorkspace(value: unknown): WorkspaceState {
  const state = object(value, "workspace");
  if (state.version !== 1 || !Array.isArray(state.collections) || !Array.isArray(state.searches) || state.collections.length > 1000 || state.searches.length > 1000 || Buffer.byteLength(JSON.stringify(state)) > 2 * 1024 * 1024) throw new Error("workspace exceeds limits or has an unsupported version");
  for (const list of [state.collections, state.searches]) {
    const ids = new Set<string>();
    for (const item of list) {
      const row = object(item, "workspace entry");
      const id = text(row.id, "workspace id", 128);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error("invalid or duplicate workspace id");
      ids.add(id); text(row.name, "workspace name", 256);
      if (list === state.collections) {
        if (!Array.isArray(row.docIds) || row.docIds.length > 1000 || row.docIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) || new Set(row.docIds).size !== row.docIds.length) throw new Error("invalid collection document ids");
      } else {
        text(row.query, "saved query", 2000); object(row.options, "saved options");
        if (row.exact !== undefined && typeof row.exact !== "boolean") throw new Error("invalid saved query mode");
      }
    }
  }
  return structuredClone(state) as unknown as WorkspaceState;
}

export class WorkspaceStore {
  private state: WorkspaceState = { version: 1, collections: [], searches: [] };
  private file: string;
  constructor(directory: string) {
    this.file = path.join(directory, "workspace.json");
    if (fs.existsSync(this.file)) this.state = validateWorkspace(JSON.parse(fs.readFileSync(this.file, "utf8")));
  }
  get() { return structuredClone(this.state); }
  save(value: unknown) {
    const state = validateWorkspace(value), tmp = this.file + ".tmp";
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    const dir = fs.openSync(path.dirname(this.file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    this.state = state;
    return this.get();
  }
  collection(id: string) { return this.state.collections.find(c => c.id === id)?.docIds ?? []; }
}

export function registerWorkspace(app: FastifyInstance, store: WorkspaceStore) {
  app.get("/workspace", async () => store.get());
  app.put("/workspace", async request => {
    try { return store.save(request.body); } catch (error) { throw Object.assign(error as Error, { statusCode: 400 }); }
  });
}
