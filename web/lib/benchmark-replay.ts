interface ReplayInput { indexed: { tookMs: number; scanned: number }; naive: { tookMs: number; scanned: number } }

export function benchmarkReplay(sample: ReplayInput) {
  const longest = Math.max(sample.indexed.tookMs, sample.naive.tookMs);
  const scale = longest > 0 ? 2400 / longest : 0;
  const tileCount = Math.min(120, sample.naive.scanned);
  const selectedCount = tileCount ? Math.min(tileCount, Math.ceil(sample.indexed.scanned / sample.naive.scanned * tileCount)) : 0;
  return {
    indexedDuration: sample.indexed.tookMs * scale,
    scanDuration: sample.naive.tookMs * scale,
    tileCount,
    selectedTiles: new Set(Array.from({ length: selectedCount }, (_, i) => Math.floor(i * tileCount / selectedCount))),
  };
}
