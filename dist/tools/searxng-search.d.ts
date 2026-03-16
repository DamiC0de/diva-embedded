/**
 * SearXNG Search — self-hosted, free, French-optimized
 * Replaces Brave Search API with local SearXNG instance
 * Falls back to Brave if SearXNG is unavailable
 */
interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    engine?: string;
}
export declare function webSearch(query: string): Promise<SearchResult[]>;
export declare function handleWebSearch(input: Record<string, string>): Promise<string>;
export {};
//# sourceMappingURL=searxng-search.d.ts.map