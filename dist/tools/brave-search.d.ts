interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}
/**
 * Search the web via Brave Search API.
 * Returns top 5 results with caching.
 * @param query - Search query
 * @returns Formatted search results
 */
export declare function braveSearch(query: string): Promise<SearchResult[]>;
/**
 * Tool handler for brave_search — formats results for LLM consumption.
 */
export declare function handleBraveSearch(input: Record<string, string>): Promise<string>;
export {};
//# sourceMappingURL=brave-search.d.ts.map