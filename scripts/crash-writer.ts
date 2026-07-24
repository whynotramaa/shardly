
import fs from "node:fs";
import { Storage } from "../src/storage/storage.js";

const dataDir = process.argv[2];
if (!dataDir) {
  console.error("usage: crash-writer <dataDir>");
  process.exit(1);
}

const storage = new Storage(dataDir);
let n = 0;
for (;;) {
  const id = storage.write({ n, payload: "x".repeat(200), ts: Date.now() });
  fs.writeSync(1, id + "\n");
  n += 1;
}







