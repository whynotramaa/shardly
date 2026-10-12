import { Storage } from "../storage/storage.js";
import type { StoredDocument } from "../types.js";

// This child receives only the demo's generated temporary path and bundled records.
process.once("message", (records: StoredDocument[]) => {
  const storage = new Storage(process.argv[2]!);
  for (const { id, doc } of records) storage.writeWithId(id, doc);
  process.send!({ acknowledged: records.map(record => record.id) });
  // Keep the writer alive without a graceful close so the parent can verify SIGKILL recovery.
  setInterval(() => {}, 1000);
});
