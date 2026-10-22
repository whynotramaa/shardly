import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

/** Install only the pinned BERT-style q8 assets used by the local adapters. */
export async function modelAssets(model: string, revision: string, cacheDir?: string, offline = false): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(model) || model.split("/").some(part => part === "." || part === "..") || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("local models require a repository ID and pinned commit SHA");
  const directory = path.resolve(cacheDir ?? path.join(os.homedir(), ".cache", "shardly", "models"), model, revision);
  for (const asset of ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]) {
    const file = path.join(directory, asset);
    try { if ((await fs.stat(file)).size > 0) continue; } catch { /* Missing assets download only when explicitly online. */ }
    if (offline) throw new Error(`offline model asset missing: ${model}@${revision}/${asset}`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`, handle = await fs.open(temporary, "wx", 0o600);
    try {
      const response = await fetch(`https://huggingface.co/${model}/resolve/${revision}/${asset}`, { signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body) throw new Error(`model asset download failed (${response.status})`);
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 512 * 1024 * 1024) throw new Error("local model asset exceeds 512 MiB budget");
        await handle.writeFile(chunk);
      }
      if (!bytes) throw new Error("empty model asset");
      await handle.sync(); await handle.close(); await fs.rename(temporary, file);
      const parent = await fs.open(path.dirname(file), "r"); try { await parent.sync(); } finally { await parent.close(); }
    } finally { await handle.close().catch(() => {}); await fs.rm(temporary, { force: true }); }
  }
  return directory;
}
