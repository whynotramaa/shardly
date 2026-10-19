import { describe, expect, it, vi, afterEach } from "vitest";
// Load browser helpers at runtime; the root build deliberately excludes the web TS project.
const workspaceModule = "../web/lib/workspace.ts";
const jobsModule = "../web/lib/jobs.ts";
const examplesModule = "../web/lib/search-examples.ts";
const { exampleQueries } = await import(examplesModule);
const {
  distinctPassages,
  visibleGroups,
  documentMatchHref,
  loadCollections,
  recentSearches,
  loadSavedSearches,
  originalFieldText,
  passageMarks,
  readSearchOptions,
  saveWorkspace,
  searchParams,
  validCollections,
  validSavedSearches,
  validSearchOptions,
  validSynonyms,
} = await import(workspaceModule);
const { newTerminalJobs } = await import(jobsModule);
import type { SearchSnippet } from "../src/types.js";
import type { IngestJob as Job } from "../src/ingest/jobs.js";

const passage: SearchSnippet = {
  field: "readme",
  start: 100,
  end: 111,
  text: "hello world",
  matches: [
    { start: 106, end: 111 },
    { start: 106, end: 111 },
    { start: 108, end: 120 },
  ],
};
afterEach(() => vi.unstubAllGlobals());

it("derives bounded plain-word search examples from actual filenames and content", () => {
  expect(exampleQueries([
    { filename: "notes/crash-recovery.md", content: 'source:private -pending "commit"' },
    { title: "crash recovery", content: "猫 café Unicode" },
    { title: "CRASH RECOVERY" },
    { content: "x a on" },
  ])).toEqual(["crash recovery", "source private", "café Unicode"]);
  const examples = exampleQueries(Array.from({ length: 20 }, (_, i) => ({ title: `document${i}`, content: `content${i}` })));
  expect(examples).toHaveLength(6);
  expect(exampleQueries([{ content: "a".repeat(1000) }, {}])).toEqual([]);
});

describe("passage navigation", () => {
  it("normalizes original offsets, clips and merges repeated overlapping tokens", () => {
    expect(passageMarks(passage)).toEqual([{ start: 6, end: 11 }]);
    expect(
      passageMarks({
        ...passage,
        matches: [
          { start: 90, end: 102 },
          { start: 120, end: 130 },
        ],
      }),
    ).toEqual([{ start: 0, end: 2 }]);
    const marks = passageMarks(passage);
    expect(
      passage.text.slice(0, marks[0]!.start) +
        passage.text.slice(marks[0]!.start, marks[0]!.end),
    ).toBe("hello world");
  });
  it("shows the best passage once and limits additional distinct windows", () => {
    const next = { ...passage, start: 200, end: 211, text: "next window" };
    expect(
      distinctPassages(passage, [passage, { ...passage, start: 105 }, next]),
    ).toEqual([passage, next]);
    expect(
      distinctPassages(
        undefined,
        Array.from({ length: 5 }, (_, i) => ({
          ...passage,
          start: i * 100,
          end: i * 100 + 11,
          text: String(i),
        })),
      ),
    ).toHaveLength(3);
  });
  it("carries the actual field and match range rather than the window start", () => {
    const url = new URL(
      documentMatchHref("doc_1", "hello world", passage),
      "http://local",
    );
    expect(url.pathname).toBe("/document/doc_1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "hello world",
      field: "readme",
      at: "106",
      end: "111",
    });
  });
  it("keeps original whitespace and mirrors nested field text offsets", () => {
    expect(
      originalFieldText(
        { content: "wrong", readme: "# title\n\nhello" },
        "readme",
      ),
    ).toBe("# title\n\nhello");
    expect(
      originalFieldText(
        { topics: ["storage", { value: "index", number: 3 }, null, true] },
        "topics",
      ),
    ).toBe("storage index 3 true");
    expect(originalFieldText({ content: "wrong" }, "missing")).toBe("");
  });
});

