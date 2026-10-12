import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/engine.js";
import { Storage } from "../src/storage/storage.js";
import { InvertedIndexStore } from "../src/search/index.js";

async function isolated(run: (engine: Engine, dir: string) => void | Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shardly-next-engine-"));
  const engine = new Engine(dir);
  try { await run(engine, dir); } finally { engine.close(); fs.rmSync(dir, { recursive:true, force:true }); }
}

describe("packed engine and bounded cache", () => {
  it("stores numeric postings and token offsets, bounds cache and counts real misses", async () => isolated((engine) => {
    const ids = engine.addDocuments(Array.from({length:180}, (_,i) => ({sourceId:`x:${i}`, content:`quartz unique${i}`})));
    const diagnostics = engine.diagnostics() as {postingMemory:{packedBytes:number;objectEstimateBytes:number;tokenBytes:number};documentCache:{entries:number;bytes:number;maxBytes:number}};
    expect(diagnostics.postingMemory.packedBytes).toBeLessThan(diagnostics.postingMemory.objectEstimateBytes);
    expect(diagnostics.postingMemory.tokenBytes).toBeGreaterThan(0);
    expect(diagnostics.documentCache.entries).toBe(128);
    expect(diagnostics.documentCache.bytes).toBeLessThanOrEqual(diagnostics.documentCache.maxBytes);
    const spy = vi.spyOn(Storage.prototype,"read");
    try {
      const cold = engine.search("unique0",{inspect:true});
      expect(cold.hits[0]?.docId).toBe(ids[0]);
      expect(cold.inspector?.documentReads).toBe(spy.mock.calls.length);
      expect(cold.inspector?.documentReads).toBe(1);
      expect(engine.search("unique0",{inspect:true}).inspector?.documentReads).toBe(0);
      engine.ingestDocuments([{sourceId:"x:0",content:"zircon"}]);
      expect(engine.search("unique0").total).toBe(0);
      expect(engine.search("zircon").hits[0]?.docId).toBe(ids[0]);
      engine.deleteDocument(ids[0]!);
      expect(engine.search("zircon").total).toBe(0);
    } finally { spy.mockRestore(); }
  }));
  it("does not automatically serialize the full-text index and recovers from WAL without it", async () => isolated((engine,dir) => {
    const spy = vi.spyOn(InvertedIndexStore.prototype,"snapshot");
    try {
      engine.addDocuments(Array.from({length:510},(_,i) => ({content:`recovery${i}`})));
      expect(spy).not.toHaveBeenCalled();
      const independent = fs.mkdtempSync(path.join(os.tmpdir(),"shardly-recovery-copy-"));
      try {
        fs.cpSync(dir,independent,{recursive:true});
        for (const file of fs.readdirSync(independent)) if (file.includes("lock")) fs.rmSync(path.join(independent,file),{recursive:true,force:true});
        const recovered = new Engine(independent);
        try { expect(recovered.documentCount()).toBe(510); expect(recovered.search("recovery0").total).toBe(1); } finally { recovered.close(); }
      } finally { fs.rmSync(independent,{recursive:true,force:true}); }
    } finally { spy.mockRestore(); }
  }));
});

describe("original code literals", () => {
  it("escapes symbols, preserves case and offsets, and does not stem literals", async () => isolated(engine => {
    const content = "猫\nconst running = Foo::bar(a.b); // [x] C++ => 🌟";
    const id = engine.addDocument({content});
    for (const query of ["Foo::bar", "a.b", "[x]", "C++", "=>", "🌟"]) {
      const hit = engine.search(query,{match:"literal"}).hits[0]!;
      expect(hit.docId).toBe(id);
      const range = hit.snippet!.matches[0]!;
      expect(content.slice(range.start,range.end)).toBe(query);
      expect(hit.snippet!.line).toBe(2);
    }
    expect(engine.search("foo::BAR",{match:"literal"}).total).toBe(0);
    expect(engine.search("foo::BAR",{match:"substring"}).total).toBe(1);
    expect(engine.search("run",{match:"literal"}).hits[0]?.snippet?.matches[0]).toEqual({start:8,end:11});
    expect(engine.search("running",{match:"literal"}).hits[0]?.snippet?.matches[0]).toEqual({start:8,end:15});
    expect(engine.search("a.b",{match:"literal",source:"wrong"}).total).toBe(0);
    expect(() => engine.search("+",{match:"substring"})).toThrow(/at least 2/);
  }));
  it("fails safely on oversized scopes and text", async () => isolated(engine => {
    const id = engine.addDocument({content:"x".repeat(8*1024*1024+1)});
    expect(() => engine.search("xx",{match:"substring",docIds:[id]})).toThrow(/8 Mi/);
    engine.reset();
    engine.addDocuments(Array.from({length:2001},() => ({content:"symbol"})));
    expect(() => engine.search("symbol",{match:"literal"})).toThrow(/2000/);
  }));
});

