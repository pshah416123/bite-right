import * as cheerio from "cheerio";
import { detectTags } from "../utils/tags.js";
import type { ParseResult, ParsedSection, ParsedItem } from "./types.js";

/**
 * JSON-LD parser — extracts menus from <script type="application/ld+json">.
 *
 * Supports:
 *   - @type: Restaurant → hasMenu / hasOfferCatalog
 *   - @type: Menu → hasMenuSection → hasMenuItem
 *   - @type: ItemList / OfferCatalog (SinglePlatform, BentoBox)
 *   - @graph arrays containing any of the above
 */
export function parseJsonLd(html: string, _url: string): ParseResult | null {
  const $ = cheerio.load(html);
  const sections: ParsedSection[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const objects = normalizeToArray(parsed);
    for (const obj of objects) {
      extractFromObject(obj, sections);
    }
  });

  if (sections.length === 0) return null;

  const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
  if (totalItems < 2) return null;

  return {
    sections,
    confidence: 0.95, // JSON-LD is the most reliable source
    parserType: "json-ld",
  };
}

// ─── Internals ───────────────────────────────────────────────

type JsonObject = Record<string, unknown>;

function normalizeToArray(data: unknown): JsonObject[] {
  if (Array.isArray(data)) return data.flatMap(normalizeToArray);
  if (data && typeof data === "object") {
    const obj = data as JsonObject;
    // Handle @graph
    if (Array.isArray(obj["@graph"])) {
      return (obj["@graph"] as unknown[]).flatMap(normalizeToArray);
    }
    return [obj];
  }
  return [];
}

function extractFromObject(obj: JsonObject, sections: ParsedSection[]) {
  const type = getType(obj);

  if (type === "Restaurant" || type === "FoodEstablishment") {
    // hasMenu → Menu → hasMenuSection
    const menu = obj.hasMenu ?? obj.menu;
    if (menu) {
      for (const m of toArray(menu)) extractFromObject(m as JsonObject, sections);
    }
    // hasOfferCatalog (SinglePlatform style)
    const catalog = obj.hasOfferCatalog;
    if (catalog) {
      for (const c of toArray(catalog)) extractOfferCatalog(c as JsonObject, sections);
    }
  }

  if (type === "Menu") {
    const menuSections = obj.hasMenuSection;
    if (menuSections) {
      for (const ms of toArray(menuSections)) {
        extractMenuSection(ms as JsonObject, sections);
      }
    }
  }

  if (type === "OfferCatalog" || type === "ItemList") {
    extractOfferCatalog(obj, sections);
  }
}

function extractMenuSection(obj: JsonObject, sections: ParsedSection[]) {
  const name = str(obj.name) || "Menu";
  const items: ParsedItem[] = [];

  const menuItems = obj.hasMenuItem ?? obj.itemListElement;
  if (menuItems) {
    for (const mi of toArray(menuItems)) {
      const item = parseMenuItem(mi as JsonObject);
      if (item) items.push(item);
    }
  }

  if (items.length > 0) {
    sections.push({ name, items });
  }
}

function extractOfferCatalog(obj: JsonObject, sections: ParsedSection[]) {
  const name = str(obj.name) || "Menu";
  const items: ParsedItem[] = [];

  const elements = obj.itemListElement ?? obj.offers ?? obj.hasMenuItem;
  if (!elements) return;

  for (const el of toArray(elements)) {
    const elObj = el as JsonObject;
    const elType = getType(elObj);

    // Nested catalogs (sub-sections)
    if (
      elType === "OfferCatalog" ||
      elType === "ItemList" ||
      elObj.itemListElement
    ) {
      extractOfferCatalog(elObj, sections);
      continue;
    }

    const item = parseMenuItem(elObj);
    if (item) items.push(item);
  }

  if (items.length > 0) {
    sections.push({ name, items });
  }
}

function parseMenuItem(obj: JsonObject): ParsedItem | null {
  // The actual item may be nested under `item`
  const inner = (obj.item as JsonObject) ?? obj;
  const name = str(inner.name);
  if (!name || name.length < 2) return null;

  const description = str(inner.description) || null;

  // Price extraction — try offers.price, then price, then priceRange
  let price: number | null = null;
  let currency = "USD";

  const offers = inner.offers;
  if (offers) {
    const offerObj = (Array.isArray(offers) ? offers[0] : offers) as JsonObject;
    const rawPrice = offerObj?.price ?? offerObj?.lowPrice;
    if (rawPrice !== undefined) price = parseFloat(String(rawPrice)) || null;
    if (offerObj?.priceCurrency) currency = String(offerObj.priceCurrency);
  }

  if (price === null && inner.price !== undefined) {
    price = parseFloat(String(inner.price).replace(/[^0-9.]/g, "")) || null;
  }

  const text = `${name} ${description ?? ""}`;
  return {
    name: name.slice(0, 120),
    description: description?.slice(0, 500) ?? null,
    price,
    currency,
    tags: detectTags(text),
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function getType(obj: JsonObject): string {
  const t = obj["@type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return (t[0] as string) ?? "";
  return "";
}

function str(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val && typeof val === "object" && "text" in val) {
    return String((val as { text: string }).text).trim();
  }
  return "";
}

function toArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : val != null ? [val] : [];
}
