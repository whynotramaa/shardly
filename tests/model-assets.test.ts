import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { modelAssets } from "../src/vector/model-assets.js";
const dirs: string[] = [];
const revision = "a".repeat(40);
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-model-assets-")); dirs.push(dir); return dir; }
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
it("publishes only pinned model assets and reuses them offline without fetch", async () => {
  const root = directory(), requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { requests.push(url); return new Response(url.endsWith(".onnx") ? "weights" : "{}"); });
  const installed = await modelAssets("fixture/model", revision, root);
  expect(requests.length).toBe(4); expect(requests.every(url => url.includes(`/resolve/${revision}/`))).toBe(true);
  expect(fs.readFileSync(path.join(installed, "onnx/model_quantized.onnx"), "utf8")).toBe("weights");
  vi.stubGlobal("fetch", () => { throw new Error("offline called fetch"); });
  expect(await modelAssets("fixture/model", revision, root, true)).toBe(installed);
});
it("rejects incomplete downloads, offline misses and cache traversal", async () => {
  const root = directory();
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  await expect(modelAssets("fixture/model", revision, root)).rejects.toThrow("503");
  expect(fs.readdirSync(path.join(root, "fixture/model", revision))).toEqual([]);
  await expect(modelAssets("fixture/model", revision, root, true)).rejects.toThrow("offline model asset missing");
  await expect(modelAssets("../escape", revision, root)).rejects.toThrow("pinned");
  await expect(modelAssets("fixture/model", "main", root)).rejects.toThrow("pinned");
});
