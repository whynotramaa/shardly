"use client";

import { useEffect, useState } from "react";
import { chapters } from "../lib/chapters";
import { appUrl, REPO } from "../lib/facts";

const SECTIONS = chapters.map(([id, title]) => ({ id, title }));

/** The rail follows the chapter crossing the reading viewport. */
export default function Nav() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
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

  return <>
  <header className="top">
    <div className="top-in">
      <a className="top-mark" href="#top"><strong>Shardly</strong> <b>/</b> <span>engineering</span></a>
      <div className="top-right"><a className="repo-link" href={REPO}>Source</a><button className="top-theme" onClick={flip} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? "Light mode" : "Dark mode"}</button><a className="top-gh" href={appUrl}>Open app <span aria-hidden="true">↗</span></a></div>
    </div>
    <div className="top-progress" style={{ width: `${progress}%` }} />
  </header>
  <nav className="preview-rail" aria-label="Guide chapters">
    {chapters.map(([id, title, summary]) => <a key={id} href={`#${id}`} aria-label={title} aria-describedby={`preview-${id}`} aria-current={active === id ? "location" : undefined} data-dismissed={dismissed === id} onFocus={() => setDismissed(null)} onMouseEnter={() => setDismissed(null)} onKeyDown={event => { if (event.key === "Escape") setDismissed(id); }} onClick={() => setDismissed(id)}>
      <span className="rail-tick" aria-hidden="true" /><span className="rail-tick" aria-hidden="true" /><span className="rail-tick" aria-hidden="true" />
      <span className="rail-preview" id={`preview-${id}`} role="tooltip"><strong>{title}</strong><span>{summary}</span></span>
    </a>)}
  </nav>
  </>;
}
