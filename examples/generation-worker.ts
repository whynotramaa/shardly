import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";

const modelDirectory = String(workerData.modelDirectory);
try {
  if (!path.isAbsolute(modelDirectory) || !fs.statSync(modelDirectory).isDirectory()) throw new Error("SHARDLY_GENERATE_MODEL_DIR must be an installed local ONNX model directory");
  const packageName = "@huggingface/transformers", runtime = await import(packageName);
  runtime.env.allowRemoteModels = false;
  const generator = await runtime.pipeline("text-generation", modelDirectory, { local_files_only: true, dtype: "q4", device: "cpu", session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
  try {
    const result = await generator([{ role: "user", content: workerData.prompt }], { max_new_tokens: 256, do_sample: false });
    parentPort!.postMessage({ result });
  } finally { await generator.dispose(); }
} catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : "local generation failed" }); }
