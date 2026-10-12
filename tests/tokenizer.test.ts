import { describe, it, expect } from "vitest";
import {
  tokenize,
  stem,
  tokenizeDocument,
  tokenizeDetailed,
} from "../src/search/tokenizer.js";

describe("tokenizer", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Hello, WORLD!")).toEqual(["hello", "world"]);
  });

  it("removes stopwords", () => {
    expect(tokenize("the cat and the dog")).toEqual(["cat", "dog"]);
  });

  it("splits on any whitespace run", () => {
    expect(tokenize("foo\t\n  bar")).toEqual(["foo", "bar"]);
  });

  it("preserves duplicates for term-frequency counting", () => {
    expect(tokenize("search search search")).toEqual([
      "search",
      "search",
      "search",
    ]);
  });

  it("keeps alphanumerics together", () => {
    expect(tokenize("ipv4 h2o test123")).toEqual(["ipv4", "h2o", "test123"]);
  });

  it("keeps combining marks in words and normalizes NFC without changing offsets", () => {
    const decomposed = "cafe\u0301";
    expect(tokenize(decomposed)).toEqual(["café"]);
    expect(tokenize("café")).toEqual(["café"]);
    const indic = tokenizeDetailed("हिन्दी")[0]!;
    expect(indic.term).toBe("हिन्दी");
    expect(indic.original).toBe("हिन्दी");
    expect(indic.start).toBe(0);
    expect(indic.end).toBe("हिन्दी".length);
  });

  describe("stemmer", () => {
    it("strips common suffixes", () => {
      expect(stem("running")).toBe("runn");
      expect(stem("jumped")).toBe("jump");
      expect(stem("cats")).toBe("cat");
      expect(stem("berries")).toBe("berry");
      expect(stem("boxes")).toBe("box");
    });

    it("leaves short and -ss words alone", () => {
      expect(stem("is")).toBe("is");
      expect(stem("class")).toBe("class");
      expect(stem("bus")).toBe("bus");
    });

    it("maps inflections of the same word together", () => {
      expect(tokenize("indexing")).toEqual(tokenize("index"));
    });
  });

  describe("tokenizeDocument", () => {
    it("walks nested objects and arrays", () => {
      const doc = {
        title: "Distributed Systems",
        tags: ["storage", "search"],
        meta: { author: "grace", views: 42 },
      };
      const tokens = tokenizeDocument(doc);
      expect(tokens).toContain("distribut");
      expect(tokens).toContain("system");
      expect(tokens).toContain("storage");
      expect(tokens).toContain("search");
      expect(tokens).toContain("grace");
      expect(tokens).toContain("42");
    });
  });
});
