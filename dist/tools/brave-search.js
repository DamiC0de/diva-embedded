const BRAVE_API_KEY = process.env.BRAVE_API_KEY ?? "";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();
/**
 * Search the web via Brave Search API.
 * Returns top 5 results with caching.
 * @param query - Search query
 * @returns Formatted search results
 */
export async function braveSearch(query) {
    if (!BRAVE_API_KEY) {
        throw new Error("BRAVE_API_KEY not set");
    }
    // Check cache
    const cached = cache.get(query);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.results;
    }
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", "5");
    url.searchParams.set("search_lang", "fr");
    const response = await fetch(url.toString(), {
        headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": BRAVE_API_KEY,
        },
    });
    if (!response.ok) {
        throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json());
    const results = (data.web?.results ?? [])
        .slice(0, 5)
        .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
    }));
    // Update cache
    cache.set(query, { results, timestamp: Date.now() });
    // Evict old cache entries
    for (const [key, entry] of cache) {
        if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
            cache.delete(key);
        }
    }
    return results;
}
/**
 * Tool handler for brave_search — formats results for LLM consumption.
 */
export async function handleBraveSearch(input) {
    const query = input.query ?? "";
    if (!query)
        return "Erreur: requête vide.";
    try {
        const results = await braveSearch(query);
        if (results.length === 0)
            return "Aucun résultat trouvé.";
        return results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
            .join("\n\n");
    }
    catch (err) {
        return `Erreur de recherche: ${err instanceof Error ? err.message : String(err)}`;
    }
}
//# sourceMappingURL=brave-search.js.map