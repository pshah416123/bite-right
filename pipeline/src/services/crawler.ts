import { chromium, type Browser, type Page } from "playwright";
import axios from "axios";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { db } from "../lib/db.js";
import { isAllowedByRobots } from "../lib/robots.js";
import { childLogger } from "../lib/logger.js";
import type { MenuPageSource } from "@prisma/client";

const log = childLogger("crawler");

// ─── Constants ───────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const COMMON_MENU_PATHS = [
  "/menu",
  "/our-menu",
  "/food-menu",
  "/food",
  "/dinner",
  "/lunch",
  "/dining",
  "/eat",
  "/order",
];

const MENU_LINK_RE =
  /\b(menu|food|dinner|lunch|dining|eat|order)\b/i;

/** Links to skip when scanning for menu links. */
const SKIP_LINK_RE =
  /\b(facebook|instagram|twitter|tiktok|yelp|doordash|grubhub|ubereats|opentable|login|signup|careers|privacy|terms|contact)\b/i;

// ─── Shared browser ──────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
  return _browser;
}

export async function closeBrowser() {
  if (_browser?.isConnected()) await _browser.close();
  _browser = null;
}

// ─── Types ───────────────────────────────────────────────────

export interface CrawlResult {
  url: string;
  html: string;
  source: MenuPageSource;
}

// ─── Fetching ────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: 12_000,
      headers: { "User-Agent": UA, Accept: "text/html" },
      maxRedirects: 5,
      responseType: "text",
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

async function fetchWithPlaywright(url: string): Promise<string | null> {
  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "User-Agent": UA });

    // Block heavy resources to speed up load
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "media", "stylesheet"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
    return await page.content();
  } catch (err) {
    log.warn({ url, err }, "playwright fetch failed");
    return null;
  } finally {
    await page?.close();
  }
}

// ─── Link discovery ──────────────────────────────────────────

interface ScoredLink {
  href: string;
  score: number;
}

function findMenuLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const candidates: ScoredLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;

    let href: string;
    try {
      href = new URL(raw, baseUrl).href;
    } catch {
      return;
    }

    // Same-origin only
    try {
      if (new URL(href).origin !== new URL(baseUrl).origin) return;
    } catch {
      return;
    }

    if (seen.has(href) || SKIP_LINK_RE.test(href)) return;
    seen.add(href);

    const text = $(el).text().toLowerCase().trim();
    const path = new URL(href).pathname.toLowerCase();

    let score = 0;
    if (/\/menu\b/.test(path)) score += 10;
    if (/\/(food|dinner|lunch|dining)\b/.test(path)) score += 7;
    if (/\/eat\b/.test(path)) score += 5;
    if (/\/order\b/.test(path)) score += 3;
    if (MENU_LINK_RE.test(text)) score += 4;

    if (score > 0) {
      candidates.push({ href, score });
    }
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => c.href);
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Crawl a restaurant's website and return the best menu HTML found.
 *
 * Strategy order:
 *   1. Fetch homepage, extract menu links, follow the best one
 *   2. Try common menu paths (/menu, /our-menu, etc.)
 *   3. Fall back to Playwright for JS-rendered pages
 *
 * Each page that yields HTML is returned as a CrawlResult.
 * The caller (parser pipeline) decides which one has actual menu data.
 */
export async function crawlRestaurant(
  restaurantId: string,
): Promise<CrawlResult[]> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
  });

  if (!restaurant?.website) {
    log.warn({ restaurantId }, "no website to crawl");
    return [];
  }

  const websiteUrl = restaurant.website;
  const results: CrawlResult[] = [];
  const visited = new Set<string>();

  async function tryUrl(
    url: string,
    source: MenuPageSource,
    usePlaywright = false,
  ): Promise<string | null> {
    if (visited.has(url)) return null;
    visited.add(url);

    const allowed = await isAllowedByRobots(url);
    if (!allowed) {
      log.info({ url }, "blocked by robots.txt");
      return null;
    }

    const html = usePlaywright
      ? await fetchWithPlaywright(url)
      : await fetchHtml(url);

    if (html && html.length > 200) {
      results.push({ url, html, source });
      await persistMenuPage(restaurantId, url, source, html);
      return html;
    }
    return null;
  }

  // ── Step 1: Homepage + menu link discovery ──
  log.info({ restaurantId, websiteUrl }, "crawl starting");
  const homepageHtml = await tryUrl(websiteUrl, "HOMEPAGE");

  if (homepageHtml) {
    const menuLinks = findMenuLinks(homepageHtml, websiteUrl);
    for (const link of menuLinks) {
      await tryUrl(link, "MENU_LINK");
    }
  }

  // ── Step 2: Common paths ──
  let origin: string;
  try {
    origin = new URL(websiteUrl).origin;
  } catch {
    return results;
  }

  for (const path of COMMON_MENU_PATHS) {
    await tryUrl(`${origin}${path}`, "COMMON_PATH");
  }

  // ── Step 3: Playwright for JS-heavy sites (re-crawl best candidates) ──
  if (results.length === 0 || results.every((r) => r.html.length < 2000)) {
    log.info({ restaurantId }, "trying Playwright render");
    await tryUrl(websiteUrl, "PUPPETEER", true);

    const menuPath = `${origin}/menu`;
    if (!visited.has(menuPath)) {
      await tryUrl(menuPath, "PUPPETEER", true);
    }
  }

  log.info(
    { restaurantId, pagesFound: results.length },
    "crawl finished",
  );
  return results;
}

// ─── DB helpers ──────────────────────────────────────────────

async function persistMenuPage(
  restaurantId: string,
  url: string,
  source: MenuPageSource,
  html: string,
) {
  const htmlHash = createHash("sha256").update(html).digest("hex").slice(0, 16);

  await db.menuPage.upsert({
    where: {
      restaurantId_url: { restaurantId, url },
    },
    update: {
      htmlHash,
      lastCrawledAt: new Date(),
      sourceType: source,
    },
    create: {
      restaurantId,
      url,
      sourceType: source,
      htmlHash,
      lastCrawledAt: new Date(),
    },
  });
}
