"use client";

import { useEffect, useState } from "react";
import { SECTIONS } from "./chrome";

/**
 * Sticky header with a read-progress hairline, plus a fixed index rail on
 * wide screens. Both track the section currently crossing the viewport
 * midpoint, so the rail agrees with what the reader is looking at.
 */
export default function Nav() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [progress, setProgress] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  // Read the effective mode after mount. Before that the button renders a
  // neutral glyph, so the server and client markup agree.
  useEffect(() => {
    const root = document.documentElement;
    const chosen = root.dataset.theme;
    setTheme(
      chosen === "light" || chosen === "dark"
        ? chosen
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
    );
  }, []);

  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("shardly-theme", next);
    } catch {
      // Private browsing refuses storage. The toggle still works this session.
    }
    setTheme(next);
  };

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - doc.clientHeight;
        setProgress(max > 0 ? (doc.scrollTop / max) * 100 : 0);

        const mid = doc.clientHeight * 0.42;
        let current = SECTIONS[0].id;
        for (const s of SECTIONS) {
          const el = document.getElementById(s.id);
          if (el && el.getBoundingClientRect().top <= mid) current = s.id;
        }
        setActive(current);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <a className="top-mark" href="#top">
            <span className="top-glyph" aria-hidden>
              &#9827;
            </span>
            Shardly<b>/</b>manual
          </a>
          <div className="top-right">
            <div className="top-meta">
              <span>v1.0.0</span>
              <span>TypeScript · 2,211 LOC</span>
              <span>{String(Math.round(progress)).padStart(3, "0")}%</span>
            </div>
            <button
              className="top-theme"
              onClick={flip}
              aria-label={
                theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
              }
            >
              <span aria-hidden>{theme === "dark" ? "\u25D1" : "\u25D0"}</span>
              {theme ?? "theme"}
            </button>
            <a
              className="top-gh"
              href="https://github.com/whynotramaa/shardly"
              target="_blank"
              rel="noreferrer"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              GitHub
            </a>
          </div>
        </div>
        <div className="top-progress" style={{ width: `${progress}%` }} />
      </header>

      <nav className="rail" aria-label="Section index">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-on={active === s.id ? "1" : "0"}
          >
            <i />
            {s.n}
            <span>{s.title}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
