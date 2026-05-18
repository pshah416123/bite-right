import axios from "axios";
import * as cheerio from "cheerio";
import { detectTags } from "../utils/tags.js";
import { parseJsonLd } from "./json-ld.js";
import type { ParseResult, ParsedSection, ParsedItem } from "./types.js";
import { PRICE_RE } from "./types.js";
import { childLogger } from "../lib/logger.js";

const log = childLogger("providers");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Provider-specific adapters for known menu hosting platforms.
 *
 * Detects the platform from the page HTML, then extracts structured menu data
 * using platform-specific patterns (API endpoints, DOM conventions, etc.).
 */
export function parseProviders(
  html: string,
  url: string,
): ParseResult | null {
  // Try each adapter in order — first match wins
  for (const adapter of ADAPTERS) {
    if (adapter.detect(html, url)) {
      log.info({ provider: adapter.name, url }, "provider detected");
      const result = adapter.parse(html, url);
      if (result && result.sections.length > 0) return result;
    }
  }
  return null;
}

/**
 * Async variant — some providers need to fetch external pages
 * (e.g. SinglePlatform hosted menus).
 */
export async function parseProvidersAsync(
  html: string,
  url: string,
): Promise<ParseResult | null> {
  for (const adapter of ASYNC_ADAPTERS) {
    if (adapter.detect(html, url)) {
      log.info({ provider: adapter.name, url }, "async provider detected");
      const result = await adapter.parse(html, url);
      if (result && result.sections.length > 0) return result;
    }
  }
  return null;
}

// ─── Adapter interface ───────────────────────────────────────

interface SyncAdapter {
  name: string;
  detect: (html: string, url: string) => boolean;
  parse: (html: string, url: string) => ParseResult | null;
}

interface AsyncAdapter {
  name: string;
  detect: (html: string, url: string) => boolean;
  parse: (html: string, url: string) => Promise<ParseResult | null>;
}

// ─── ToastTab ────────────────────────────────────────────────

const toastTab: SyncAdapter = {
  name: "toasttab",

  detect: (html, url) =>
    url.includes("toasttab.com") ||
    html.includes("toasttab.com") ||
    html.includes("data-testid=\"menu-item\""),

  parse: (html) => {
    const $ = cheerio.load(html);
    const sections: ParsedSection[] = [];
    let current: ParsedSection = { name: "Menu", items: [] };

    // ToastTab uses data-testid attributes
    $('[data-testid="menu-group-header"]').each((_, el) => {
      if (current.items.length > 0) sections.push(current);
      current = { name: $(el).text().trim() || "Menu", items: [] };
    });

    $('[data-testid="menu-item"]').each((_, el) => {
      const $el = $(el);
      const name = $el.find('[data-testid="menu-item-name"]').text().trim()
        || $el.find("h3, h4, strong").first().text().trim();
      const desc = $el.find('[data-testid="menu-item-description"]').text().trim()
        || $el.find("p").first().text().trim();
      const priceText = $el.find('[data-testid="menu-item-price"]').text().trim()
        || $el.text().match(PRICE_RE)?.[0];

      if (!name) return;
      const price = priceText
        ? parseFloat(priceText.replace(/[^0-9.]/g, "")) || null
        : null;

      current.items.push({
        name: name.slice(0, 120),
        description: desc?.slice(0, 500) || null,
        price,
        currency: "USD",
        tags: detectTags(`${name} ${desc}`),
      });
    });

    if (current.items.length > 0) sections.push(current);
    if (sections.length === 0) return null;

    return { sections, confidence: 0.85, parserType: "toasttab" };
  },
};

// ─── BentoBox ────────────────────────────────────────────────

const bentoBox: SyncAdapter = {
  name: "bentobox",

  detect: (html, url) =>
    url.includes("getbento.com") ||
    html.includes("bentobox") ||
    html.includes("bb-menu"),

  parse: (html) => {
    const $ = cheerio.load(html);
    const sections: ParsedSection[] = [];
    let current: ParsedSection = { name: "Menu", items: [] };

    $(".bb-menu-category, .menu-category, [class*='menu-section']").each(
      (_, el) => {
        const $section = $(el);
        const title =
          $section.find("h2, h3, .category-name").first().text().trim();
        if (current.items.length > 0) sections.push(current);
        current = { name: title || "Menu", items: [] };

        $section
          .find(".bb-menu-item, .menu-item, [class*='menu-item']")
          .each((_, itemEl) => {
            const $item = $(itemEl);
            const name = $item.find(".item-name, h4, h5, strong").first().text().trim();
            const desc = $item.find(".item-description, .item-desc, p").first().text().trim();
            const priceText = $item.find(".item-price, .price").first().text().trim();
            if (!name) return;

            current.items.push({
              name: name.slice(0, 120),
              description: desc?.slice(0, 500) || null,
              price: priceText
                ? parseFloat(priceText.replace(/[^0-9.]/g, "")) || null
                : null,
              currency: "USD",
              tags: detectTags(`${name} ${desc}`),
            });
          });
      },
    );

    if (current.items.length > 0) sections.push(current);
    if (sections.length === 0) return null;

    return { sections, confidence: 0.85, parserType: "bentobox" };
  },
};

