import { parentPort, workerData } from "node:worker_threads";
import type { LocalModelOptions } from "./providers.js";
import { modelAssets } from "./model-assets.js";

const options = workerData as LocalModelOptions;
// Dynamic import keeps inference optional for the database and TypeScript build.
const packageName = "@huggingface/transformers";
const runtime = await import(packageName);
if (options.cacheDir) runtime.env.cacheDir = options.cacheDir;
runtime.env.allowRemoteModels = false;
let extractor: any;
let tokenizer: any;
let reranker: any;
async function run(operation: string, input: any) {
  const modelOptions = { revision: options.revision, dtype: "q8", local_files_only: !!options.offline, session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } };
  if (operation === "embed") {
    if (!extractor) {
      const directory = await modelAssets(options.model!, options.revision!, options.cacheDir, options.offline);
      const tokenizer = await runtime.AutoTokenizer.from_pretrained(directory, { ...modelOptions, local_files_only: true });
      const model = await runtime.AutoModel.from_pretrained(directory, { ...modelOptions, local_files_only: true });
      // The pipeline factory preflight reads main; explicit loading preserves pinned offline revisions.
      extractor = new runtime.FeatureExtractionPipeline({ tokenizer, model });
    }
    const tensor = await extractor(input, { pooling: "mean", normalize: true });
    return tensor.tolist().map((row: number[]) => Float32Array.from(row));
  }
  const rerankOptions = { ...modelOptions, revision: options.rerankerRevision };
  if (!reranker) {
    const directory = await modelAssets(options.rerankerModel!, options.rerankerRevision!, options.cacheDir, options.offline);
    tokenizer = await runtime.AutoTokenizer.from_pretrained(directory, { ...rerankOptions, local_files_only: true });
    reranker = await runtime.AutoModelForSequenceClassification.from_pretrained(directory, { ...rerankOptions, local_files_only: true });
  }
  const scores: number[] = [];
  for (let offset = 0; offset < input.documents.length; offset += 8) {
    const batch = input.documents.slice(offset, offset + 8);
    const features = tokenizer(batch.map(() => input.query), { text_pair: batch, padding: true, truncation: true, max_length: 512 });
    const output = await reranker(features);
    scores.push(...Array.from(output.logits.data as Float32Array));
  }
  return scores;
}
let queue = Promise.resolve();
parentPort!.on("message", (row: { id: number; operation: string; input: unknown }) => {
  queue = queue.then(async () => {
    try { parentPort!.postMessage({ id: row.id, result: await run(row.operation, row.input) }); }
    catch (error) { parentPort!.postMessage({ id: row.id, error: error instanceof Error ? error.message : "local inference failed" }); }
  });
});
