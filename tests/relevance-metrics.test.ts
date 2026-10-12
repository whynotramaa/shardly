import { expect, it } from "vitest";
import { rankingMetrics } from "../scripts/relevance-metrics.js";
it("retains missing judged documents in ideal gain and recall", () => {
  const grades = { first: 2, second: 1, missing: 1 };
  const result = rankingMetrics(["irrelevant", "first", "second"], grades, 3);
  expect(result.mrr).toBe(.5);
  expect(result.recall).toBeCloseTo(2 / 3);
  expect(result.ndcg).toBeCloseTo((3 / Math.log2(3) + 1 / Math.log2(4)) / (3 + 1 / Math.log2(3) + 1 / Math.log2(4)));
  expect(rankingMetrics(["first", "second", "missing"], grades, 3).ndcg).toBe(1);
  expect(() => rankingMetrics(["first", "first"], grades, 3)).toThrow();
});
