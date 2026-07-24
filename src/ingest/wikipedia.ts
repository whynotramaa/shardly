import type { Document } from "../types.js";



const API =
  "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2" +
  "&generator=random&grnnamespace=0&grnlimit=20" +
  "&prop=extracts&exintro=1&explaintext=1&exlimit=20";

const UA = "ShardlyDemo/1.0 (educational document-store project)";

interface WikiPage {
  pageid: number;
  title: string;
  extract?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(attempt = 0): Promise<WikiPage[]> {
  const res = await fetch(API, { headers: { "user-agent": UA } });
  if (res.status === 429 || res.status === 503) {
    // Rate limited / overloaded ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â honour Retry-After, else exponential backoff.
    if (attempt >= 6) throw new Error(`Wikipedia API ${res.status}`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(500 * 2 ** attempt, 15000) + Math.random() * 400;
    await sleep(wait);
    return fetchBatch(attempt + 1);
  }
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: WikiPage[] } };
  return data.query?.pages ?? [];
}

function toDocument(p: WikiPage): Document {
  return {
    source: "wikipedia",
    type: "article",
    title: p.title,
    content: p.extract ?? "",
    url: `https://en.wikipedia.org/?curid=${p.pageid}`,
    pageid: p.pageid,
  };
}

export interface WikipediaOptions {
  count: number;
  concurrency?: number;
  onDocs: (docs: Document[]) => void;
}


export async function fetchWikipediaDocuments(
  opts: WikipediaOptions,
): Promise<number> {
  const { count, onDocs } = opts;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 12, 24));
  const seen = new Set<number>();
  let produced = 0;
  let active = 0;
  let consecutiveErrors = 0;

  return new Promise<number>((resolve, reject) => {
    let settled = false;

    const done = () => {
      if (!settled) {
        settled = true;
        resolve(produced);
      }
    };
    const fail = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    const pump = () => {
      while (!settled && active < concurrency && produced < count) {
        active++;
        fetchBatch()
          .then((pages) => {
            active--;
            consecutiveErrors = 0;
            const fresh: Document[] = [];
            for (const p of pages) {
              if (produced >= count) break;
              if (!p.extract || p.extract.length < 40) continue;
              if (seen.has(p.pageid)) continue;
              seen.add(p.pageid);
              produced++;
              fresh.push(toDocument(p));
            }
            if (fresh.length > 0) onDocs(fresh);
            if (produced >= count && active === 0) return done();
            pump();
          })
          .catch((err) => {
            active--;
            consecutiveErrors++;
            // Bail only if the API is clearly down, not on the odd hiccup.
            if (consecutiveErrors > 25) return fail(err);
            if (produced >= count && active === 0) return done();
            pump();
          });
      }
      if (!settled && active === 0 && produced >= count) done();
    };

    pump();
  });
}







