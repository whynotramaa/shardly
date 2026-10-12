"use client";

import IngestView from "@/components/IngestView";
import GitHubSource from "@/components/GitHubSource";
import FolderSources from "@/components/FolderSources";
import WikipediaLoader from "@/components/WikipediaLoader";

export default function SourcesView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Sources</h1>
        <p>Everything you add here becomes searchable.</p>
      </header>
      <IngestView onIngested={onChanged} />
      <div className="sources">
        <GitHubSource onChanged={onChanged} />
        <FolderSources onChanged={onChanged} />
        <WikipediaLoader onIngested={onChanged} />
      </div>
    </div>
  );
}
