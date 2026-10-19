"use client";

import { useState } from "react";
import Link from "next/link";
import SearchExamples from "@/components/SearchExamples";
import IngestView from "@/components/IngestView";
import GitHubSource from "@/components/GitHubSource";
import FolderSources from "@/components/FolderSources";
import WikipediaLoader from "@/components/WikipediaLoader";

export default function SourcesView({ documents, onChanged }: { documents: number | null; onChanged: () => void }) {
  const [revision, setRevision] = useState(0);
  function changed() { setRevision(value => value + 1); onChanged(); }
  return (
    <div className="page">
      <header className="page-head">
        <h1>Sources</h1>
        <p>{documents === 0 ? "Add your first files below, or connect a repository or folder." : "Everything you add here becomes searchable."}</p>
      </header>
      {!!documents && <section className="source-ready" aria-label="Start searching">
        <p role="status">{documents.toLocaleString()} {documents === 1 ? "document is" : "documents are"} ready to search.</p>
        <Link href="/app" className="button primary small">Search documents</Link>
        <SearchExamples documents={documents} revision={revision} />
      </section>}
      <IngestView onIngested={changed} />
      <div className="sources">
        <GitHubSource onChanged={changed} />
        <FolderSources onChanged={changed} />
        <WikipediaLoader onIngested={changed} />
      </div>
    </div>
  );
}
