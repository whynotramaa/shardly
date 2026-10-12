import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildServer } from "../src/api/server.js";

const roots: string[] = [];
let server: Awaited<ReturnType<typeof buildServer>> | undefined;
function dir() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-folders-")); roots.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); await server?.app.close(); server = undefined; for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function request(method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, app = server!.app) { const response = await app.inject({ method, url, payload: payload as object }); expect(response.statusCode).toBeLessThan(400); return response.json(); }
async function synced(id: string, app = server!.app) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const source = await request("GET", `/sources/folders/${id}`, undefined, app);
    if (source.status !== "syncing") { expect(source.error).toBeUndefined(); return source; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("folder sync timed out");
}
it("persists a folder, obeys nested ignore/negation, and updates renames/deletions only for its source", async () => {
  const store = dir(), folder = dir(), external = dir();
  fs.mkdirSync(path.join(folder, "nested"));
  fs.writeFileSync(path.join(folder, ".gitignore"), "*.txt\n!keep.txt\n");
  fs.writeFileSync(path.join(folder, "keep.txt"), "firstfolderneedle");
  fs.writeFileSync(path.join(folder, "ignore.txt"), "hiddenneedle");
  fs.writeFileSync(path.join(folder, "nested/.gitignore"), "!visible.txt\n");
  fs.writeFileSync(path.join(folder, "nested/visible.txt"), "nestedneedle");
  fs.writeFileSync(path.join(external, "secret.md"), "escapeneedle");
  fs.symlinkSync(external, path.join(folder, "escape"));
  server = await buildServer(store);
  const other = await server.engine.addDocument({ source: "upload", content: "unrelatedneedle" });
  const source = await request("POST", "/sources/folders", { path: folder });
  expect((await synced(source.id)).files).toBe(2);
  const hits = (await request("GET", "/search?q=firstfolderneedle")).hits;
  const originalId = hits[0].docId;
  expect((await request("GET", "/search?q=hiddenneedle")).total).toBe(0);
  expect((await request("GET", "/search?q=escapeneedle")).total).toBe(0);
  expect((await request("GET", "/search?q=nestedneedle")).total).toBe(1);
  await request("POST", `/sources/folders/${source.id}/pause`);
  fs.writeFileSync(path.join(folder, "keep.txt"), "editedfolderneedle");
  await request("POST", `/sources/folders/${source.id}/rescan`);
  expect((await synced(source.id)).paused).toBe(true);
  expect((await request("GET", "/search?q=editedfolderneedle")).hits[0].docId).toBe(originalId);
  fs.renameSync(path.join(folder, "keep.txt"), path.join(folder, "renamed.md"));
  await request("POST", `/sources/folders/${source.id}/resume`); await synced(source.id);
  expect((await server.app.inject({ method: "GET", url: "/documents/" + originalId })).statusCode).toBe(404);
  await request("POST", `/sources/folders/${source.id}/pause`);
  await server.app.close();
  server = await buildServer(store);
  expect((await request("GET", "/sources/folders")).sources[0].paused).toBe(true);
  fs.unlinkSync(path.join(folder, "nested/visible.txt"));
  await request("POST", `/sources/folders/${source.id}/rescan`); await synced(source.id);
  expect((await request("GET", "/search?q=nestedneedle")).total).toBe(0);
  expect((await request("DELETE", `/sources/folders/${source.id}`)).removed).toBeGreaterThan(0);
  expect(await server.engine.getDocument(other)).not.toBeNull();
  expect(fs.existsSync(path.join(folder, "renamed.md"))).toBe(true);
}, 20000);

