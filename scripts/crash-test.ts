
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage/storage.js";

const ROUNDS = Number.parseInt(process.argv[2] ?? "8", 10);
if (!Number.isSafeInteger(ROUNDS) || ROUNDS < 1) throw new Error("rounds must be a positive integer");

function runWriterUntilKilled(
  dataDir: string,
  killAfterMs: number,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const acked: string[] = [];
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join("scripts", "crash-writer.ts"), dataDir],
      { stdio: ["ignore", "pipe", "inherit"] },
    );

    let buf = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) acked.push(line);
      }
    });

    let killTimer: NodeJS.Timeout | undefined;
    const startupTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("crash writer produced no acknowledgement"));
    }, 5000);
    child.stdout.on("data", () => {
      if (killTimer === undefined && acked.length > 0) {
        clearTimeout(startupTimer);
        killTimer = setTimeout(() => child.kill("SIGKILL"), killAfterMs);
      }
    });
    child.on("error", (error) => {
      clearTimeout(startupTimer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(startupTimer);
      if (killTimer) clearTimeout(killTimer);
      if (signal !== "SIGKILL") reject(new Error("crash writer exited unexpectedly"));
      else resolve(acked);
    });
  });
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-crash-"));
  console.log(`crash-test data dir: ${dataDir}`);

  try {
  const allAcked: string[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const killAfter = 150 + Math.floor(Math.random() * 400);
    const acked = await runWriterUntilKilled(dataDir, killAfter);
    allAcked.push(...acked);

    // Reopen and verify EVERY acknowledged id from every round so far.
    const storage = new Storage(dataDir);
    let missing = 0;
    let corrupt = 0;
    for (const id of allAcked) {
      const doc = storage.read(id);
      if (doc === null) missing++;
      else if (typeof doc.n !== "number") corrupt++;
    }
    storage.close();

    console.log(
      `round ${round}: killed@${killAfter}ms  acked_total=${allAcked.length}  ` +
        `missing=${missing}  corrupt=${corrupt}`,
    );
    if (missing > 0 || corrupt > 0) {
      throw new Error("DURABILITY BUG: acknowledged write not recoverable");
    }
  }

  console.log(
    `\n✓ ${allAcked.length} acknowledged writes survived ${ROUNDS} SIGKILLs with zero loss or corruption`,
  );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
