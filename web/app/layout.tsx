import type { Metadata } from "next";
import { Fraunces, Syne, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./components.css";
import "highlight.js/styles/github-dark.css";

// Set the saved theme before first paint to avoid a flash of the wrong theme.
const THEME_INIT = `try{var t=localStorage.getItem('shardly-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

// Three type roles, per the design system:
//   Fraunces  → display serif, hero + section titles only
//   Syne      → labels, nav, buttons, body
//   Geist Mono→ data: paths, offsets, scores, benchmark numbers, code
const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});
const sans = Syne({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Shardly — A document store that searches itself",
  description:
    "A hand-rolled document store with append-only storage, a WAL for crash recovery, an in-memory inverted index, and BM25 full-text search in milliseconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
