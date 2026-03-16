/**
 * Scrape text content from a web page using Puppeteer.
 * @param url - URL to scrape
 * @returns Extracted text content (max 5000 chars)
 */
export declare function scrapeUrl(url: string): Promise<string>;
/**
 * Tool handler for web_scrape — scrape URL for LLM consumption.
 */
export declare function handleWebScrape(input: Record<string, string>): Promise<string>;
//# sourceMappingURL=web-scrape.d.ts.map