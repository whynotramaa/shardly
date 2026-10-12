import type { Metadata } from "next";
import { Fraunces, Syne, Geist_Mono } from "next/font/google";
import "./globals.css";

const THEME_INIT = `try{var t=localStorage.getItem('shardly-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });
const sans = Syne({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Shardly",
  description: "Search your documents and code. A hand-built store with crash-safe storage and BM25 ranking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
