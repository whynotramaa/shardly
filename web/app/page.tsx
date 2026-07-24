"use client";

import { useEffect, useState } from "react";
import { stats } from "@/lib/api";
import IngestView from "@/components/IngestView";
import GitHubView from "@/components/GitHubView";
import SearchView from "@/components/SearchView";
import BenchmarkView from "@/components/BenchmarkView";

type Tab = "benchmark" | "search" | "ingest" | "github";

const TABS: { id: Tab; label: string }[] = [
  { id: "ingest", label: "Upload" },
  { id: "github", label: "GitHub" },
  { id: "search", label: "Search" },
  { id: "benchmark", label: "Benchmark" },
];

export default function Home() {
  // Upload first — the workflow starts by adding your own files.
  const [tab, setTab] = useState<Tab>("ingest");
  const [docCount, setDocCount] = useState<number | null>(null);

  const refreshCount = () => {
    stats()
      .then((s) => setDocCount(s.documents))
      .catch(() => setDocCount(null));
  };

  useEffect(refreshCount, [tab]);

  return (
    <div className="container">
      <div className="header">
        <h1>Shardly</h1>
        <span className="tag">document store · BM25 full-text search</span>
      </div>
      <p className="subtitle">
        Hand-rolled append-only storage, a WAL for crash recovery, an in-memory
        inverted index, and BM25 ranking — no database, no search library.
        {docCount !== null && (
          <>
            {" "}
            <b style={{ color: "var(--text)" }}>
              {docCount.toLocaleString()} documents
            </b>{" "}
            indexed.
          </>
        )}
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "benchmark" && <BenchmarkView />}
      {tab === "search" && <SearchView />}
      {tab === "ingest" && <IngestView onIngested={refreshCount} />}
      {tab === "github" && <GitHubView onIngested={refreshCount} />}
    </div>
  );
}
