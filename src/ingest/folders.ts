import fs from "node:fs";
import { promises as fsp, constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeEngine, Extraction } from "../runtime/engine.js";
import { DOCUMENT_EXTENSIONS, extensionOf, excludedPath, type ExtractResult } from "./extract.js";
import { validateDocumentPolicy } from "../search/filters.js";
import { InputError } from "../api/validation.js";

const exec = promisify(execFile);
const MAX_STAGED_BYTES = 256 * 1024 * 1024;
interface FileRecord { hash: string; ids: string[]; size?: number; mtimeMs?: number; ctimeMs?: number }
export interface FolderSource {
  includeSensitive?: boolean;
  recordKey?: string;
  lastAttemptedAt?: string;
  id: string; path: string; status: "idle" | "syncing" | "paused" | "error"; paused: boolean;
  createdAt: string; lastSyncedAt?: string; error?: string; ignoreMode: "git" | "safe-fallback";
  progress: { scanned: number; indexed: number; removed: number }; files: number;
}
interface SavedSource extends FolderSource { records: Record<string, FileRecord> }

export class FolderSources {
  private readonly sources = new Map<string, SavedSource>();
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly file: string;
  private readonly gitDir: string;
  private timer: NodeJS.Timeout;
  private closed = false;
  private persistenceError = false;
  private gitReady?: Promise<boolean>;
  private readonly recovered = new Set<string>();
  private readonly removing = new Set<string>();

