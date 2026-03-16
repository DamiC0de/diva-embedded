import { rateLimiter } from "../security/rate-limiter.js";
import { inputSanitizer } from "../security/input-sanitizer.js";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY ?? "";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

/**
 * Skill: Recherche web sécurisée
 */
export default {
    name: "web-search",
    description: "Recherche web via Brave Search API avec rate limiting et sécurité",
    tools: [
        {
            name: "brave_search",
            description: "Search the web for current information. Use for weather, news, events, prices, facts you're unsure about.",
            schema: {
                type: "object",
                properties: { query: { type: "string", description: "Search query" } },
                required: ["query"]
            }
        }
    ],

    async handler(toolName, input) {
        if (toolName === "brave_search") {
            return this.braveSearch(input);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    },

    async braveSearch(input) {
        try {
            // Validation et sanitization
            inputSanitizer.validateApiInput(input);
            const query = inputSanitizer.sanitizeUserInput(input.query ?? "");
            
            if (!query || query.length < 2) {
                return "Erreur: requête trop courte.";
            }

            if (!BRAVE_API_KEY) {
                return "Erreur: clé API Brave non configurée.";
            }

            // Vérifier le cache
            const cached = cache.get(query);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                console.log("[WebSearch] Cache hit for:", inputSanitizer.sanitizeForLogging(query));
                return this.formatResults(cached.results);
            }

            // Rate limiting
            await rateLimiter.waitIfNeeded("brave_search");

            // Faire la requête
            const url = new URL(BRAVE_SEARCH_URL);
            url.searchParams.set("q", query);
            url.searchParams.set("count", "5");
            url.searchParams.set("search_lang", "fr");

            console.log("[WebSearch] Searching:", inputSanitizer.sanitizeForLogging(query));

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

            const data = await response.json();
            const results = (data.web?.results ?? [])
                .slice(0, 5)
                .map((r) => ({
                    title: inputSanitizer.sanitizeUserInput(r.title ?? ""),
                    url: r.url ?? "",
                    snippet: inputSanitizer.sanitizeUserInput(r.description ?? ""),
                }));

            // Update cache
            cache.set(query, { results, timestamp: Date.now() });

            // Evict old cache entries
            for (const [key, entry] of cache) {
                if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
                    cache.delete(key);
                }
            }

            return this.formatResults(results);
            
        } catch (err) {
            console.error("[WebSearch] Error:", inputSanitizer.sanitizeForLogging(err.message));
            return `Erreur de recherche: ${err.message}`;
        }
    },

    formatResults(results) {
        if (results.length === 0) return "Aucun résultat trouvé.";

        return results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
            .join("\n\n");
    }
};
