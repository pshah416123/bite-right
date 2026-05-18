/** Shared types for every parser in the pipeline. */

export interface ParsedItem {
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  tags: ItemTags;
}

export interface ItemTags {
  isVeg: boolean;
  isVegan: boolean;
  isSpicy: boolean;
  isGlutenFree: boolean;
}

export interface ParsedSection {
  name: string;
  items: ParsedItem[];
}

export interface ParseResult {
  sections: ParsedSection[];
  confidence: number; // 0..1
  parserType: string; // e.g. "json-ld", "toasttab", "generic-html"
}

export const EMPTY_RESULT: ParseResult = {
  sections: [],
  confidence: 0,
  parserType: "none",
};

/** A parser takes raw HTML and returns structured menu data (or null). */
export type Parser = (html: string, url: string) => ParseResult | null;

// ─── Price regex shared across parsers ───────────────────────

/** Matches prices like $12, $12.50, $12.99, 12.50 */
export const PRICE_RE = /\$\s?(\d{1,4}(?:\.\d{2})?)/;

/** Section names to skip (not food). */
export const SKIP_SECTION_RE =
  /\b(contact|location|hours|about us|reservat|order online|deliver|follow us|subscribe|newsletter|careers?|testimonial|reviews?|gallery|photos?|privacy|terms)\b/i;

/** Drink sections — kept but de-prioritized. */
export const DRINK_SECTION_RE =
  /^(cocktails?|beers?|wines?|wine list|ciders?|spirits?|beverages?|drinks?|liqueurs?|liquors?|whiskey|bourbon|vodka|tequila|rum|gin|sake|champagne|sparkling|ros[eé]|red wines?|white wines?|draft|bottled beer|scotch|brandy|cognac|armagnac|coffee|tea|juice|smoothie|milkshake|happy hour|bar menu)$/i;
