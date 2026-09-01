import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shardly, a search engine explained from the bytes up",
  description:
    "A field manual for Shardly: append-only segments, a write-ahead log, an inverted index, and BM25 ranking, written from scratch in TypeScript and explained with working diagrams.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500;6..72,600&family=Geist+Mono:wght@400;500;600&display=swap"
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

        <div className="underlay" aria-hidden />
        <div className="underlay-cols" aria-hidden>
          {Array.from({ length: 13 }, (_, i) => (
            <i key={i} style={{ left: `calc(${(i / 12) * 100}% )` }} />
          ))}
        </div>
        {children}
      </body>
    </html>
  );
}
