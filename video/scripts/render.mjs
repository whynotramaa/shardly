// Renders composition.html frame by frame in headless Chromium and encodes with ffmpeg.
// usage: node video/scripts/render.mjs [--stills 0.5,3,7.1] [--out video/out/silent.mp4] [--workers 4]
// Frames are split into contiguous ranges, one browser per worker; each worker encodes its
// own segment with identical settings and the segments are joined without re-encoding.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(path.join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright")); }

const dir = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const stills = args.includes("--stills") ? arg("--stills").split(",").map(Number) : null;
const out = path.resolve(arg("--out", path.join(dir, "out/silent.mp4")));
const range = arg("--range", null);
const workers = Number(arg("--workers", Math.min(4, os.cpus().length)));

const timeline = JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8"));
const fps = timeline.fps, total = Math.round(timeline.duration * fps);

function build(tag) {
  const built = path.join(dir, `composition.built.${tag}.html`);
  fs.writeFileSync(built, fs.readFileSync(path.join(dir, "composition.html"), "utf8")
    .replace("__SEARCH_DATA__", () => fs.readFileSync(path.join(dir, "search-data.json"), "utf8"))
    .replace("__TIMELINE__", () => JSON.stringify(timeline)));
  return built;
}

async function open(built) {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
  await page.goto("file://" + built);
  await page.evaluate(() => window.ready);
  return { browser, page };
}

const encodeArgs = ["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-tune", "film", "-g", String(fps * 2)];

if (stills) {
  const built = build("stills");
  const { browser, page } = await open(built);
  fs.mkdirSync(path.join(dir, "stills"), { recursive: true });
  for (const t of stills) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(dir, "stills", `t${t.toFixed(2)}.png`) });
  }
  await browser.close(); fs.rmSync(built, { force: true });
} else if (range) {
  // worker: render frames [a, b) into one segment
  const [a, b] = range.split(":").map(Number);
  const built = build(`w${a}`);
  const { browser, page } = await open(built);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-", ...encodeArgs, out], { stdio: ["pipe", "inherit", "inherit"] });
  for (let f = a; f < b; f++) {
    await page.evaluate((t) => window.seek(t), f / fps);
    const buf = await page.screenshot({ type: "jpeg", quality: 96 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((f - a) % 150 === 0) process.stdout.write(`[${a}:${b}] frame ${f}\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await browser.close(); fs.rmSync(built, { force: true });
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-render-"));
  const step = Math.ceil(total / workers);
  const segs = [];
  await Promise.all(Array.from({ length: workers }, (_, w) => {
    const a = w * step, b = Math.min(total, a + step), seg = path.join(tmp, `seg${w}.mp4`);
    segs.push(seg);
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [import.meta.filename, "--range", `${a}:${b}`, "--out", seg], { stdio: "inherit" });
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${w} exited ${code}`))));
    });
  }));
  fs.writeFileSync(path.join(tmp, "list.txt"), segs.map((s) => `file '${s}'`).join("\n"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"), "-c", "copy", "-movflags", "+faststart", out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("wrote", out, `${total} frames`);
}
