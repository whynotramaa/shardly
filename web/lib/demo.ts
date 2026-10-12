import { API_BASE, json, type SearchResponse } from "./api";

function assertDemoScope(result: SearchResponse): SearchResponse {
  if (result.hits.some((hit) => hit.doc.source !== "demo"))
    throw new Error("Demo response included a document outside its scope. Stop and check the API.");
  return result;
}
export async function searchDemo(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, source: "demo", limit: "10", inspect: "true" });
  return assertDemoScope(await json<SearchResponse>(await fetch(`${API_BASE}/demo/search?${params}`)));
}
export async function compareDemo(query: string): Promise<{ baseline: SearchResponse; tuned: SearchResponse }> {
  const result = await json<{ baseline: SearchResponse; tuned: SearchResponse }>(await fetch(`${API_BASE}/demo/search/compare`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, options: { source: "demo", limit: 10 } }),
  }));
  assertDemoScope(result.baseline);
  assertDemoScope(result.tuned);
  return result;
}
