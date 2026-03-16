/**
 * SearXNG Search — self-hosted, free, French-optimized
 * Replaces Brave Search API with local SearXNG instance
 * Falls back to Brave if SearXNG is unavailable
 */

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8888";
const BRAVE_API_KEY = process.env.BRAVE_API_KEY ?? "";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

async function searchSearXNG(query: string): Promise<SearchResult[]> {
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "fr");

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      engine?: string;
    }>;
  };

  return (data.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
    engine: r.engine ?? "",
  }));
}

async function searchBraveFallback(query: string): Promise<SearchResult[]> {
  if (!BRAVE_API_KEY) throw new Error("No fallback: BRAVE_API_KEY not set");

  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("search_lang", "fr");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": BRAVE_API_KEY,
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) throw new Error(`Brave error: ${response.status}`);

  const data = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
    engine: "brave-api",
  }));
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  const cached = cache.get(query);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }

  let results: SearchResult[];
  try {
    results = await searchSearXNG(query);
    if (results.length === 0) throw new Error("No results from SearXNG");
    console.log(`[Search] SearXNG: ${results.length} results for "${query.slice(0, 40)}"`);
  } catch (err) {
    console.warn(`[Search] SearXNG failed (${err}), trying Brave fallback...`);
    try {
      results = await searchBraveFallback(query);
      console.log(`[Search] Brave fallback: ${results.length} results`);
    } catch (err2) {
      throw new Error(`All search engines failed: SearXNG(${err}), Brave(${err2})`);
    }
  }

  cache.set(query, { results, timestamp: Date.now() });
  for (const [key, entry] of cache) {
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) cache.delete(key);
  }

  return results;
}

export async function handleWebSearch(input: Record<string, string>): Promise<string> {
  const query = input.query ?? "";
  if (!query) return "Erreur: requete vide.";

  try {
    const results = await webSearch(query);
    if (results.length === 0) return "Aucun resultat trouve.";
    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");
  } catch (err) {
    return `Erreur de recherche: ${err instanceof Error ? err.message : String(err)}`;
  }
}
