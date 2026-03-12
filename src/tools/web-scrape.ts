import puppeteer from "puppeteer";

const MAX_CONTENT_LENGTH = 5000;
const TIMEOUT_MS = 10000;

/**
 * Scrape text content from a web page using Puppeteer.
 * @param url - URL to scrape
 * @returns Extracted text content (max 5000 chars)
 */
export async function scrapeUrl(url: string): Promise<string> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT_MS,
    });

    // Extract main text content
    const content = await page.evaluate(() => {
      // Remove scripts, styles, nav, footer
      const removeSelectors = ["script", "style", "nav", "footer", "header", "aside", "iframe"];
      for (const sel of removeSelectors) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }

      // Try to get article or main content
      const article = document.querySelector("article") ?? document.querySelector("main") ?? document.body;
      return article?.textContent ?? "";
    });

    // Clean up whitespace and truncate
    const cleaned = content
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONTENT_LENGTH);

    return cleaned || "Aucun contenu textuel trouvé.";
  } catch (err) {
    throw new Error(
      `Scraping failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    await browser.close();
  }
}

/**
 * Tool handler for web_scrape — scrape URL for LLM consumption.
 */
export async function handleWebScrape(
  input: Record<string, string>
): Promise<string> {
  const url = input.url ?? "";
  if (!url) return "Erreur: URL vide.";

  try {
    return await scrapeUrl(url);
  } catch (err) {
    return `Erreur de scraping: ${err instanceof Error ? err.message : String(err)}`;
  }
}
