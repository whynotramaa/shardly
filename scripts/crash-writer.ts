/**
 * Child process for the crash test. Writes documents in a tight loop forever,
 * printing each committed id to stdout, until its parent SIGKILLs it mid-write.
 *
 * Usage: tsx scripts/crash-writer.ts <dataDir>
 */
import fs from "node:fs";
import { Storage } from "../src/storage/storage.js";

const dataDir = process.argv[2];
if (!dataDir) {
  console.error("usage: crash-writer <dataDir>");
  process.exit(1);
}

const storage = new Storage(dataDir);
let n = 0;
// A tight synchronous loop never yields to the event loop, so async
// process.stdout would buffer every line and lose them all on SIGKILL. Write
// straight to fd 1 with writeSync so each id reaches the parent's pipe the
// instant the write is durable — the parent only verifies ids it actually saw.
for (;;) {
  const id = storage.write({ n, payload: "x".repeat(200), ts: Date.now() });
  fs.writeSync(1, id + "\n");
  n += 1;
}
