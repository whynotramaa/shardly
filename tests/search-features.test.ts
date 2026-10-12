import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { Storage } from "../src/storage/storage.js";
import { dataPaths } from "../src/config.js";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/engine.js";
import { tokenizeDetailed } from "../src/search/tokenizer.js";

describe("search feature primitives", () => {
  it("keeps Unicode offsets and stopword gaps", () => {
    const tokens = tokenizeDetailed("猫 the café");
    expect(tokens.map((t) => t.term)).toEqual(["猫", "café"]);
    expect(tokens[0]!.start).toBe(0);
    expect(tokens[1]!.start).toBe("猫 the ".length);
    expect(tokens[1]!.position).toBe(2);
  });

  it("indexes identifiers exactly and as searchable parts", () => {
    expect(
      tokenizeDetailed("writeWithId source_id").map((t) => t.term),
    ).toEqual([
      "writewithid",
      "write",
      "with",
      "id",
      "source_id",
      "source",
      "id",
    ]);
  });

  it("handles phrases, gaps, filters, exclusion, fields, and inspector reads", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-search-"));
    const engine = new Engine(dir);
    engine.ingestDocuments([
      {
        sourceId: "a",
        source: "github",
        repo: "one",
        title: "Unicode",
        content: "猫 the café; distant words",
      },
      {
        sourceId: "b",
        source: "wiki",
        repo: "two",
        title: "Code",
        content: "猫 café",
      },
    ]);
    expect(engine.search('"猫 the café"').hits).toHaveLength(1);
    expect(engine.search('"猫 café"').total).toBe(1);
    expect(engine.search("source:github").hits[0]?.doc.source).toBe("github");
    expect(engine.search("source:github -distant").hits).toHaveLength(0);
    const inspected = engine.search("café", { inspect: true });
    expect(inspected.inspector?.documentReads).toBe(0);
    expect(inspected.hits[0]?.passages?.[0]?.matches.length).toBeGreaterThan(0);
    const compared = engine.compare("café");
    expect(compared.baseline.hits.length).toBeGreaterThan(0);
    expect(
      engine.search("café", { groupBy: "repo", limit: 2 }).hits[0]?.groupKey,
    ).toBeTruthy();
    expect(
      engine.search("source:github", { limit: 1 }).facets.source[0],
    ).toEqual({ value: "github", count: 1 });
    expect(() => engine.search("-missing")).toThrow(/searchable term/);
    engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("updates stable source IDs, preserves them across restart, and rejects backup conflicts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-ingest-"));
    let engine = new Engine(dir);
    const first = engine.ingestDocuments([
      { sourceId: "upload:x:0", title: "old", content: "alpha" },
    ]);
    expect(first.added).toBe(1);
    const updated = engine.ingestDocuments([
      { sourceId: "upload:x:0", title: "new", content: "beta" },
    ]);
    expect(updated.updated).toBe(1);
    expect(updated.ids[0]).toBe(first.ids[0]);
    expect(() =>
      engine.restoreBackup({
        version: 1,
        documents: [{ id: first.ids[0], doc: { content: "conflict" } }],
      }),
    ).toThrow(/conflicts/);
    engine.close();
    engine = new Engine(dir);
    expect(engine.getDocument(first.ids[0]!)).toEqual({
      sourceId: "upload:x:0",
      title: "new",
      content: "beta",
    });
    engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

function withEngine(run: (engine: Engine, dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-regression-"));
  const engine = new Engine(dir);
  try {
    run(engine, dir);
  } finally {
    engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("ranking and bounded retrieval", () => {
  it("normalizes each field and favors title/path matches over body matches", () =>
    withEngine((engine) => {
      engine.restoreBackup({
        version: 1,
        documents: [
          {
            id: "title",
            doc: { title: "quartz", content: "padding ".repeat(2000) },
          },
          { id: "body", doc: { title: "manual", content: "quartz" } },
          {
            id: "path",
            doc: { path: "src/quartz.ts", content: "padding ".repeat(2000) },
          },
        ],
      });
      const tuned = engine.search("quartz").hits;
      expect(tuned.map((h) => h.docId)).toEqual(["title", "path", "body"]);
      expect(
        engine.search("quartz", { profile: "baseline" }).hits[0]?.docId,
      ).toBe("body");
      for (const h of tuned)
        expect(
          h.breakdown.reduce((sum, t) => sum + t.contribution, 0),
        ).toBeCloseTo(h.score, 10);
    }));

  it("scores the best passage instead of penalizing a long parent and returns PDF offsets", () =>
    withEngine((engine) => {
      const section = "quartz crystal quartz crystal ";
      const prefix = "padding ".repeat(900) + "\n";
      const content = prefix + section + "padding ".repeat(900);
      engine.restoreBackup({
        version: 1,
        documents: [
          {
            id: "long",
            doc: {
              content,
              type: "pdf",
              pageOffsets: [
                { page: 1, start: 0, end: prefix.length },
                { page: 2, start: prefix.length, end: content.length },
              ],
            },
          },
          { id: "brief", doc: { content: section + "padding ".repeat(116) } },
        ],
      });
      const result = engine.search("quartz crystal");
      const long = result.hits.find((h) => h.docId === "long")!;
      const brief = result.hits.find((h) => h.docId === "brief")!;
      expect(long.score).toBeGreaterThanOrEqual(brief.score * 0.95);
      expect(result.hits.filter((h) => h.docId === "long")).toHaveLength(1);
      expect(long.snippet?.page).toBe(2);
      expect(long.snippet?.line).toBe(2);
      for (const snippet of long.passages!) {
        expect(snippet.text).toBe(content.slice(snippet.start, snippet.end));
        for (const match of snippet.matches)
          expect(content.slice(match.start, match.end)).toMatch(
            /quartz|crystal/,
          );
      }
    }));

  it("uses exact surface phrases with stopwords and never crosses fields", () =>
    withEngine((engine) => {
      engine.addDocuments([
        { title: "red", content: "fox the and" },
        { content: "red the fox" },
        { content: "red and fox" },
        { content: "red fox the and" },
      ]);
      expect(engine.search('"red fox"').total).toBe(1);
      expect(engine.search('"red the fox"').total).toBe(1);
      expect(engine.search('"the and"').total).toBe(2);
      expect(engine.search('"the and"').hits[0]?.snippet?.matches).toHaveLength(
        2,
      );
      expect(engine.search('"red of fox"').total).toBe(0);
      expect(() => engine.search('"red')).toThrow(/unterminated/);
      expect(() => engine.search("q".repeat(4097))).toThrow(/4096/);
    }));

  it("intersects metadata before scoring and handles all/any and exclusion", () =>
    withEngine((engine) => {
      engine.addDocuments([
        {
          content: "quartz crystal",
          source: "local",
          repo: "one",
          type: "md",
          language: "en",
        },
        {
          content: "quartz",
          source: "local",
          repo: "two",
          type: "md",
          language: "en",
        },
        {
          content: "crystal",
          source: "github",
          repo: "one",
          type: "ts",
          language: "en",
        },
      ]);
      expect(engine.search("quartz crystal", { mode: "all" }).total).toBe(1);
      expect(engine.search("quartz crystal", { mode: "any" }).total).toBe(3);
      const scoped = engine.search("source:local quartz", {
        repo: "one",
        type: "md",
        language: "en",
        inspect: true,
      });
      expect(scoped.total).toBe(1);
      expect(scoped.inspector?.candidateCount).toBe(1);
      expect(engine.search("source:local -crystal").total).toBe(1);
      expect(scoped.inspector?.documentSource).toBe("memory");
      const stages = scoped.inspector!.stageMs;
      const summed = Object.entries(stages)
        .filter(([name]) => name !== "total")
        .reduce((sum, [, ms]) => sum + ms, 0);
      expect(summed).toBeLessThanOrEqual(stages.total!);
      expect(stages.read).not.toBe(stages.score);
    }));

  it("expands prefix/typos/synonyms with exact matches preferred and invalidates caches on update", () =>
    withEngine((engine) => {
      engine.restoreBackup({
        version: 1,
        documents: [
          { id: "exact", doc: { sourceId: "x", content: "quartz" } },
          { id: "typo", doc: { content: "quartx" } },
          { id: "syn", doc: { content: "crystal" } },
        ],
      });
      expect(engine.search("quartz", { typos: true }).hits[0]?.docId).toBe(
        "exact",
      );
      expect(engine.search("quar", { prefix: true }).total).toBe(2);
      expect(
        engine.search("gem", { synonyms: { gem: ["crystal"] } }).hits[0]?.docId,
      ).toBe("syn");
      expect(engine.search("qa", { typos: true }).total).toBe(0);
      engine.ingestDocuments([{ sourceId: "x", content: "zircon" }]);
      expect(engine.suggest("quar")).toEqual(["quartx"]);
      expect(engine.search("zircn", { typos: true }).total).toBe(1);
    }));

  it("keeps paginated and grouped heaps stable, unique, and facets unpaginated", () =>
    withEngine((engine) => {
      engine.restoreBackup({
        version: 1,
        documents: Array.from({ length: 60 }, (_, i) => ({
          id: `id-${String(i).padStart(2, "0")}`,
          doc: { content: "quartz", source: "local", repo: `repo-${i % 3}` },
        })),
      });
      for (const groupBy of ["none", "repo"] as const) {
        const full = engine.search("quartz", { limit: 60, groupBy });
        const pages = Array.from(
          { length: 6 },
          (_, i) =>
            engine.search("quartz", { offset: i * 10, limit: 10, groupBy })
              .hits,
        ).flat();
        expect(pages.map((h) => h.docId)).toEqual(
          full.hits.map((h) => h.docId),
        );
        expect(new Set(pages.map((h) => h.docId)).size).toBe(60);
        expect(
          engine.search("quartz", { limit: 1, groupBy }).facets.source,
        ).toEqual([{ value: "local", count: 60 }]);
        if (groupBy === "repo")
          expect(
            new Set(full.hits.slice(0, 3).map((h) => h.groupKey)).size,
          ).toBe(3);
      }
      expect(
        engine.search("quartz", { limit: 0, groupBy: "repo" }).hits,
      ).toEqual([]);
    }));
});

describe("durable ingestion and cache recovery", () => {
  it("returns an ID for every input, batches new records, and keeps the last repeated source version", () =>
    withEngine((engine) => {
      const result = engine.ingestDocuments([
        { sourceId: "same", content: "alpha" },
        { sourceId: "other", content: "other" },
        { sourceId: "same", content: "alpha" },
        { sourceId: "same", content: "beta" },
        { sourceId: "same", content: "alpha" },
      ]);
      expect(result.ids).toHaveLength(5);
      expect(result.ids[0]).toBe(result.ids[2]);
      expect(result.ids[0]).toBe(result.ids[4]);
      expect(result).toMatchObject({ added: 2, updated: 2, duplicates: 1 });
      expect(engine.getDocument(result.ids[0]!)?.content).toBe("alpha");
      expect(engine.search("beta").total).toBe(0);
      engine.deleteDocument(result.ids[0]!);
      expect(
        engine.ingestDocuments([{ sourceId: "same", content: "gamma" }]).added,
      ).toBe(1);
    }));

  it("derives legacy Wikipedia and GitHub identities across updates", () =>
    withEngine((engine) => {
      const wiki = engine.addDocument({
        source: "wikipedia",
        pageid: 42,
        content: "old",
      });
      const git = engine.addDocument({
        source: "github",
        fullName: "User/Repo",
        path: "src/x.ts",
        content: "old",
      });
      const result = engine.ingestDocuments([
        { source: "wikipedia", pageid: 42, content: "new" },
        {
          source: "github",
          fullName: "user/repo",
          path: "src/x.ts",
          content: "new",
        },
      ]);
      expect(result.ids).toEqual([wiki, git]);
      expect(result.updated).toBe(2);
      expect(engine.search("old").total).toBe(0);
    }));

  it("validates every backup entry before writing any record", () =>
    withEngine((engine) => {
      const id = engine.addDocument({ content: "preserved" });
      const before = engine.exportBackup();
      for (const documents of [
        [
          { id: "new", doc: { content: "new" } },
          { id, doc: { content: "conflict" } },
        ],
        [
          { id: "new", doc: { content: "new" } },
          { id: "bad\nid", doc: {} },
        ],
        [
          { id: "new", doc: { content: "new" } },
          { id: "other", doc: { value: NaN } },
        ],
        [
          { id: "new", doc: {} },
          { id: "new", doc: {} },
        ],
      ]) {
        expect(() => engine.restoreBackup({ version: 1, documents })).toThrow();
        expect(engine.exportBackup()).toEqual(before);
      }
    }));

  it("rebuilds corrupt and stale caches from storage without losing updates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-cache-"));
    let engine = new Engine(dir);
    try {
      const id = engine.ingestDocuments([{ sourceId: "x", content: "quartz" }])
        .ids[0]!;
      engine.close();
      const target = dataPaths(dir).invertedSnapshot;
      fs.writeFileSync(target, '{"formatVersion":3,"index":{"quartz":[null]}}');
      engine = new Engine(dir);
      expect(engine.search("quartz").hits[0]?.docId).toBe(id);
      engine.ingestDocuments([{ sourceId: "x", content: "zircon" }]);
      engine.close();
      const stale = JSON.parse(fs.readFileSync(target, "utf8"));
      stale.version = -1;
      const { checksum, ...body } = stale;
      stale.checksum = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex");
      fs.writeFileSync(target, JSON.stringify(stale));
      engine = new Engine(dir);
      expect(engine.search("quartz").total).toBe(0);
      expect(engine.search("zircon").total).toBe(1);
      const diagnostics = engine.diagnostics() as {
        memoryBytes: number;
        terms: Array<{ postings: unknown[] }>;
      };
      expect(diagnostics.memoryBytes).toBeGreaterThan(0);
      expect(diagnostics.terms.length).toBeLessThanOrEqual(50);
      expect(diagnostics.terms.every((t) => t.postings.length <= 20)).toBe(
        true,
      );
    } finally {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cache isolation and committed failure handling", () => {
  it("isolates caller and returned documents from durable indexed content", () =>
    withEngine((engine) => {
      const doc = {
        sourceId: "x",
        title: "quartz",
        nested: { note: "original" },
      };
      const id = engine.addDocument(doc);
      doc.title = "mutated";
      doc.nested.note = "changed";
      const hit = engine.search("quartz").hits[0]!;
      expect(hit.doc.title).toBe("quartz");
      (hit.doc.nested as { note: string }).note = "changed again";
      hit.doc.title = "changed again";
      const backup = engine.exportBackup();
      backup.documents[0]!.doc.title = "backup mutation";
      expect(engine.getDocument(id)?.title).toBe("quartz");
      expect(engine.search("quartz").hits[0]?.doc.nested).toEqual({
        note: "original",
      });
      expect(engine.exportBackup().documents[0]?.doc.title).toBe("quartz");
      expect(
        engine.ingestDocuments([
          { sourceId: "x", title: "quartz", nested: { note: "original" } },
        ]).duplicates,
      ).toBe(1);
    }));

  it.each([false, true])(
    "keeps caches consistent with reset commit=%s after rename failure",
    (afterRename) =>
      withEngine((engine, dir) => {
        engine.addDocument({ content: "quartz" });
        engine.snapshot();
        const rename = fs.renameSync;
        let renames = 0;
        const spy = vi
          .spyOn(fs, "renameSync")
          .mockImplementation((from, to) => {
            if (
              String(to).endsWith("offset-index.snapshot.json") &&
              ++renames === 2
            ) {
              if (afterRename) rename(from, to);
              throw new Error("reset rename failure");
            }
            rename(from, to);
          });
        try {
          expect(() => engine.reset()).toThrow(/reset rename failure/);
        } finally {
          spy.mockRestore();
        }
        expect(engine.documentCount()).toBe(afterRename ? 0 : 1);
        expect(engine.search("quartz").total).toBe(afterRename ? 0 : 1);
        expect(engine.exportBackup().documents.length).toBe(
          afterRename ? 0 : 1,
        );
      }),
  );

  it("clears committed reset caches after directory fsync failure", () =>
    withEngine((engine, dir) => {
      engine.addDocument({ content: "quartz" });
      engine.snapshot();
      const sync = fs.fsyncSync,
        rename = fs.renameSync;
      let committed = false,
        renames = 0;
      const renameSpy = vi
        .spyOn(fs, "renameSync")
        .mockImplementation((from, to) => {
          rename(from, to);
          if (
            String(to).endsWith("offset-index.snapshot.json") &&
            ++renames === 2
          )
            committed = true;
        });
      const syncSpy = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        if (
          committed &&
          fs.fstatSync(fd).isDirectory() &&
          fs.readlinkSync(`/proc/self/fd/${fd}`) === path.join(dir, "index")
        )
          throw new Error("reset directory fsync failure");
        sync(fd);
      });
      try {
        expect(() => engine.reset()).toThrow(/directory fsync/);
      } finally {
        syncSpy.mockRestore();
        renameSpy.mockRestore();
      }
      expect(engine.documentCount()).toBe(0);
      expect(engine.search("quartz").total).toBe(0);
    }));

  it("releases the lock when close snapshot fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-close-"));
    const engine = new Engine(dir);
    const spy = vi.spyOn(engine, "snapshot").mockImplementation(() => {
      throw new Error("snapshot failure");
    });
    try {
      expect(() => engine.close()).toThrow(/snapshot failure/);
      spy.mockRestore();
      const reopened = new Engine(dir);
      reopened.close();
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("releases the storage lock when engine hydration fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-hydrate-"));
  const first = new Engine(dir);
  first.addDocument({ content: "quartz" });
  first.close();
  const spy = vi.spyOn(Storage.prototype, "read").mockImplementation(() => {
    throw new Error("read failure");
  });
  try {
    expect(() => new Engine(dir)).toThrow(/read failure/);
  } finally {
    spy.mockRestore();
  }
  try {
    const reopened = new Engine(dir);
    expect(reopened.search("quartz").total).toBe(1);
    reopened.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("updates a legacy GitHub repository with its current explicit stable identity", () =>
  withEngine((engine) => {
    const id = engine.addDocument({
      source: "github",
      fullName: "User/Repo",
      content: "old",
    });
    const updated = engine.ingestDocuments([
      {
        source: "github",
        sourceId: "github:user/repo:repository",
        fullName: "user/repo",
        content: "new",
      },
    ]);
    expect(updated.ids).toEqual([id]);
    expect(updated.updated).toBe(1);
    expect(engine.search("old").total).toBe(0);
  }));
