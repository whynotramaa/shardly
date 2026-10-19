"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listDocuments, search } from "@/lib/api";
import { exampleQueries } from "@/lib/search-examples";

export default function SearchExamples({ documents, revision = 0, onSelect }: { documents: number | null | undefined; revision?: number; onSelect?: (query: string) => void }) {
  const [examples, setExamples] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setExamples([]);
    if (!documents) return;
    void (async () => {
      try {
        const { items } = await listDocuments(0, 8);
        const candidates = exampleQueries(items.map(item => item.doc));
        const matches = await Promise.all(candidates.map(async query => {
          try { return (await search(query, { mode: "any", limit: 1 })).total > 0 ? query : null; }
          catch { return null; }
        }));
        if (active) setExamples(matches.filter((query): query is string => query !== null).slice(0, 3));
      } catch { /* Examples are optional; the search field stays available. */ }
    })();
    return () => { active = false; };
  }, [documents, revision]);
  if (!examples.length) return null;
  return (
    <div className="search-examples">
      <p className="hint">Try a search from your indexed content</p>
      <div className="shortcuts">
        {examples.map(query => onSelect
          ? <button key={query} type="button" className="chip" onClick={() => onSelect(query)}>{query}</button>
          : <Link key={query} className="chip" href={`/app?${new URLSearchParams({ q: query, mode: "any" })}`}>{query}</Link>)}
      </div>
    </div>
  );
}
