import { describe, it, expect } from "vitest";
import { InvertedIndexStore } from "../src/search/index.js";
import { rankBM25, idf } from "../src/search/rank.js";

describe("BM25 ranking", () => {
  it("returns empty for an empty corpus", () => {
    const { total, results } = rankBM25(new InvertedIndexStore(), ["anything"]);
    expect(total).toBe(0);
    expect(results).toEqual([]);
  });

  it("ranks a doc containing the term above one that doesn't", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("hit", ["database", "storage", "engine"]);
    idx.addDocument("miss", ["frontend", "react", "css"]);

    const { total, results } = rankBM25(idx, ["database"]);
    expect(total).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]!.docId).toBe("hit");
  });

  it("rarer query terms carry more weight (IDF)", () => {
    const idx = new InvertedIndexStore();
    // "common" appears everywhere; "rare" almost nowhere.
    for (let i = 0; i < 10; i++) idx.addDocument(`c${i}`, ["common"]);
    idx.addDocument("rareDoc", ["common", "rare"]);

    expect(idf(11, 11)).toBeLessThan(idf(11, 1));
    const { results } = rankBM25(idx, ["common", "rare"]);
    // The doc with the rare term should top the ranking.
    expect(results[0]!.docId).toBe("rareDoc");
  });

  it("length normalization (b) is what penalizes an over-long doc", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("tight", ["bm25", "bm25", "filler1", "filler2"]); // len 4
    const longTokens = ["bm25", "bm25", ...Array(30).fill(0).map((_, i) => `w${i}`)];
    idx.addDocument("bloated", longTokens); // len 32, same tf=2

    const withNorm = rankBM25(idx, ["bm25"]).results;
    expect(withNorm[0]!.docId).toBe("tight");
    expect(withNorm[0]!.score).toBeGreaterThan(withNorm[1]!.score);

    const noNorm = rankBM25(idx, ["bm25"], { k1: 1.5, b: 0 }).results;
    expect(noNorm[0]!.score).toBeCloseTo(noNorm[1]!.score, 10);
  });

  it("a genuinely more relevant long doc still wins when it earns it", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("short", ["bm25", "trick"]); // tf 1, len 2
    const longTokens = [
      ...Array(10).fill("bm25"),
      ...Array(20).fill(0).map((_, i) => `ctx${i}`),
    ];
    idx.addDocument("long", longTokens); // tf 10, len 30
    for (let i = 0; i < 8; i++) {
      idx.addDocument(`filler${i}`, Array(10).fill(`filler${i}`));
    }

    const { results } = rankBM25(idx, ["bm25"]);
    expect(results[0]!.docId).toBe("long");
  });

  it("respects the limit but still reports the full match total", () => {
    const idx = new InvertedIndexStore();
    for (let i = 0; i < 20; i++) idx.addDocument(`d${i}`, ["common", `x${i}`]);

    const { total, results } = rankBM25(idx, ["common"], { limit: 5 });
    expect(total).toBe(20); // every doc matched
    expect(results).toHaveLength(5); // but only top-5 returned
    // still sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("exposes a per-term breakdown that sums to the total score", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("d1", ["alpha", "beta", "alpha"]);
    idx.addDocument("d2", ["beta", "gamma"]);

    const [top] = rankBM25(idx, ["alpha", "beta"]).results;
    expect(top).toBeDefined();
    const summed = top!.breakdown.reduce((s, t) => s + t.contribution, 0);
    expect(summed).toBeCloseTo(top!.score, 10);
    // breakdown sorted strongest-first
    expect(top!.breakdown[0]!.contribution).toBeGreaterThanOrEqual(
      top!.breakdown[top!.breakdown.length - 1]!.contribution,
    );
  });
});





