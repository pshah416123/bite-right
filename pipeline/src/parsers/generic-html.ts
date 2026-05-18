import * as cheerio from "cheerio";
import { detectTags } from "../utils/tags.js";
import type { ParseResult, ParsedSection, ParsedItem } from "./types.js";
import { PRICE_RE, SKIP_SECTION_RE, DRINK_SECTION_RE } from "./types.js";

/**
 * Generic HTML parser — last resort when JSON-LD and provider adapters fail.
 *
 * Applies multiple strategies in order:
 *   1. Price-bearing container detection (repeated siblings with $ amounts)
 *   2. Heading-walk: H2/H3 = sections, items below with prices
 *   3. Table extraction
 *   4. No-price heading hierarchy (H2 = section, H4 = items, for chains)
 *   5. Leaf-node price fallback
 */
export function parseGenericHtml(
  html: string,
  _url: string,
): ParseResult | null {
  const $ = cheerio.load(html);

  // Clean non-content elements
  $("style, script, nav, footer, header, iframe, noscript, svg, form").remove();
  $(
    '[class*="site-footer"], [class*="site-header"], [class*="cookie-"], [class*="popup"], [class*="modal"], [id*="cookie"]',
  ).remove();

  let best = strategy1PriceContainers($);
  if (totalItems(best) < 3) best = strategy2HeadingWalk($, best);
  if (totalItems(best) < 3) best = strategy3Tables($, best);
  if (totalItems(best) < 3) best = strategy4NoPriceHeadings($, best);
  if (totalItems(best) < 3) best = strategy5LeafNodes($, best);

  // Deduplicate items within each section
  for (const section of best) {
    const seen = new Set<string>();
    section.items = section.items.filter((item) => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const final = best.filter((s) => s.items.length > 0);
  if (final.length === 0) return null;

  const items = totalItems(final);
  if (items < 2) return null;

  // Cap: keep food sections, limit drinks
  const capped = capSections(final);

  return {
    sections: capped,
    confidence: items >= 10 ? 0.6 : 0.4,
    parserType: "generic-html",
  };
}

// ─── Strategy 1: Price-bearing containers ────────────────────

function strategy1PriceContainers(
  $: cheerio.CheerioAPI,
): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const current: ParsedSection = { name: "Menu", items: [] };

  // Find leaf elements containing prices (scoped to common content tags)
  const priceEls: cheerio.Cheerio<any>[] = [];
  $("p, li, div, span, td, dd, dt, a, h1, h2, h3, h4, h5, h6, strong, b, em").each((_, el) => {
    const $el = $(el);
    const ownText = $el.clone().children().remove().end().text().trim();
    if (PRICE_RE.test(ownText) && ownText.length < 200) {
      priceEls.push($el);
    }
  });

  if (priceEls.length < 2) return sections;

  // Group by parent to find repeated structures
  const parentMap = new Map<
    any,
    cheerio.Cheerio<any>[]
  >();

  for (const $price of priceEls) {
    let $container = $price;
    for (let i = 0; i < 4; i++) {
      const $parent = $container.parent();
      if (!$parent.length || $parent.is("body, html, main, article, section"))
        break;
      const sibCount = $parent
        .parent()
        .children()
        .filter((_, sib) => $(sib).prop("tagName") === $parent.prop("tagName"))
        .length;
      if (sibCount >= 2) {
        $container = $parent;
        break;
      }
      $container = $parent;
    }
    const parentNode = $container.parent().get(0);
    if (!parentNode) continue;
    if (!parentMap.has(parentNode)) parentMap.set(parentNode, []);
    parentMap.get(parentNode)!.push($container);
  }

  // Take the largest group
  let bestGroup: cheerio.Cheerio<any>[] = [];
  for (const [, containers] of parentMap) {
    if (containers.length > bestGroup.length) bestGroup = containers;
  }

  if (bestGroup.length < 2) return sections;

  for (const $item of bestGroup) {
    const text = $item.text().replace(/\s+/g, " ").trim();
    const pm = text.match(PRICE_RE);
    if (!pm) continue;

    const parsed = extractItem($, $item, text, pm);
    if (parsed) current.items.push(parsed);
  }

  if (current.items.length > 0) sections.push(current);
  return sections;
}

// ─── Strategy 2: Heading walk ────────────────────────────────

function strategy2HeadingWalk(
  $: cheerio.CheerioAPI,
  prev: ParsedSection[],
): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { name: "Menu", items: [] };

  $("h1, h2, h3, h4").each((_, heading) => {
    const $h = $(heading);
    const text = $h.text().replace(/\s+/g, " ").trim();
    if (!text || text.length > 60 || text.length < 2) return;
    if (SKIP_SECTION_RE.test(text) || PRICE_RE.test(text)) return;

    if (current.items.length > 0) sections.push(current);
    current = { name: text, items: [] };

    let $next = $h.next();
    let safety = 0;
    while ($next.length && safety++ < 100) {
      if (/^h[1-4]$/i.test($next.prop("tagName") ?? "")) break;

      const blockText = $next.text().replace(/\s+/g, " ").trim();
      if (PRICE_RE.test(blockText)) {
        const $children = $next.find(
          "li, tr, [class*='item'], [class*='dish'], p, div",
        );
        if ($children.length >= 2) {
          $children.each((_, child) => {
            const ct = $(child).text().replace(/\s+/g, " ").trim();
            const pm = ct.match(PRICE_RE);
            if (pm && ct.length < 300) {
              const item = extractItemFromText(ct, pm);
              if (item) current.items.push(item);
            }
          });
        } else {
          const pm = blockText.match(PRICE_RE);
          if (pm && blockText.length < 300) {
            const item = extractItemFromText(blockText, pm);
            if (item) current.items.push(item);
          }
        }
      }
      $next = $next.next();
    }
  });

  if (current.items.length > 0) sections.push(current);
  return betterOf(prev, sections);
}