it("polls edits, renames and deletions, removes binary replacements, and retains documents when a scan fails", async () => {
  const store = dir(), folder = dir();
  fs.writeFileSync(path.join(folder, "watched.md"), "polloriginalneedle");
  server = await buildServer(store);
  const source = await request("POST", "/sources/folders", { path: folder }); await synced(source.id);
  async function eventually(query: string, count: number) {
    for (let i = 0; i < 100; i++) {
      if ((await request("GET", `/search?q=${query}`)).total === count) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`poll did not update ${query}`);
  }
  fs.writeFileSync(path.join(folder, "watched.md"), "pollupdatedneedle");
  await eventually("pollupdatedneedle", 1);
  fs.renameSync(path.join(folder, "watched.md"), path.join(folder, "renamed.md"));
  for (let i = 0; i < 100; i++) {
    const hit = (await request("GET", "/search?q=pollupdatedneedle")).hits[0];
    if (hit?.doc.path === "renamed.md") break;
    if (i === 99) throw new Error("rename did not sync");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  fs.writeFileSync(path.join(folder, "renamed.md"), Buffer.from([0, 1, 2]));
  await eventually("pollupdatedneedle", 0);
  fs.writeFileSync(path.join(folder, "renamed.md"), "lastgoodneedle"); await eventually("lastgoodneedle", 1);
  fs.renameSync(folder, `${folder}-unavailable`); roots.push(`${folder}-unavailable`);
  await request("POST", `/sources/folders/${source.id}/rescan`);
  for (let i = 0; i < 100; i++) {
    const current = await request("GET", `/sources/folders/${source.id}`);
    if (current.status === "error") break;
    if (i === 99) throw new Error("missing folder did not fail");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect((await request("GET", "/search?q=lastgoodneedle")).total).toBe(1);
  fs.renameSync(`${folder}-unavailable`, folder);
  fs.unlinkSync(path.join(folder, "renamed.md"));
  await eventually("lastgoodneedle", 0);
}, 20000);

it("does not traverse an ignored parent even when a nested rule negates a file", async () => {
  const folder = dir(); fs.mkdirSync(path.join(folder, "ignored"));
  fs.writeFileSync(path.join(folder, ".gitignore"), "ignored/\n!ignored/keep.md\n");
  fs.writeFileSync(path.join(folder, "ignored/.gitignore"), "!keep.md\n");
  fs.writeFileSync(path.join(folder, "ignored/keep.md"), "ignoredparentneedle");
  fs.writeFileSync(path.join(folder, "visible.md"), "visibleparentneedle");
  server = await buildServer(dir());
  const source = await request("POST", "/sources/folders", { path: folder }); await synced(source.id);
  expect((await request("GET", "/search?q=ignoredparentneedle")).total).toBe(0);
  expect((await request("GET", "/search?q=visibleparentneedle")).total).toBe(1);
});


it("uses file metadata on idle polls, skips snapshots, and retains last good documents on read permission failure", async () => {
  const folder = dir(); const file = path.join(folder, "stable.md");
  fs.writeFileSync(file, "permissionneedle");
  server = await buildServer(dir());
  const source = await request("POST", "/sources/folders", { path: folder }); await synced(source.id);
  const open = fs.promises.open;
  const opens = vi.spyOn(fs.promises, "open");
  const snapshot = vi.spyOn(server.engine, "snapshot");
  await new Promise(resolve => setTimeout(resolve, 2200));
  expect(opens.mock.calls.filter(call => String(call[0]) === file)).toHaveLength(0);
  expect(snapshot).not.toHaveBeenCalled();
  opens.mockImplementation(((...args: Parameters<typeof fs.promises.open>) => String(args[0]) === file
    ? Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" })) : open(...args)) as typeof fs.promises.open);
  await request("POST", `/sources/folders/${source.id}/rescan`);
  for (let i = 0; i < 100; i++) {
    if ((await request("GET", `/sources/folders/${source.id}`)).status === "error") break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect((await request("GET", `/sources/folders/${source.id}`)).error).toContain("permission denied");
  expect((await request("GET", "/search?q=permissionneedle")).total).toBe(1);
}, 10000);

it("requires folder sources to be paused before reset and only reimports after explicit resume", async () => {
  const folder = dir(); fs.writeFileSync(path.join(folder, "reset.md"), "resetfolderneedle");
  server = await buildServer(dir());
  const source = await request("POST", "/sources/folders", { path: folder }); await synced(source.id);
  const rejected = await server.app.inject({ method: "POST", url: "/reset" });
  expect(rejected.statusCode).toBe(400); expect(rejected.json().error).toContain("pause folder sources");
  expect((await request("GET", "/search?q=resetfolderneedle")).total).toBe(1);
  await request("POST", `/sources/folders/${source.id}/pause`);
  await request("POST", "/reset");
  await new Promise(resolve => setTimeout(resolve, 2200));
  expect((await request("GET", "/stats")).documents).toBe(0);
  await request("POST", `/sources/folders/${source.id}/resume`); await synced(source.id);
  expect((await request("GET", "/search?q=resetfolderneedle")).total).toBe(1);
}, 10000);


it.each(["jsonl", "ndjson", "json"])("retains the entire last good index when a managed %s file is truncated", async ext => {
  const folder = dir();
  const records = [{ content: "firstgoodneedle" }, { content: "secondgoodneedle" }];
  const file = path.join(folder, `records.${ext}`);
  fs.writeFileSync(file, ext === "json" ? JSON.stringify(records) : records.map(record => JSON.stringify(record)).join("\n"));
  fs.writeFileSync(path.join(folder, "other.md"), "othergoodneedle");
  const workerServer = await buildServer(dir(), { worker: true });
  const workerRequest = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) => request(method, url, payload, workerServer.app);
  try {
    const source = await workerRequest("POST", "/sources/folders", { path: folder }); await synced(source.id, workerServer.app);
    const before = await workerServer.engine.exportBackup();
    expect(before.documents).toHaveLength(3);
    await workerRequest("POST", `/sources/folders/${source.id}/pause`);
    // A valid first row must not update before the invalid second row is detected.
    fs.writeFileSync(file, (ext === "json" ? '[' : '') + '{"content":"changedneedle"}' + (ext === "json" ? ',' : '\n') + '{"content":');
    fs.writeFileSync(path.join(folder, "other.md"), "otherchangedneedle");
    await workerRequest("POST", `/sources/folders/${source.id}/rescan`);
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = await workerRequest("GET", `/sources/folders/${source.id}`);
      if (current.status !== "syncing") {
        expect(current.error).toContain(`records.${ext}:`);
        expect(current.progress.indexed).toBe(0);
        expect(current.progress.removed).toBe(0);
        break;
      }
      if (attempt === 199) throw new Error("folder failure timed out");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(await workerServer.engine.exportBackup()).toEqual(before);
    for (const q of ["firstgoodneedle", "secondgoodneedle", "othergoodneedle"]) expect((await workerRequest("GET", `/search?q=${q}`)).total).toBe(1);
    expect((await workerRequest("GET", "/search?q=changedneedle")).total).toBe(0);
  } finally { await workerServer.app.close(); }
}, 10000);


it("bounds aggregate staged extraction before reading the next file and retains the last good index", async () => {
  const folder = dir();
  const files = [path.join(folder, "one.md"), path.join(folder, "two.md")];
  for (const file of files) fs.writeFileSync(file, "budgetlastgoodneedle");
  server = await buildServer(dir());
  const source = await request("POST", "/sources/folders", { path: folder }); await synced(source.id);
  await request("POST", `/sources/folders/${source.id}/pause`);
  const before = await server.engine.exportBackup();
  for (const file of files) fs.writeFileSync(file, "budgetchangedneedle");
  const lstat = fs.promises.lstat;
  vi.spyOn(fs.promises, "lstat").mockImplementation((async (...args: Parameters<typeof fs.promises.lstat>) => {
    const stat = await lstat(...args);
    // Simulate large changed inputs without allocating test data.
    if (files.includes(String(args[0]))) stat.size = 50 * 1024 * 1024;
    return stat;
  }) as typeof fs.promises.lstat);
  const opens = vi.spyOn(fs.promises, "open");
  await request("POST", `/sources/folders/${source.id}/rescan`);
  for (let attempt = 0; attempt < 200; attempt++) {
    const current = await request("GET", `/sources/folders/${source.id}`);
    if (current.status !== "syncing") {
      expect(current.error).toContain("256 MiB staging budget");
      expect(current.progress.indexed).toBe(0);
      expect(current.progress.removed).toBe(0);
      break;
    }
    if (attempt === 199) throw new Error("folder budget failure timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(opens.mock.calls.filter(call => files.includes(String(call[0])))).toHaveLength(1);
  expect(await server.engine.exportBackup()).toEqual(before);
});