  constructor(private readonly engine: RuntimeEngine, private readonly extraction: Extraction, dataDir: string) {
    this.file = path.join(dataDir, "folders.json");
    this.gitDir = path.join(dataDir, "folder-ignore.git");
    if (fs.existsSync(this.file)) {
      const saved: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!Array.isArray(saved) || saved.length > 20) throw new Error("Invalid folder sources");
      for (const source of saved as SavedSource[]) {
        if (!source || !/^[a-z0-9-]{36}$/.test(source.id) || !path.isAbsolute(source.path) || typeof source.paused !== "boolean" || !source.records || typeof source.records !== "object" || Array.isArray(source.records)) throw new Error("Invalid folder source");
        if (source.includeSensitive !== undefined && typeof source.includeSensitive !== "boolean" || source.recordKey !== undefined && (typeof source.recordKey !== "string" || !source.recordKey || source.recordKey.length > 128)) throw new Error("Invalid folder policy");
        for (const [relative, record] of Object.entries(source.records)) {
          if (!safeRelative(relative) || !record || typeof record.hash !== "string" || !Array.isArray(record.ids) || record.ids.some(id => typeof id !== "string")) throw new Error("Invalid folder file record");
        }
        source.status = source.paused ? "paused" : "idle";
        source.progress = { scanned: 0, indexed: 0, removed: 0 };
        source.files = Object.keys(source.records).length;
        this.sources.set(source.id, source);
      }
    }
    this.timer = setInterval(() => {
      if (this.closed || this.persistenceError) return;
      for (const source of this.sources.values()) if (!source.paused) this.start(source);
    }, 2000);
    this.timer.unref();
    setImmediate(() => { for (const source of this.sources.values()) if (!source.paused) this.start(source); });
  }

  list(): FolderSource[] { return [...this.sources.values()].map(source => this.public(source)); }
  get(id: string): FolderSource | undefined { const source = this.sources.get(id); return source && this.public(source); }
  busy(): boolean { return this.active.size > 0; }
  private public({ records, ...source }: SavedSource): FolderSource { void records; return { ...source, progress: { ...source.progress } }; }

  async create(root: string, options: { includeSensitive?: boolean; recordKey?: string } = {}): Promise<FolderSource> {
    this.writable();
    if (!path.isAbsolute(root)) throw new InputError("folder path must be absolute");
    let canonical: string;
    try { canonical = await fsp.realpath(root); if (!(await fsp.stat(canonical)).isDirectory()) throw new Error(); }
    catch { throw new InputError("folder path must be an existing readable directory"); }
    if (this.sources.size >= 20) throw new InputError("at most 20 folder sources are allowed");
    if ([...this.sources.values()].some(source => source.path === canonical)) throw new InputError("folder is already managed");
    const source: SavedSource = { ...options, id: randomUUID(), path: canonical, createdAt: new Date().toISOString(), status: "idle", paused: false, ignoreMode: "safe-fallback", progress: { scanned: 0, indexed: 0, removed: 0 }, files: 0, records: Object.create(null) };
    this.sources.set(source.id, source);
    try { this.persist(); } catch (error) { this.sources.delete(source.id); throw error; }
    this.start(source);
    return this.public(source);
  }

  async action(id: string, action: "pause" | "resume" | "rescan"): Promise<FolderSource | undefined> {
    this.writable();
    const source = this.sources.get(id);
    if (!source) return;
    if (this.removing.has(id)) throw new InputError("folder source is being removed");
    if (action === "pause") {
      source.paused = true;
      this.active.get(id)?.controller.abort();
      await this.active.get(id)?.promise;
      source.status = "paused";
      this.persist();
    } else {
      if (action === "resume") source.paused = false;
      this.persist();
      this.start(source, action === "rescan");
    }
    return this.public(source);
  }

  async remove(id: string): Promise<{ removed: number } | undefined> {
    this.writable();
    const source = this.sources.get(id);
    if (!source) return;
    if (this.removing.has(id)) throw new InputError("folder source is being removed");
    this.removing.add(id);
    try {
      source.paused = true;
      this.active.get(id)?.controller.abort();
      await this.active.get(id)?.promise;
      let removed = 0;
      for (const { id: docId } of await this.engine.collectBySource("folder")) if (await this.deleteOwned(source, docId)) removed++;
      await this.engine.snapshot();
      this.sources.delete(id);
      try { this.persist(); } catch (error) { this.sources.set(id, source); throw error; }
      return { removed };
    } finally { this.removing.delete(id); }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    for (const active of this.active.values()) active.controller.abort();
    await Promise.all([...this.active.values()].map(active => active.promise));
    this.persist();
  }

  private writable(): void {
    if (this.closed) throw new InputError("folder sources are shutting down");
    if (this.persistenceError) throw new Error("Cannot save folder sources; check disk space and restart");
  }

  private start(source: SavedSource, force = false): void {
    if (this.closed || this.persistenceError || this.active.has(source.id) || this.removing.has(source.id)) return;
    const controller = new AbortController();
    const promise = this.sync(source, controller.signal, force).catch(error => {
      source.status = source.paused ? "paused" : "error";
      if (!controller.signal.aborted) source.error = error instanceof Error ? error.message : "Folder sync failed";
    }).finally(() => {
      this.active.delete(source.id);
      try { this.persist(); } catch { this.persistenceError = true; source.status = "error"; source.error = "Cannot save folder sources; check disk space and restart"; }
    });
    this.active.set(source.id, { controller, promise });
  }

  private async gitAvailable(): Promise<boolean> {
    const ready = await (this.gitReady ??= exec("git", ["init", "--bare", "--quiet", this.gitDir]).then(() => true, () => false));
    if (!ready) this.gitReady = undefined;
    return ready;
  }

  private async sync(source: SavedSource, signal: AbortSignal, force: boolean): Promise<void> {
    source.status = "syncing";
    source.lastAttemptedAt = new Date().toISOString();
    source.error = undefined;
    source.progress = { scanned: 0, indexed: 0, removed: 0 };
    if (await fsp.realpath(source.path) !== source.path || (await fsp.lstat(source.path)).isSymbolicLink()) throw new Error("Folder root changed; select it again");
    const git = await this.gitAvailable();
    source.ignoreMode = git ? "git" : "safe-fallback";
    const candidates: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      signal.throwIfAborted();
      const canonical = await fsp.realpath(dir);
      if ((canonical !== source.path && !canonical.startsWith(source.path + path.sep)) || canonical !== dir || (await fsp.lstat(dir)).isSymbolicLink()) throw new Error("Folder directory changed or escaped selected root");
      const handle = await fsp.open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      let entries;
      try {
        const actual = await fsp.realpath(process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : dir);
        if (actual !== dir) throw new Error("Folder directory changed during scan");
        entries = await fsp.readdir(process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : dir, { withFileTypes: true });
      } finally { await handle.close(); }
      const directories = entries.filter(entry => entry.isDirectory() && entry.name !== ".git").map(entry => path.relative(source.path, path.join(dir, entry.name)).split(path.sep).join("/") + "/");
      const ignoredDirectories = git ? await this.ignored(source, directories) : new Set<string>();
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        if (!source.includeSensitive && excludedPath(path.relative(source.path, full))) continue;
        if (!git && entry.name === ".gitignore") throw new Error("Git unavailable; folder with .gitignore cannot be synced safely. Install Git and rescan.");
        if (entry.isDirectory() && !ignoredDirectories.has(path.relative(source.path, full).split(path.sep).join("/") + "/")) await walk(full);
        else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(extensionOf(entry.name))) candidates.push(path.relative(source.path, full).split(path.sep).join("/"));
        if (candidates.length > 10_000) throw new Error("Folder exceeds 10000 supported files; choose a smaller folder");
      }
    };
    await walk(source.path);
    const ignored = git ? await this.ignored(source, candidates) : new Set<string>();
    if (!this.recovered.has(source.id)) {
      // Reconcile writes acknowledged before a crash or failed metadata save.
      for (const { id } of await this.engine.collectBySource("folder")) {
        const doc = await this.engine.getDocument(id);
        if (doc?.folderId !== source.id || typeof doc.path !== "string" || !safeRelative(doc.path) || typeof doc.sourceId !== "string" || !doc.sourceId.startsWith(`folder:${source.id}:`)) continue;
        const record = source.records[doc.path] ??= { hash: "", ids: [] };
        if (!record.ids.includes(id)) record.ids.push(id);
      }
      this.recovered.add(source.id);
    }
    const seen = new Set<string>();
    let stagedBytes = 0;
    const pending: Array<{ relative: string; hash: string; stat: fs.Stats; extracted: ExtractResult }> = [];
    for (const relative of candidates) {
      signal.throwIfAborted();
      if (ignored.has(relative)) continue;
      seen.add(relative);
      const old = source.records[relative];
      const stat = await fsp.lstat(path.join(source.path, relative));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Folder file changed during scan");
      source.progress.scanned++;
      let owned = !!old;
      for (const id of old?.ids ?? []) {
        const doc = await this.engine.getDocument(id);
        if (doc?.source !== "folder" || doc.folderId !== source.id || doc.path !== relative) { owned = false; break; }
      }
      if (!force && owned && old?.size === stat.size && old.mtimeMs === stat.mtimeMs && old.ctimeMs === stat.ctimeMs) continue;
      // Reserve input plus UTF-16 extraction before allocating either.
      if (stagedBytes + stat.size * 3 > MAX_STAGED_BYTES) throw new Error("Folder changed-file extraction exceeds 256 MiB staging budget; sync a smaller folder");
      const buffer = await readContained(source.path, relative);
      if (stagedBytes + buffer.length * 3 > MAX_STAGED_BYTES) throw new Error("Folder changed-file extraction exceeds 256 MiB staging budget; sync a smaller folder");
      const hash = await this.extraction.hash(buffer);
      if (!force && owned && old?.hash === hash) {
        Object.assign(old, { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
        continue;
      }
      const extracted = await this.extraction.extract(relative, buffer, { strictStructured: true });
      extracted.docs.forEach(validateDocumentPolicy);
      const recordKeys = extracted.docs.map((doc, ordinal) => source.recordKey ? doc[source.recordKey] : ordinal);
      if (recordKeys.some(key => typeof key === "string" ? !key.length : typeof key !== "number" || !Number.isFinite(key)) || new Set(recordKeys.map(String)).size !== recordKeys.length) throw new Error(`${relative}: missing or duplicate record keys`);
      signal.throwIfAborted();
      if (extracted.status === "skipped" && extracted.reason !== "empty file" && !extracted.reason?.startsWith("unsupported binary") && !extracted.reason?.startsWith("no extractable text")) throw new Error(`${relative}: ${extracted.reason}`);
      stagedBytes += Math.max(stat.size * 3, buffer.length + JSON.stringify(extracted.docs).length * 2);
      if (stagedBytes > MAX_STAGED_BYTES) throw new Error("Folder changed-file extraction exceeds 256 MiB staging budget; sync a smaller folder");
      pending.push({ relative, hash, stat, extracted });
    }
    // Validate every changed file before reconciling documents from this scan.
    for (const { relative, hash, stat, extracted } of pending) {
      signal.throwIfAborted();
      const old = source.records[relative];
      const keys = extracted.docs.map((doc, ordinal) => source.recordKey ? doc[source.recordKey] : ordinal);
      const result = await this.engine.ingestDocuments(extracted.docs.map((doc, ordinal) => ({ ...doc, modifiedAt: new Date(stat.mtimeMs).toISOString(), source: "folder", folderId: source.id, path: relative, sourceId: `folder:${source.id}:${relative}:${keys[ordinal]}` })));
      source.records[relative] = { hash, ids: result.ids, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
      for (const id of old?.ids ?? []) if (!result.ids.includes(id) && await this.deleteOwned(source, id)) source.progress.removed++;
      source.progress.indexed += result.added + result.updated;
      this.persist();
    }
    // Deletions happen only after a complete successful scan.
    signal.throwIfAborted();
    for (const relative of Object.keys(source.records)) {
      if (seen.has(relative)) continue;
      for (const id of source.records[relative]!.ids) if (await this.deleteOwned(source, id)) source.progress.removed++;
      delete source.records[relative];
    }
    source.files = Object.keys(source.records).length;
    source.lastSyncedAt = new Date().toISOString();
    source.status = source.paused ? "paused" : "idle";
  }

  private async ignored(source: SavedSource, files: string[]): Promise<Set<string>> {
    const ignored = new Set<string>();
    for (let offset = 0; offset < files.length; offset += 128) {
      const batch = files.slice(offset, offset + 128);
      const output = await new Promise<string>((resolve, reject) => {
        const child = execFile("git", ["-c", "core.bare=false", "-c", "core.excludesFile=/dev/null", `--git-dir=${this.gitDir}`, `--work-tree=${source.path}`, "check-ignore", "--no-index", "-z", "--stdin"], { cwd: source.path, maxBuffer: 1024 * 1024 }, (error, stdout) => error && error.code !== 1 ? reject(new Error("Cannot evaluate folder .gitignore rules")) : resolve(stdout));
        child.stdin!.end(batch.join("\0") + "\0");
      });
      for (const file of output.split("\0").filter(Boolean)) ignored.add(file);
    }
    return ignored;
  }

  private async deleteOwned(source: SavedSource, id: string): Promise<boolean> {
    const doc = await this.engine.getDocument(id);
    return doc?.source === "folder" && doc.folderId === source.id && typeof doc.sourceId === "string" && doc.sourceId.startsWith(`folder:${source.id}:`) ? this.engine.deleteDocument(id) : false;
  }

  private persist(): void {
    const fd = fs.openSync(`${this.file}.tmp`, "w", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify([...this.sources.values()])); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(`${this.file}.tmp`, this.file);
    const dir = fs.openSync(path.dirname(this.file), "r");
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}

function safeRelative(relative: string): boolean { return !!relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).some(part => part === ".." || part === ""); }
async function readContained(root: string, relative: string): Promise<Buffer> {
  if (!safeRelative(relative)) throw new Error("Unsafe folder path");
  const file = path.join(root, relative);
  for (let dir = path.dirname(file); dir !== root; dir = path.dirname(dir)) if ((await fsp.lstat(dir)).isSymbolicLink()) throw new Error("Folder contains a symlink");
  const handle = await fsp.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await fsp.realpath(process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : file);
    if (!actual.startsWith(root + path.sep)) throw new Error("File escaped selected folder");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("File is not regular or exceeds 64 MB");
    return await handle.readFile();
  } finally { await handle.close(); }
}
