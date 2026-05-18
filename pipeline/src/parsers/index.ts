import { parseJsonLd } from "./json-ld.js";
import { parseProviders, parseProvidersAsync } from "./providers.js";
import { parseGenericHtml } from "./generic-html.js";
import { childLogger } from "../lib/logger.js";
import type { ParseResult } from "./types.js";
import { EMPTY_RESULT } from "./types.js";
import type { CrawlResult } from "../services/crawler.js";

export type { ParseResult, ParsedSection, ParsedItem, ItemTags } from "./types.js";

const log = childLogger("parser");

/**
 * Run all crawled pages through the parser pipeline and return the best result.
 *
 * Pipeline order (per page):
 *   1. JSON-LD (confidence ~0.95)
 *   2. Provider adapters — sync (confidence ~0.80-0.90)
 *   3. Provider adapters — async / SinglePlatform (confidence ~0.90)
 *   4. Generic HTML (confidence ~0.40-0.60)
 *
 * Across all pages, the result with the highest confidence wins.
 * If confidence is tied, prefer the result with more items.
 */
export async function parseCrawlResults(
  pages: CrawlResult[],
): Promise<ParseResult> {
  let best: ParseResult = EMPTY_RESULT;

  for (const page of pages) {
    const result = await parseSinglePage(page.html, page.url);
    if (isBetter(result, best)) {
      best = result;
    }
  }

  if (best.sections.length > 0) {
    const items = best.sections.reduce((n, s) => n + s.items.length, 0);
    log.info(
      {
        parserType: best.parserType,
        confidence: best.confidence,
        sections: best.sections.length,
        items,
      },
      "best parse result selected",
    );
  }

  return best;
}

/**
 * Parse a single HTML page through the full pipeline.
 */
export async function parseSinglePage(
  html: string,
  url: string,
): Promise<ParseResult> {
  // 1. JSON-LD
  const jsonLd = parseJsonLd(html, url);
  if (jsonLd) {
    log.debug({ url, parser: "json-ld", items: countItems(jsonLd) }, "parsed");
    return jsonLd;
  }

  // 2. Sync provider adapters
  const provider = parseProviders(html, url);
  if (provider) {
    log.debug({
      url,
      parser: provider.parserType,
      items: countItems(provider),
    }, "parsed");
    return provider;
  }

  // 3. Async provider adapters (network calls)
  const asyncProvider = await parseProvidersAsync(html, url);
  if (asyncProvider) {
    log.debug({
      url,
      parser: asyncProvider.parserType,
      items: countItems(asyncProvider),
    }, "parsed");
    return asyncProvider;
  }

  // 4. Generic HTML
  const generic = parseGenericHtml(html, url);
  if (generic) {
    log.debug({
      url,
      parser: "generic-html",
      items: countItems(generic),
    }, "parsed");
    return generic;
  }

  return EMPTY_RESULT;
}

// ─── Helpers ─────────────────────────────────────────────────

function countItems(result: ParseResult): number {
  return result.sections.reduce((n, s) => n + s.items.length, 0);
}

function isBetter(candidate: ParseResult, current: ParseResult): boolean {
  if (candidate.sections.length === 0) return false;
  if (current.sections.length === 0) return true;
  if (candidate.confidence > current.confidence) return true;
  if (candidate.confidence === current.confidence) {
    return countItems(candidate) > countItems(current);
  }
  return false;
}
