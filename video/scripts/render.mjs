// Renders composition.html frame by frame in headless Chromium and encodes with ffmpeg.
// usage: node video/scripts/render.mjs [--stills 0.5,3,7.1] [--out video/out/shardly.mp4]
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(path.join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright")); }

const dir = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const stills = args.includes("--stills") ? args[args.indexOf("--stills") + 1].split(",").map(Number) : null;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(dir, "out/shardly-video.mp4");

const data = fs.readFileSync(path.join(dir, "search-data.json"), "utf8");
const built = path.join(dir, "composition.built.html");
fs.writeFileSync(built, fs.readFileSync(path.join(dir, "composition.html"), "utf8").replace("__SEARCH_DATA__", data));

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
await page.goto("file://" + built);
await page.evaluate(() => window.ready);

if (stills) {
  fs.mkdirSync(path.join(dir, "stills"), { recursive: true });
  for (const t of stills) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(dir, "stills", `t${t.toFixed(2)}.png`) });
  }
} else {
  const fps = 30, frames = Math.round((await page.evaluate(() => window.DURATION)) * fps);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-tune", "animation", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.seek(t), f / fps);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 60 === 0) process.stdout.write(`frame ${f}/${frames}\n`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
await browser.close();
fs.rmSync(built, { force: true });
