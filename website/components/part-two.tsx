import { Chapter, Drawing, TableScroll } from "./guide";
import EngineeringScene from "./engineering-scene";
import { measurements, source, appUrl } from "../lib/facts";

export default function PartTwo() {
  const rows = [
    ["Repository tasks", "Baseline BM25", measurements.workspace.baseline],
    ["Repository tasks", "Tuned fields and passages", measurements.workspace.tuned],
    ["SciFact", "Baseline BM25", measurements.scifact.baseline],
    ["SciFact", "Tuned fields and passages", measurements.scifact.tuned],
  ] as const;
  return <>
    <Chapter id="evidence" title="Fetch the evidence" files={["src/search/evidence.ts", "src/api/retrieval.ts", "src/mcp.ts"]}>
      <p>A search result can help an agent choose a source. A quote needs a stronger connection to that source. Shardly returns a reference that binds a document revision, a field, and a span in the original extracted text.</p>
      <p>A <strong>revision</strong> identifies the content version used by the result. The fetch operation checks that the current document still has that revision. It also checks the caller’s scope. Only then does it return the referenced text.</p>
      <p>In this example, the field is “The WAL records each write.” The span starts at UTF-16 position 4 and ends before position 7.</p>
      <Drawing caption="An illustrative search-to-fetch exchange. The span returns WAL. A changed document invalidates the old reference rather than returning a quote from an unretained version."><EngineeringScene kind="evidence" /></Drawing>
      <p>This design makes stale evidence visible. A changed revision returns <code>stale_reference</code>. A deleted or inaccessible document cannot be fetched as an available source. The client should search again before citing current content.</p>
      <p>The returned text is exact within the extracted field. It is not a byte range in the original PDF, email, or Office file. Extraction may have changed whitespace or omitted visual layout before the document reached storage.</p>
      <h3>Bound the response as well as the work</h3>
      <p>The retrieval API accepts response budgets from 4 to 256 KiB, with a 32 KiB default. One KiB is 1,024 bytes. When a response does not fit, it drops whole hits or items and reports truncation. A consumer must inspect that signal rather than assuming the response contains every match.</p>
      <p>A batch search accepts at most eight queries. A fetch accepts at most 20 items. Lexical pagination cursors bind the query, access scope, and storage generation. A changed generation rejects an old cursor with a conflict instead of continuing an inconsistent result view.</p>
      <p>The read-only Model Context Protocol, or MCP, adapter exposes search, fetch, and status tools over the running API. It does not create another storage writer. An agent can find a passage, fetch its verified text, and cite it without receiving a mutation tool.</p>
      <p>Text inside a retrieved document remains source material. A document asking an agent to execute a command does not gain authority from appearing in search results.</p>
    </Chapter>

    <Chapter id="hybrid" title="Add model retrieval when it helps" files={["src/search/semantic.ts", "src/api/retrieval.ts", "tests/semantic.test.ts"]}>
      <p>Lexical search works well when a question uses the same terms as its source. A differently worded question may need another route. Shardly can use configured embedding and reranking endpoints, including Ollama and OpenAI-compatible embedding services.</p>
      <p>An <strong>embedding</strong> represents text as a vector of numbers. Dense retrieval compares query and passage vectors. The current reference implementation normalizes vectors and computes exact cosine similarity. It does not use an approximate nearest-neighbor index.</p>
      <p>The two routes meet after candidate retrieval. Their scores do not need to share the same numeric scale.</p>
      <Drawing caption="The optional hybrid route. The drawing shows control flow, not measured model performance. Endpoint configuration and installed models are required."><EngineeringScene kind="hybrid" /></Drawing>
      <p><strong>Reciprocal rank fusion</strong> combines lists using each candidate’s position in a list. It is the default fusion method. Weighted fusion is another option. A configured reranker can then reorder the bounded candidate set.</p>
      <p>Each route has a candidate bound from 10 to 200. That bound limits work, but it also limits what fusion and reranking can recover. A relevant document absent from both candidate lists cannot appear through reranking alone. Dense and hybrid results therefore describe a bounded candidate pool, not exhaustive collection pagination.</p>
      <h3>Keep derived vectors tied to their source</h3>
      <p>Semantic backfill is explicit and staged. A vector belongs to a parent document revision. If that revision changes or disappears, its old vectors are excluded. Updating text does not make an older embedding current.</p>
      <p>The semantic cache has several bounds: 20,000 passages, 4,096 dimensions, four million total vector components, and a 128 MiB cache file. Whichever limit is reached first applies. These bounds make this an inspectable local reference path, not an unlimited vector service.</p>
      <p>Model endpoints can time out or fail. The configured fallback path keeps that failure visible. Fixture-provider tests verify the integration behavior. They do not establish that a particular embedding model or reranker improves your documents.</p>
      <p>If an endpoint runs on another machine, sending text to it changes where that text is processed. Choose the provider and access policy deliberately. The default lexical path does not require a model endpoint.</p>
    </Chapter>

    <Chapter id="runtime" title="Keep work bounded" files={["src/runtime/engine.ts", "src/runtime/worker.ts", "src/runtime/extraction.ts"]}>
      <p>A document parser can take longer than a normal API request. A large import can also prevent a single event loop from servicing other work. Shardly separates the HTTP server, engine worker, and extraction workers so they have different responsibilities.</p>
      <p>The drawing shows the actual scheduling boundary. The engine still has one storage writer, even though extraction runs separately.</p>
      <Drawing caption="Runtime responsibilities. Lines show requests and extracted documents, not parallel writes to a shared data directory.">
        <div className="runtime-drawing" tabIndex={0} role="region" aria-label="Scrollable worker architecture diagram"><svg viewBox="0 0 800 310" role="img" aria-label="HTTP server communicates with one engine worker and a separate pool of two extraction workers">
          <rect x="35" y="83" width="202" height="144" className="scene-plate"/><text x="55" y="118">HTTP server</text><text x="55" y="151" className="scene-label">authentication</text><text x="55" y="175" className="scene-label">response budgets</text><text x="55" y="199" className="scene-label">model HTTP requests</text>
          <path d="M248 125H331M248 199H331" className="scene-track" markerEnd="url(#ah)"/><text x="290" y="109" textAnchor="middle" className="scene-label">bounded RPC</text>
          <rect x="348" y="35" width="416" height="110" className="scene-plate"/><text x="370" y="68">Engine worker · one writer</text><text x="370" y="96" className="scene-label">storage + postings + ranking</text><text x="370" y="122" className="scene-label">bulk work yields every 16 documents</text>
          <rect x="348" y="179" width="416" height="97" className="scene-plate"/><text x="370" y="212">Extraction workers · concurrency 2</text><text x="370" y="240" className="scene-label">separate parsing, timeout, and heap limit</text><path d="M685 179V151" className="scene-track" markerEnd="url(#ah)"/>
        </svg></div>
      </Drawing>
      <p>The engine admits at most 32 outstanding remote procedure calls, or RPCs. Bulk import yields every 16 documents. Mutations are serialized. This allows other queued work to make progress without allowing competing writes to the same store.</p>
      <p>Extraction has concurrency two, a 256 MiB old-generation heap limit per worker, and a 120-second timeout. The heap limit does not include every external allocation. OCR subprocesses have separate timeouts. These are concrete bounds, not complete process-memory isolation.</p>
      <p>Model HTTP requests run outside the engine worker. The engine itself can still be occupied by a long synchronous search. Work checks and execution deadlines can reject expensive queries with a validation response, but queue wait is outside that execution deadline.</p>
      <p>This distinction matters when interpreting latency. Separating workers protects the server’s event loop from many engine operations. It does not make one engine execute unlimited searches concurrently, or guarantee a fixed response time under any load.</p>
    </Chapter>

    <Chapter id="access" title="Control who can retrieve a source" files={["src/api/auth.ts", "src/search/filters.ts", "tests/retrieval.test.ts"]}>
      <p>Shardly supports an administrator bearer token and static read tokens with server-owned scopes. A read scope can restrict tenant, principal, and source membership. Retrieval applies that scope before making documents available to the reader.</p>
      <p>The administrator token must have at least 24 characters. Binding the API beyond loopback requires an administrator token. Read tokens require administrator protection too. Keep token configuration on the server, rather than trusting scope fields supplied by the client.</p>
      <p>Reader access is limited to scoped POST search, retrieve, fetch, and batch operations, plus GET status and readiness. The legacy GET search route remains administrator-only. A read token does not grant import, deletion, backup, or workspace mutation access.</p>
      <p>These are static deployment controls. Shardly does not provide an account system, interactive sign-in, or automatic synchronization with a connector’s access-control list. If a source’s permissions change elsewhere, the deployment must update its own scopes and source handling.</p>
      <p>Search filters narrow a result set. They do not replace authorization. Source instructions are also not permissions. Keep those two boundaries intact when building an agent around retrieval.</p>
    </Chapter>

    <Chapter id="workspace" title="Keep the workspace and the documents" files={["src/api/workspace.ts", "src/api/stream-backup.ts", "web/components/LibraryWorkspace.tsx"]}>
      <p>The browser workspace organizes saved searches, collections, and other working state. You can export it, import it, and explicitly save or load server-owned state. Browser-only preferences do not automatically synchronize across devices.</p>
      <p>Document backups use streaming newline-delimited JSON with checksums. Restore validates the complete input before applying additions. It spools input with limits of 256 MiB and 100,000 documents, so validation does not require an unbounded in-memory upload.</p>
      <p>Restore merges documents and rejects ID conflicts rather than silently overwriting existing records. Server-owned workspace state is included in backups. Derived semantic vectors are rebuilt separately.</p>
      <p>Preflight validation is not an all-or-nothing transaction for every later failure. An I/O failure or a conflicting concurrent write can leave already completed additions in place. Inspect the result and current store before retrying. Keep a separate copy of the backup rather than treating compaction as a backup system.</p>
    </Chapter>

    <Chapter id="bench" title="Read the measurements in context" files={["benchmarks/retrieval-2026-10-19.json", "VERIFICATION.md", "scripts/evaluate-workspace.ts", "scripts/evaluate-real.ts"]}>
      <p>The checked-in report was recorded on 19 October 2026 with Node {measurements.node.replace(/^v/, "")} on {measurements.architecture}. It separates retrieval quality, process-kill recovery, and concurrent-work samples. Those measurements answer different questions.</p>
      <p>The table compares two lexical rankers. The repository set contains 24 authored tasks over 20 files. SciFact contains 5,183 abstracts and 300 externally supplied query judgments. The small repository set is useful for regressions, but it is not an independent claim of general quality.</p>
      <TableScroll label="Recorded retrieval quality measurements"><table className="measurements"><caption>Recorded lexical retrieval quality. Higher is better for each metric.</caption><thead><tr><th>Evaluation set</th><th>Ranker</th><th>MRR@10</th><th>nDCG@10</th><th>Recall@10</th></tr></thead><tbody>{rows.map(([name, ranker, values]) => <tr key={name+ranker}><td>{name}</td><td>{ranker}</td><td>{values.MRR10.toFixed(3)}</td><td>{values.nDCG10.toFixed(3)}</td><td>{values.recall10.toFixed(3)}</td></tr>)}</tbody></table></TableScroll>
      <p><strong>Mean reciprocal rank</strong>, or MRR, rewards an early first relevant result. <strong>Normalized discounted cumulative gain</strong>, or nDCG, measures the ordering of judged results. <strong>Recall</strong> measures how many relevant documents were found. Here, each metric stops at the first ten results.</p>
      <p>The tuned path improves repository nDCG from {measurements.workspace.baseline.nDCG10.toFixed(3)} to {measurements.workspace.tuned.nDCG10.toFixed(3)}. On SciFact, it falls from {measurements.scifact.baseline.nDCG10.toFixed(3)} to {measurements.scifact.tuned.nDCG10.toFixed(3)}. That reversal is a reason to evaluate your own questions before choosing a ranker.</p>
      <h3>Latency and durability need separate tests</h3>
      <p>In the SciFact run, baseline search p95 was {measurements.scifact.baseline.p95Ms.toFixed(2)} milliseconds. Tuned search p95 was {measurements.scifact.tuned.p95Ms.toFixed(2)} milliseconds. The 95th percentile, or p95, means 95% of measured requests finished within that duration. It says nothing by itself about whether their answers were relevant.</p>
      <p>The concurrent-import sample used {measurements.concurrentImport.count.toLocaleString("en-US")} documents and {measurements.concurrentImport.search.samples} loopback searches. Search p95 was {measurements.concurrentImport.search.p95Ms.toFixed(2)} milliseconds. The concurrent-compaction sample completed {measurements.maintenance.searchesDuringCompaction} of 40 search responses before compaction finished. Those are bounded single-machine samples, not deployment capacity guarantees.</p>
      <p>The recorded SIGKILL drill completed {measurements.crashRecovery.rounds} rounds with {measurements.crashRecovery.acknowledgedWrites.toLocaleString("en-US")} acknowledged writes, {measurements.crashRecovery.missing} missing writes, and {measurements.crashRecovery.corrupt} corrupt records. This is evidence for that test and environment. It does not turn a process-kill test into a physical power-loss test.</p>
      <p>The <a href={`${appUrl}${appUrl.includes("?") ? "&" : "?"}view=benchmark`}>workspace benchmark</a> lets you compare indexed and naive retrieval on the same collection. Execution time there is a separate measurement from these judged-relevance evaluations. The <a href={source("benchmarks/retrieval-2026-10-19.json")}>raw report</a> retains the recorded methodology and limitations.</p>
      <h3>What remains outside this design</h3>
      <p>Shardly is a single-machine engine with one writer per directory. It has no distributed replication or consensus. Graph retrieval, learned sparse retrieval, late-interaction models, and multimodal search are not shipped here. Neither are a complete web crawler, scheduled connector service, or full complex-document layout reconstruction.</p>
      <p>Real model-quality evaluation and independent personal-document judgments remain open work. The current tests establish specific mechanisms and boundaries. Your collection still needs its own representative questions, relevance judgments, and operating measurements.</p>
    </Chapter>
  </>;
}
