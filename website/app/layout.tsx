import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "How Shardly stores, searches, and verifies documents",
  description:
    "Follow a document through extraction, durable storage, lexical and hybrid retrieval, and revision-checked evidence. A source-backed engineering guide with interactive diagrams.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/Coconat-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap"
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('shardly-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        {/* One arrowhead sprite for every diagram on the page. */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
          <defs>
            <marker
              id="ah"
              viewBox="0 0 9 8"
              refX="8.5"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0 0.6 L8.5 4 L0 7.4 Z" fill="context-stroke" />
            </marker>
            <marker
              id="ah-ac"
              viewBox="0 0 9 8"
              refX="8.5"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0 0.6 L8.5 4 L0 7.4 Z" fill="context-stroke" />
            </marker>
            <marker
              id="ah-fg"
              viewBox="0 0 9 8"
              refX="8.5"
              refY="4"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0 0.6 L8.5 4 L0 7.4 Z" fill="context-stroke" />
            </marker>
            <pattern
              id="hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="#8a8a8a" strokeWidth="1" />
            </pattern>
            <pattern
              id="hatch-ac"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="5" stroke="var(--accent)" strokeWidth="1.4" />
            </pattern>
          </defs>
        </svg>

        {children}
      </body>
    </html>
  );
}
