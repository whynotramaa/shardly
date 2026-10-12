import { describe, expect, it } from "vitest";
import { tokenize as engineTokens } from "../src/search/tokenizer.js";
import { tokenize as labTokens } from "../website/lib/shardly.js";

describe("illustrated analyzer lab", () => {
  it("agrees with engine analysis for Unicode and identifier examples", () => {
    for (const text of ["Zürich cafés are running distributed queries", "cafe\u0301 हिन्दी 東京", "writeWithId source_id HTTPServer", "the cat and caches", "storage recovery"]) {
      expect(labTokens(text)).toEqual(engineTokens(text));
    }
  });
});
