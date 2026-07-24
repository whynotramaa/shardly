import { describe, it, expect } from "vitest";
import { InvertedIndexStore } from "../src/search/index.js";

describe("InvertedIndexStore", () => {
  it("builds posting lists with term frequencies", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("d1", ["cat", "cat", "dog"]);
    idx.addDocument("d2", ["dog", "bird"]);

    expect(idx.postings("cat")).toEqual([{ docId: "d1", termFrequency: 2 }]);
    expect(idx.postings("dog")).toEqual([
      { docId: "d1", termFrequency: 1 },
      { docId: "d2", termFrequency: 1 },
    ]);
    expect(idx.postings("unknown")).toEqual([]);
  });

  it("tracks corpus statistics for BM25", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("d1", ["a", "b", "c"]); // len 3
    idx.addDocument("d2", ["a"]); // len 1

    expect(idx.documentCount()).toBe(2);
    expect(idx.documentFrequency("a")).toBe(2);
    expect(idx.documentFrequency("b")).toBe(1);
    expect(idx.documentLength("d1")).toBe(3);
    expect(idx.averageDocumentLength()).toBe(2); // (3 + 1) / 2
  });

  it("removes a document from every term and updates stats", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("d1", ["cat", "dog"]);
    idx.addDocument("d2", ["dog"]);
    idx.removeDocument("d1");

    expect(idx.postings("cat")).toEqual([]);
    expect(idx.documentFrequency("cat")).toBe(0);
    expect(idx.postings("dog")).toEqual([{ docId: "d2", termFrequency: 1 }]);
    expect(idx.documentCount()).toBe(1);
    expect(idx.averageDocumentLength()).toBe(1);
  });

  it("re-adding a docId replaces its old postings (update path)", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("d1", ["cat"]);
    idx.addDocument("d1", ["dog"]); // update
    expect(idx.postings("cat")).toEqual([]);
    expect(idx.postings("dog")).toEqual([{ docId: "d1", termFrequency: 1 }]);
    expect(idx.documentCount()).toBe(1);
  });

  it("round-trips through a snapshot", () => {
    const idx = new InvertedIndexStore();
    idx.addDocument("d1", ["cat", "cat", "dog"]);
    idx.addDocument("d2", ["dog", "bird"]);

    const tmp = `${process.env.TEMP ?? "/tmp"}/shardly-idx-${Date.now()}.json`;
    idx.snapshot(tmp);

    const loaded = new InvertedIndexStore();
    expect(loaded.load(tmp)).toBe(true);
    expect(loaded.postings("cat")).toEqual([{ docId: "d1", termFrequency: 2 }]);
    expect(loaded.documentCount()).toBe(2);
    expect(loaded.averageDocumentLength()).toBe(2.5);
  });
});
