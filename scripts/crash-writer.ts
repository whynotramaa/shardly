
import fs from "node:fs";
import { Storage } from "../src/storage/storage.js";

const dataDir = process.argv[2];
if (!dataDir) {
  console.error("usage: crash-writer <dataDir>");
  process.exit(1);
}

/**
 * stdout is a non-blocking pipe, so a full parent buffer throws EAGAIN. Dropping
 * the ack would silently shrink the set under test, so retry until it lands.
 * ponytail: a spin is fine here, this process exists to be SIGKILLed.
 */
function ack(line: string): void {
  for (;;) {
    try {
      fs.writeSync(1, line);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
    }
  }
}

const storage = new Storage(dataDir);
let n = 0;
for (;;) {
  const id = storage.write({ n, payload: "x".repeat(200), ts: Date.now() });
  ack(id + "\n");
  n += 1;
}