describe("missing match explanations", () => {
  it("distinguishes semantic failure from rank/page exclusion", async () => isolated(engine => {
    engine.restoreBackup({version:1,documents:[
      {id:"a",doc:{content:"quartz the crystal",source:"local"}},
      {id:"b",doc:{content:"quartz",source:"github"}},
      {id:"c",doc:{content:"zircon",source:"local"}},
    ]});
    expect(engine.explainMissing("the","a").reasons[0]?.code).toBe("stopwords");
    expect(engine.explainMissing("quartz","a",{source:"github"}).reasons[0]?.code).toBe("filter");
    expect(engine.explainMissing('"quartz crystal"',"a").reasons.some(r=>r.code==="phrase")).toBe(true);
    expect(engine.explainMissing("quartz -crystal","a").reasons.some(r=>r.code==="exclusion")).toBe(true);
    expect(engine.explainMissing("gem","a",{synonyms:{gem:["zircon"]}}).reasons.some(r=>r.code==="expansion")).toBe(true);
    expect(engine.explainMissing("quartz","missing").reasons[0]?.code).toBe("missing_document");
    const full = engine.search("quartz",{limit:10});
    const first=full.hits[0]!.docId,last=full.hits[1]!.docId;
    expect(engine.explainMissing("quartz",last,{limit:1})).toMatchObject({matched:true,returned:false,rank:2,reasons:[{code:"rank"}]});
    expect(engine.explainMissing("quartz",first,{offset:1,limit:1})).toMatchObject({matched:true,returned:false,rank:1,reasons:[{code:"page"}]});
    expect(engine.explainMissing("quartz",first,{limit:1})).toMatchObject({matched:true,returned:true,reasons:[]});
    expect(engine.explainMissing("::","a",{match:"literal"}).reasons[0]?.code).toBe("literal");
  }));
});

describe("shadow rebuild", () => {
  it("yields, publishes progress, preserves old index on cancel/mutation/failure and swaps on success", async () => isolated(async engine => {
    engine.addDocuments(Array.from({length:12},(_,i)=>({content:`quartz unique${i}`})));
    const original = (engine as unknown as {index:InvertedIndexStore}).index;
    let task = engine.rebuildIndex({batchSize:1});
    expect(engine.rebuildStatus().state).toBe("running");
    await expect(engine.rebuildIndex()).rejects.toThrow(/already running/);
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(engine.rebuildStatus().processed).toBeGreaterThan(0);
    expect(engine.search("quartz").total).toBe(12);
    expect(engine.cancelRebuild()).toBe(true);
    expect((await task).state).toBe("cancelled");
    expect((engine as unknown as {index:InvertedIndexStore}).index).toBe(original);
    task=engine.rebuildIndex({batchSize:1});
    engine.addDocument({content:"mutation"});
    expect((await task).state).toBe("stale");
    expect(engine.search("mutation").total).toBe(1);
    const spy=vi.spyOn(Storage.prototype,"read").mockImplementation(()=>{throw new Error("read failure");});
    try { expect(await engine.rebuildIndex()).toMatchObject({state:"failed",error:"read failure"}); } finally {spy.mockRestore();}
    expect((engine as unknown as {index:InvertedIndexStore}).index).toBe(original);
    expect(await engine.rebuildIndex({batchSize:2})).toMatchObject({state:"completed",processed:13,total:13});
    expect((engine as unknown as {index:InvertedIndexStore}).index).not.toBe(original);
    expect(engine.search("quartz").total).toBe(12);
    const signal=AbortSignal.abort();
    expect((await engine.rebuildIndex({signal})).state).toBe("cancelled");
  }));
});

it("loads legacy posting caches and rejects corrupt numeric references without mutating the index", async () => isolated((engine,dir) => {
  const index = new InvertedIndexStore();
  index.addDocument("preserved",["quartz"]);
  const legacy = {formatVersion:3,version:9,index:{zircon:[{docId:"old",termFrequency:2}]},docFreq:{zircon:1},docLengths:{old:2},totalTokens:2};
  const file=path.join(dir,"legacy-cache.json");
  const sign = (body:object) => ({...body,checksum:createHash("sha256").update(JSON.stringify(body)).digest("hex")});
  fs.writeFileSync(file,JSON.stringify(sign(legacy)));
  expect(index.load(file)).toBe(9);
  expect(index.postings("zircon")).toEqual([{docId:"old",termFrequency:2}]);
  index.removeDocument("old");
  index.addDocument("new",["quartz"]);
  index.snapshot(file,10);
  const snapshot=JSON.parse(fs.readFileSync(file,"utf8"));
  expect(snapshot.formatVersion).toBe(4);
  expect(snapshot.index.quartz).toEqual([0,1]);
  snapshot.index.quartz[0]=99;
  const {checksum,...body}=snapshot;
  fs.writeFileSync(file,JSON.stringify(sign(body)));
  expect(()=>index.load(file)).toThrow(/invalid posting/);
  expect(index.postings("quartz")).toEqual([{docId:"new",termFrequency:1}]);
}));

it("bounds missing-match rank inspection and reports unknown ranks beyond its budget", async () => isolated(engine => {
  engine.restoreBackup({version:1,documents:Array.from({length:1005},(_,i)=>({id:`id-${String(i).padStart(4,"0")}`,doc:{content:"commonquartz"}}))});
  const spy=vi.spyOn(engine,"search");
  try {
    const explanation=engine.explainMissing("commonquartz","id-1004",{limit:1});
    expect(explanation).toMatchObject({matched:true,returned:false,reasons:[{code:"rank_unknown"}]});
    expect(explanation.rank).toBeUndefined();
    expect(explanation.reasons[0]?.detail).toContain("1000");
    expect(explanation.reasons[0]?.detail).not.toContain("undefined");
    expect(spy.mock.calls).toHaveLength(3);
    expect(engine.explainMissing("commonquartz","id-1004",{offset:1000,limit:5})).toMatchObject({matched:true,returned:true,rank:1005});
  } finally {spy.mockRestore();}
}));
