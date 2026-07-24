import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shardly — Document Store + Full-Text Search",
  description:
    "A hand-rolled document store with BM25 full-text search and a live index-vs-scan benchmark.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
