import { Engine } from "../src/engine.js";
import { DEMO_DOCUMENTS } from "../src/ingest/demo.js";

const engine = new Engine(process.argv[2]);
try {
  const result = engine.ingestDocuments(DEMO_DOCUMENTS);
  console.log(JSON.stringify({ ...result, documents: engine.documentCount() }, null, 2));
} finally { engine.close(); }