// ─── Square / Weebly ─────────────────────────────────────────

const squareWeebly: SyncAdapter = {
  name: "square",

  detect: (html, url) =>
    url.includes("square.site") ||
    url.includes("squareup.com") ||
    html.includes("squareup.com") ||
    html.includes("weebly.com"),

  parse: (html) => {
    const $ = cheerio.load(html);
    const sections: ParsedSection[] = [];
    let current: ParsedSection = { name: "Menu", items: [] };

    $(".menu-section, .wsite-menu-category").each((_, el) => {
      const $s = $(el);
      const title = $s.find("h2, h3, .menu-section-title").first().text().trim();
      if (current.items.length > 0) sections.push(current);
      current = { name: title || "Menu", items: [] };

      $s.find(".menu-item, .wsite-menu-item").each((_, itemEl) => {
        const $item = $(itemEl);
        const name = $item.find(".menu-item-title, h4").first().text().trim();
        const desc = $item
          .find(".menu-item-description, .menu-item-desc")
          .first()
          .text()
          .trim();
        const priceText = $item.find(".menu-item-price").first().text().trim();
        if (!name) return;

        current.items.push({
          name: name.slice(0, 120),
          description: desc?.slice(0, 500) || null,
          price: priceText
            ? parseFloat(priceText.replace(/[^0-9.]/g, "")) || null
            : null,
          currency: "USD",
          tags: detectTags(`${name} ${desc}`),
        });
      });
    });

    if (current.items.length > 0) sections.push(current);
    if (sections.length === 0) return null;

    return { sections, confidence: 0.80, parserType: "square" };
  },
};

// ─── SinglePlatform (async — fetches hosted page) ────────────

const singlePlatform: AsyncAdapter = {
  name: "singleplatform",

  detect: (html) =>
    html.includes("singleplatform") ||
    html.includes("data-location"),

  parse: async (html) => {
    const $ = cheerio.load(html);

    // Extract the location slug from `data-location` attribute or
    // script src containing singleplatform.
    let slug: string | null = null;

    $("[data-location]").each((_, el) => {
      slug = $(el).attr("data-location") ?? null;
    });

    if (!slug) {
      const scriptSrc = $('script[src*="singleplatform"]').attr("src") ?? "";
      const match = scriptSrc.match(/locations\/([^/]+)/);
      if (match) slug = match[1];
    }

    if (!slug) return null;

    // Fetch the hosted menu page
    const menuUrl = `https://places.singleplatform.com/${slug}/menu`;
    log.info({ slug, menuUrl }, "fetching SinglePlatform menu");

    try {
      const { data: menuHtml } = await axios.get<string>(menuUrl, {
        timeout: 10_000,
        headers: { "User-Agent": UA, Accept: "text/html" },
        responseType: "text",
      });

      if (typeof menuHtml !== "string") return null;

      // SinglePlatform pages embed JSON-LD — reuse our JSON-LD parser
      const jsonLdResult = parseJsonLd(menuHtml, menuUrl);
      if (jsonLdResult && jsonLdResult.sections.length > 0) {
        return {
          ...jsonLdResult,
          parserType: "singleplatform",
          confidence: 0.90,
        };
      }
    } catch (err) {
      log.warn({ slug, err }, "SinglePlatform fetch failed");
    }

    return null;
  },
};

// ─── Clover ──────────────────────────────────────────────────

const clover: SyncAdapter = {
  name: "clover",

  detect: (html, url) =>
    url.includes("clover.com") || html.includes("clover.com/online-ordering"),

  parse: (html) => {
    const $ = cheerio.load(html);
    const sections: ParsedSection[] = [];
    let current: ParsedSection = { name: "Menu", items: [] };

    $(".category, [class*='category']").each((_, el) => {
      const $s = $(el);
      const title = $s.find("h2, h3, .category-name").first().text().trim();
      if (current.items.length > 0) sections.push(current);
      current = { name: title || "Menu", items: [] };

      $s.find(".item, [class*='item-card']").each((_, itemEl) => {
        const $item = $(itemEl);
        const name = $item.find(".item-name, h4").first().text().trim();
        const desc = $item.find(".item-description").first().text().trim();
        const priceText = $item.find(".item-price, .price").first().text().trim();
        if (!name) return;

        current.items.push({
          name: name.slice(0, 120),
          description: desc?.slice(0, 500) || null,
          price: priceText
            ? parseFloat(priceText.replace(/[^0-9.]/g, "")) || null
            : null,
          currency: "USD",
          tags: detectTags(`${name} ${desc}`),
        });
      });
    });

    if (current.items.length > 0) sections.push(current);
    if (sections.length === 0) return null;

    return { sections, confidence: 0.80, parserType: "clover" };
  },
};

// ─── Registry ────────────────────────────────────────────────

const ADAPTERS: SyncAdapter[] = [toastTab, bentoBox, squareWeebly, clover];
const ASYNC_ADAPTERS: AsyncAdapter[] = [singlePlatform];
