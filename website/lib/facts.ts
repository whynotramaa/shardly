import recorded from "../../benchmarks/retrieval-2026-10-19.json";

export const REPO = "https://github.com/whynotramaa/shardly";
export const source = (file: string) => `${REPO}/blob/main/${file}`;
export const measurements = recorded;
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000/app";
