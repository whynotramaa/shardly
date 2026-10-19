"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { stats } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";
import DemoView from "@/components/DemoView";
import SearchView from "@/components/SearchView";
import SourcesView from "@/components/SourcesView";
import LibraryWorkspace from "@/components/LibraryWorkspace";
import BenchmarkView from "@/components/BenchmarkView";
import EngineView from "@/components/EngineView";
import { Brand, Icon, type IconName } from "@/components/ui";

type Tab = "search" | "sources" | "library" | "engine" | "benchmark";
const TABS: Array<[Tab, string, IconName, string]> = [
  ["search", "Search", "search", "Find passages"],
  ["sources", "Sources", "upload", "Add files, repos, folders"],
  ["library", "Library", "bookmark", "Saved work and documents"],
  ["engine", "Engine", "pulse", "Rebuild, backup, inspect"],
  ["benchmark", "Benchmark", "pulse", "Compare index and full scan"],
];

export default function Workspace() {
  return <Suspense fallback={<div className="shell" />}><WorkspaceInner /></Suspense>;
}

function WorkspaceInner() {
  const params = useSearchParams();
  const demo = params.get("demo") === "true";
  const view = params.get("view");
  const tab: Tab = TABS.some(([t]) => t === view) ? (view as Tab) : "search";
  const [docCount, setDocCount] = useState<number | null>(null);
  const refreshCount = () => stats().then((s) => setDocCount(s.documents)).catch(() => setDocCount(null));
  useEffect(() => { if (!demo) void refreshCount(); }, [tab, demo]);
  function href(next: Tab) {
    const p = new URLSearchParams(params.toString());
    if (next === "search") p.delete("view"); else p.set("view", next);
    const s = p.toString();
    return s ? `/app?${s}` : "/app";
  }
  const current = TABS.find(([t]) => t === tab)!;
  return (
    <div className="shell">
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="topbar">
        <div className="topbar-left">
          <Brand href="/app" />
          {!demo && tab !== "search" && tab !== "benchmark" && <><span className="crumb-sep" aria-hidden>/</span><span className="crumb">{current[1]}</span></>}
        </div>
        <div className="topbar-right">
          {!demo && docCount !== null && <span className="doc-count">{docCount.toLocaleString()} docs</span>}
          {!demo && <nav aria-label="Benchmark"><Link href={href("benchmark")} className="nav-link" aria-current={tab === "benchmark" ? "page" : undefined}>Benchmark</Link></nav>}
          <ThemeToggle />
          {!demo && <>
            <button className="icon-button" popoverTarget="ws-menu" aria-label="Open menu"><Icon name="menu" /></button>
            <nav id="ws-menu" popover="auto" className="menu ws-menu" aria-label="Workspace">
              {TABS.filter(([t]) => t !== "benchmark").map(([t, label, icon, hint]) => (
                <Link key={t} href={href(t)} aria-current={tab === t ? "page" : undefined} className="menu-item" onClick={() => document.getElementById("ws-menu")?.hidePopover()}>
                  <Icon name={icon} /><span>{label}<small>{hint}</small></span>
                </Link>
              ))}
              <hr />
              <Link href="/engineering" className="menu-item"><Icon name="book" /><span>How it works</span></Link>
            </nav>
          </>}
        </div>
      </header>
      <main id="content" tabIndex={-1} key={demo ? "demo" : tab}>
        {demo ? <DemoView />
          : tab === "search" ? <SearchView documents={docCount} sourcesHref={href("sources")} />
          : tab === "sources" ? <SourcesView documents={docCount} onChanged={refreshCount} />
          : tab === "library" ? <LibraryWorkspace />
          : tab === "benchmark" ? <BenchmarkView />
          : <EngineView onChanged={refreshCount} />}
      </main>
    </div>
  );
}
