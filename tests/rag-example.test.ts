import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
it("reports missing optional local LLM assets without starting inference or a service", async () => {
  const module = new URL("../examples/generation-worker.ts", import.meta.url);
  const worker = new Worker(`const{workerData}=require('node:worker_threads');import('tsx/esm/api').then(({register})=>{register();return import(workerData.module)}).catch(e=>{throw e});`, { eval: true, workerData: { module: module.href, modelDirectory: "/nonexistent-shardly-generation-model", prompt: "test" } });
  try {
    const row = await new Promise<{ error: string }>((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    expect(row.error).toContain("nonexistent-shardly-generation-model");
  } finally { await worker.terminate(); }
});