// ─── Strategy 3: Tables ──────────────────────────────────────

function strategy3Tables(
  $: cheerio.CheerioAPI,
  prev: ParsedSection[],
): ParsedSection[] {
  const sections: ParsedSection[] = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const section: ParsedSection = { name: "Menu", items: [] };

    const $prev = $table.prev("h1, h2, h3, h4");
    if ($prev.length) {
      const t = $prev.text().replace(/\s+/g, " ").trim();
      if (t.length > 1 && t.length < 60 && !SKIP_SECTION_RE.test(t)) {
        section.name = t;
      }
    }

    $table.find("tr").each((_, row) => {
      const rowText = $(row).text().replace(/\s+/g, " ").trim();
      const pm = rowText.match(PRICE_RE);
      if (!pm || rowText.length > 300) return;

      const cells = $(row).find("td, th");
      if (cells.length >= 2) {
        const name = $(cells.get(0)!).text().replace(/\s+/g, " ").trim();
        const priceCell = cells
          .toArray()
          .find((c) => PRICE_RE.test($(c).text()));
        const price = priceCell ? $(priceCell).text().match(PRICE_RE) : pm;

        if (name && name.length > 1 && name.length < 120 && price) {
          section.items.push({
            name: name.slice(0, 80),
            description: null,
            price: parseFloat(price[1]) || null,
            currency: "USD",
            tags: detectTags(name),
          });
        }
      }
    });

    if (section.items.length >= 2) sections.push(section);
  });

  return betterOf(prev, sections);
}

// ─── Strategy 4: No-price heading hierarchy ──────────────────

function strategy4NoPriceHeadings(
  $: cheerio.CheerioAPI,
  prev: ParsedSection[],
): ParsedSection[] {
  const allHeadings: { level: number; text: string }[] = [];

  $("h1, h2, h3, h4, h5, h6").each((_, h) => {
    const level = parseInt(($(h).prop("tagName") ?? "H6").charAt(1), 10);
    const text = $(h).text().replace(/\s+/g, " ").trim();
    if (text.length >= 2 && text.length <= 100) {
      allHeadings.push({ level, text });
    }
  });

  if (allHeadings.length < 4) return prev;

  // Count headings per level
  const levelCounts: Record<number, number> = {};
  for (const h of allHeadings) {
    levelCounts[h.level] = (levelCounts[h.level] ?? 0) + 1;
  }

  const sorted = Object.entries(levelCounts)
    .map(([l, c]) => ({ level: Number(l), count: c }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => a.level - b.level);

  if (sorted.length < 2) return prev;

  // Section level = fewer entries, item level = more entries
  let sectionLevel: number | null = null;
  let itemLevel: number | null = null;

  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].count > sorted[i].count) {
        sectionLevel = sorted[i].level;
        itemLevel = sorted[j].level;
        break;
      }
    }
    if (sectionLevel !== null) break;
  }

  if (sectionLevel === null || itemLevel === null) return prev;

  const skipRe =
    /^(menu|order|reservation|gift|about|contact|location|sign|log|join|app|download|follow|our company|our food|support)/i;
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const h of allHeadings) {
    if (SKIP_SECTION_RE.test(h.text) || skipRe.test(h.text)) continue;

    if (h.level === sectionLevel) {
      if (current && current.items.length >= 2) sections.push(current);
      current = { name: h.text, items: [] };
    } else if (h.level === itemLevel && current) {
      current.items.push({
        name: h.text.slice(0, 80),
        description: null,
        price: null,
        currency: "USD",
        tags: detectTags(h.text),
      });
    }
  }

  if (current && current.items.length >= 2) sections.push(current);
  if (totalItems(sections) < 4) return prev;

  return betterOf(prev, sections);
}

