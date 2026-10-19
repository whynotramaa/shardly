import { expect, it } from "vitest";
const modulePath = "../web/lib/benchmark-replay.ts";
const { benchmarkReplay } = await import(modulePath);

it("preserves the measured time ratio and bounds document groups", () => {
  const race = benchmarkReplay({ indexed: { tookMs: 2, scanned: 3 }, naive: { tookMs: 100, scanned: 2389 } });
  expect(race.scanDuration).toBe(2400);
  expect(race.indexedDuration / race.scanDuration).toBeCloseTo(2 / 100);
  expect(race.tileCount).toBe(120);
  expect(race.selectedTiles.size).toBe(1);
  const reversed = benchmarkReplay({ indexed: { tookMs: 200, scanned: 20 }, naive: { tookMs: 100, scanned: 20 } });
  expect(reversed.indexedDuration).toBe(2400);
  expect(reversed.scanDuration).toBe(1200);
  expect(reversed.selectedTiles.size).toBe(20);
});

it("does not invent documents or matches for empty corpora and zero times", () => {
  const empty = benchmarkReplay({ indexed: { tookMs: 0, scanned: 0 }, naive: { tookMs: 0, scanned: 0 } });
  expect(empty).toMatchObject({ indexedDuration: 0, scanDuration: 0, tileCount: 0 });
  expect(empty.selectedTiles.size).toBe(0);
  const none = benchmarkReplay({ indexed: { tookMs: .01, scanned: 0 }, naive: { tookMs: 50, scanned: 7 } });
  expect(none.tileCount).toBe(7);
  expect(none.selectedTiles.size).toBe(0);
});
