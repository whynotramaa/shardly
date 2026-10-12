"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.dataset.theme !== "light"), []);
  function toggle() {
    const next = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("shardly-theme", next); } catch {}
  }
  return (
    <button type="button" className="icon-button theme-toggle" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Icon name={dark ? "moon" : "sun"} />
    </button>
  );
}