// ─── Strategy 5: Leaf-node price fallback ────────────────────

function strategy5LeafNodes(
  $: cheerio.CheerioAPI,
  prev: ParsedSection[],
): ParsedSection[] {
  const section: ParsedSection = { name: "Menu", items: [] };
  const seen = new Set<string>();

  $("p, li, div, span, td, dd").each((_, el) => {
    const $el = $(el);
    if (
      $el.find("p, li, div, span, td, dd").filter((_, c) => PRICE_RE.test($(c).text()))
        .length > 0
    )
      return;

    const text = $el.text().replace(/\s+/g, " ").trim();
    const pm = text.match(PRICE_RE);
    if (!pm || text.length > 300 || text.length < 4) return;

    const item = extractItemFromText(text, pm);
    if (item && !seen.has(item.name.toLowerCase())) {
      seen.add(item.name.toLowerCase());
      section.items.push(item);
    }
  });

  if (section.items.length < 3) return prev;
  return betterOf(prev, [section]);
}

// ─── Extraction helpers ──────────────────────────────────────

function extractItem(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
  text: string,
  priceMatch: RegExpMatchArray,
): ParsedItem | null {
  const price = parseFloat(priceMatch[1]) || null;

  const $nameEl = $el
    .find(
      'h1, h2, h3, h4, h5, h6, strong, b, [class*="name"], [class*="title"]',
    )
    .first();

  let name = "";
  let description = "";

  if ($nameEl.length) {
    name = $nameEl.text().replace(/\s+/g, " ").trim();
    description = text
      .replace(name, "")
      .replace(priceMatch[0], "")
      .replace(/\s+/g, " ")
      .replace(/^[\s\-–—·|]+/, "")
      .trim();
  } else {
    return extractItemFromText(text, priceMatch);
  }

  name = name.replace(PRICE_RE, "").replace(/\s+/g, " ").trim();
  if (!name || name.length < 2 || name.length > 120) return null;
  if (/^\d+$/.test(name) || /^(page|home|back|next|copyright)/i.test(name))
    return null;

  return {
    name: name.slice(0, 80),
    description: description.length > 2 ? description.slice(0, 200) : null,
    price,
    currency: "USD",
    tags: detectTags(`${name} ${description}`),
  };
}

function extractItemFromText(
  text: string,
  priceMatch: RegExpMatchArray,
): ParsedItem | null {
  const price = parseFloat(priceMatch[1]) || null;
  const idx = text.indexOf(priceMatch[0]);
  const before = text.substring(0, idx).trim();
  const after = text.substring(idx + priceMatch[0].length).trim();

  const lines = before.split(/[.\n|–—]/);
  const name = (lines[0] ?? "").trim();
  const description = (lines.slice(1).join(". ").trim() || after)
    .replace(/^[\s\-–—·|]+/, "")
    .trim();

  if (!name || name.length < 2 || name.length > 120) return null;
  if (/^\d+$/.test(name)) return null;

  return {
    name: name.slice(0, 80),
    description: description.length > 2 ? description.slice(0, 200) : null,
    price,
    currency: "USD",
    tags: detectTags(`${name} ${description}`),
  };
}

// ─── Utility ─────────────────────────────────────────────────

function totalItems(sections: ParsedSection[]): number {
  return sections.reduce((n, s) => n + s.items.length, 0);
}

function betterOf(
  a: ParsedSection[],
  b: ParsedSection[],
): ParsedSection[] {
  return totalItems(b) > totalItems(a) ? b : a;
}

function capSections(sections: ParsedSection[]): ParsedSection[] {
  const food: ParsedSection[] = [];
  const drink: ParsedSection[] = [];
  for (const s of sections) {
    (DRINK_SECTION_RE.test(s.name) ? drink : food).push(s);
  }
  return [...food, ...drink.slice(0, 3)].slice(0, 20);
}