describe("saved search and collection boundaries", () => {
  it("round-trips synonyms, exact mode, and an explicitly empty collection scope", () => {
    const options = {
      mode: "any" as const,
      limit: 100,
      offset: 100000,
      docIds: [],
      synonyms: { car: ["automobile"] },
      prefix: true,
    };
    const params = searchParams("car", options, true);
    expect(params.get("synonyms")).toBe('{"car":["automobile"]}');
    expect(params.get("exact")).toBe("true");
    expect(readSearchOptions(params)).toEqual(options);
  });
  it("rejects malformed nested options and out-of-bound URL values", () => {
    for (const options of [
      { synonyms: [] },
      { synonyms: { car: "auto" } },
      { docIds: [5] },
      { limit: 0 },
      { limit: 101 },
      { offset: -1 },
      { offset: 100001 },
      { inspect: "false" },
      { groupBy: "language" },
    ]) {
      expect(validSearchOptions(options)).toBe(false);
    }
    for (const query of [
      "limit=-1",
      "offset=NaN",
      "offset=1.5",
      "synonyms=%5B%5D",
      "synonyms=broken",
      "typos=maybe",
    ]) {
      expect(() => readSearchOptions(new URLSearchParams(query))).toThrow();
    }
    expect(validSynonyms({ car: Array(9).fill("auto") })).toBe(false);
    expect(validSynonyms({ car: [""] })).toBe(false);
    expect(validSynonyms({ car: ["auto"] })).toBe(true);
  });
  it("requires boolean exact and unique valid IDs without requiring unique names", () => {
    const saved = {
      id: "saved_1",
      name: "Car",
      query: "car",
      options: {},
      exact: true,
    };
    expect(validSavedSearches([saved])).toBe(true);
    expect(validSavedSearches([{ ...saved, exact: "false" }])).toBe(false);
    expect(validSavedSearches([saved, saved])).toBe(false);
    expect(
      validCollections([
        { id: "one", name: "Same", docIds: [] },
        { id: "two", name: "Same", docIds: ["doc_1"] },
      ]),
    ).toBe(true);
    for (const docIds of [
      ["../file"],
      [""],
      ["one", "one"],
      Array.from({ length: 1001 }, (_, i) => String(i)),
    ]) {
      expect(
        validCollections([{ id: "collection", name: "Files", docIds }]),
      ).toBe(false);
    }
  });
  it("falls back safely on corrupt browser data and reports failed writes", () => {
    vi.stubGlobal("window", {});
    const storage = {
      getItem: vi.fn(() => '{"broken":'),
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    vi.stubGlobal("localStorage", storage);
    expect(loadCollections()).toEqual([]);
    storage.getItem.mockReturnValue(
      JSON.stringify([
        { id: "a", name: "A", query: "car", options: { synonyms: { car: 3 } } },
      ]),
    );
    expect(loadSavedSearches()).toEqual([]);
    expect(
      saveWorkspace("shardly-collections", [
        { id: "one", name: "One", docIds: [] },
      ]),
    ).toMatch(/storage/);
    expect(
      saveWorkspace("shardly-collections", [
        { id: "one", name: "One", docIds: [5] },
      ]),
    ).toMatch(/IDs/);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});

it("notifies once for each terminal job, including partial failed or cancelled imports", () => {
  const seen = new Set<string>();
  const job = (id: string, status: Job["status"]) => ({ id, status }) as Job;
  expect(newTerminalJobs([job("a", "running")], seen)).toEqual([]);
  expect(
    newTerminalJobs([job("a", "completed"), job("b", "cancelled")], seen),
  ).toHaveLength(2);
  expect(
    newTerminalJobs([job("a", "completed"), job("b", "cancelled")], seen),
  ).toEqual([]);
  expect(newTerminalJobs([job("c", "failed")], seen)).toHaveLength(1);
});

it("keeps documents without grouping metadata reachable even when the API omits their group", () => {
  expect(visibleGroups([{ key: "repo", count: 2 }], 5)).toEqual([
    { key: "repo", count: 2 },
    { key: "", count: 3 },
  ]);
  expect(visibleGroups([{ key: "", count: 3 }], 3)).toEqual([
    { key: "", count: 3 },
  ]);
});


it("round-trips literal and substring search modes and rejects unsupported modes", () => {
  for (const match of ["text", "literal", "substring"] as const) {
    const options = { match, source: "folder", profile: "baseline" as const };
    expect(readSearchOptions(searchParams("std::vector", options))).toEqual(options);
  }
  expect(() => readSearchOptions(new URLSearchParams("match=regex"))).toThrow();
});

it("keeps a bounded recent search history while distinguishing filters and literal matching", () => {
  const entry = (n: number) => ({ id: `search_${n}`, name: `Query ${n}`, query: `q${n}`, options: {} });
  const previous = Array.from({ length: 8 }, (_, i) => entry(i));
  expect(recentSearches({ ...entry(3), id: "new" }, previous)).toHaveLength(8);
  expect(recentSearches({ ...entry(3), id: "new" }, previous)[0].id).toBe("new");
  const different = { ...entry(3), id: "literal", options: { match: "literal" } };
  expect(recentSearches(different, previous).some((item: { id: string }) => item.id === "search_3")).toBe(true);
  expect(recentSearches(entry(99), previous)).toHaveLength(8);
});


it("keeps guided demo reads scoped and refuses responses containing ordinary documents", async () => {
  const apiModule = "../web/lib/api.ts";
  const demoModule = "../web/lib/demo.ts";
  const { searchDemo, compareDemo } = await import(demoModule);
  const { seedDemo } = await import(apiModule);
  const result = { query: "recovery", terms: [], tookMs: 1, total: 1, hits: [{ docId: "demo_1", score: 1, breakdown: [], doc: { source: "demo" } }] };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));
  vi.stubGlobal("fetch", fetchMock);
  await searchDemo("recovery");
  const url = new URL(fetchMock.mock.calls[0]![0]);
  expect(url.pathname).toBe("/demo/search");
  expect(url.searchParams.get("source")).toBe("demo");
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...result, hits: [{ ...result.hits[0], doc: { source: "file" } }] })));
  await expect(searchDemo("recovery")).rejects.toThrow(/outside its scope/);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ baseline: result, tuned: result })));
  await compareDemo("recovery");
  expect(new URL(fetchMock.mock.calls[2]![0]).pathname).toBe("/demo/search/compare");
  expect(JSON.parse(fetchMock.mock.calls[2]![1].body).options.source).toBe("demo");
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "demo unavailable" }), { status: 404 }));
  await expect(seedDemo()).rejects.toThrow("demo unavailable");
  expect(fetchMock.mock.calls.map((call: unknown[]) => String(call[0])).some((url: string) => url.endsWith("/reset"))).toBe(false);
});
