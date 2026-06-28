/**
 * Menu classification + priority selection.
 *
 *   classifyMenuType(input) → { type, confidence, signals }
 *   selectPrimaryMenu(menus) → { primary, hiddenCatering, rejected, trace }
 *
 * The ingestion pipeline produces one or more "menu candidates" — a single
 * URL might yield one menu (most restaurants), or a hospitality / hotel
 * site might surface several (Bar Pendry: Food + Cocktail + Social Hour +
 * Late Night each at their own URL). Previously the aggregator flattened
 * everything into a single combined menu, which meant that when a
 * catering or family-pack URL ranked highest in link discovery, its items
 * could bleed into the "primary" menu and end up as the default the
 * restaurant detail page showed.
 *
 * This module:
 *   1. Classifies each menu candidate by anchor text, URL path, the
 *      menu's own title, its section titles, and item-level signals
 *      (servings, "tray", "feeds X", "dozen", ...).
 *   2. Ranks candidates by an explicit priority table — Main / All Day
 *      first, catering / group-orders / party packs / family meals never
 *      win unless they're literally the only thing on the site.
 *   3. Even then, declines to surface a catering-only menu as the
 *      primary — caller treats that as "Menu unavailable" so a user
 *      browsing for dinner is never shown a 100-person tray menu.
 *
 * Pure module, no I/O. Caller does the fetching and HTML/PDF parsing.
 */

// Enum + priority. Lower priority number = surfaces first.
const MENU_TYPES = Object.freeze({
  MAIN: 'main',
  ALL_DAY: 'all_day',
  LUNCH: 'lunch',
  DINNER: 'dinner',
  BRUNCH: 'brunch',
  BREAKFAST: 'breakfast',
  SPECIALS: 'specials',
  SEASONAL: 'seasonal',
  DRINKS: 'drinks',
  DESSERT: 'dessert',
  KIDS: 'kids',
  HAPPY_HOUR: 'happy_hour',
  CATERING: 'catering',
  GROUP_ORDERS: 'group_orders',
  PARTY_PACKS: 'party_packs',
  FAMILY_MEALS: 'family_meals',
  UNKNOWN: 'unknown',
});

const MENU_TYPE_PRIORITY = Object.freeze({
  [MENU_TYPES.MAIN]: 10,
  [MENU_TYPES.ALL_DAY]: 10,
  [MENU_TYPES.LUNCH]: 20,
  [MENU_TYPES.DINNER]: 21,
  [MENU_TYPES.BRUNCH]: 22,
  [MENU_TYPES.BREAKFAST]: 23,
  [MENU_TYPES.SPECIALS]: 30,
  [MENU_TYPES.SEASONAL]: 31,
  [MENU_TYPES.DRINKS]: 40,
  [MENU_TYPES.DESSERT]: 41,
  [MENU_TYPES.KIDS]: 50,
  [MENU_TYPES.HAPPY_HOUR]: 51,
  [MENU_TYPES.UNKNOWN]: 60,
  // Bulk / event menus — never the default. selectPrimaryMenu won't
  // promote any of these to primary even if they're the only candidate
  // available; the caller treats that as "Menu unavailable".
  [MENU_TYPES.CATERING]: 90,
  [MENU_TYPES.GROUP_ORDERS]: 91,
  [MENU_TYPES.PARTY_PACKS]: 92,
  [MENU_TYPES.FAMILY_MEALS]: 93,
});

const HIDDEN_BY_DEFAULT_TYPES = new Set([
  MENU_TYPES.CATERING,
  MENU_TYPES.GROUP_ORDERS,
  MENU_TYPES.PARTY_PACKS,
  MENU_TYPES.FAMILY_MEALS,
]);

// ─── Signal regexes ─────────────────────────────────────────────────────────
//
// Each rule contributes a positive integer score to its menu type. A rule
// also records which signal fired (for diagnostics / trace logging).
// Scores are tuned so a single strong signal (URL path containing
// "catering") outweighs multiple weak signals from other types — the
// scoring is monotonic, not absolute.
//
// Order within an array doesn't matter — we run them all and sum.

const PATTERN_RULES = [
  // ── Catering family ─────────────────────────────────────────────────
  // These are intentionally first so reviewers can scan them quickly.
  // The patterns are deliberately broad on URL/anchor (the page author
  // chose to call it that) but require corroborating evidence on title
  // alone — a menu titled "Family Dinner" should NOT be classified as
  // catering just because the word "family" appears.
  { field: 'urlPath', type: MENU_TYPES.CATERING, re: /\b(catering|cater)\b/i, score: 60 },
  { field: 'anchor', type: MENU_TYPES.CATERING, re: /\b(catering|cater\s+with)\b/i, score: 60 },
  { field: 'title', type: MENU_TYPES.CATERING, re: /\b(catering\s+(?:menu|options|packages?))\b/i, score: 55 },
  // Boxed lunches are a catering staple but the phrase shows up in
  // ordinary menus too — only fire on URL/anchor.
  { field: 'urlPath', type: MENU_TYPES.CATERING, re: /\b(boxed[-\s]lunch(?:es)?|trays?)\b/i, score: 35 },
  { field: 'anchor', type: MENU_TYPES.CATERING, re: /\b(boxed[-\s]lunch(?:es)?|trays?)\b/i, score: 35 },

  { field: 'urlPath', type: MENU_TYPES.GROUP_ORDERS, re: /\b(group[-\s]?order(?:s|ing)?|bulk[-\s]order(?:s)?)\b/i, score: 60 },
  { field: 'anchor', type: MENU_TYPES.GROUP_ORDERS, re: /\b(group[-\s]?order(?:s|ing)?|bulk[-\s]order(?:s)?|office\s+lunch)\b/i, score: 60 },
  { field: 'title', type: MENU_TYPES.GROUP_ORDERS, re: /\b(group\s+order(?:s|ing)?|bulk\s+order(?:s)?)\b/i, score: 55 },

  { field: 'urlPath', type: MENU_TYPES.PARTY_PACKS, re: /\b(party[-\s]packs?|party[-\s]platters?|celebration[-\s]packs?)\b/i, score: 60 },
  { field: 'anchor', type: MENU_TYPES.PARTY_PACKS, re: /\b(party[-\s]packs?|party[-\s]platters?)\b/i, score: 60 },
  { field: 'title', type: MENU_TYPES.PARTY_PACKS, re: /\b(party\s+packs?|party\s+platters?)\b/i, score: 55 },

  { field: 'urlPath', type: MENU_TYPES.FAMILY_MEALS, re: /\b(family[-\s]meals?|family[-\s]packs?|family[-\s]bundles?|family[-\s]style[-\s]menu)\b/i, score: 60 },
  { field: 'anchor', type: MENU_TYPES.FAMILY_MEALS, re: /\b(family\s+meals?|family\s+packs?|family\s+bundles?)\b/i, score: 60 },
  { field: 'title', type: MENU_TYPES.FAMILY_MEALS, re: /\b(family\s+meals?|family\s+packs?|family\s+bundles?)\b/i, score: 50 },

  // ── Meal periods ────────────────────────────────────────────────────
  { field: 'urlPath', type: MENU_TYPES.BRUNCH, re: /\b(brunch)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.BRUNCH, re: /\b(brunch)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.BRUNCH, re: /\b(brunch)\b/i, score: 50 },

  { field: 'urlPath', type: MENU_TYPES.BREAKFAST, re: /\b(breakfast|morning)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.BREAKFAST, re: /\b(breakfast|morning)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.BREAKFAST, re: /\b(breakfast)\b/i, score: 50 },

  { field: 'urlPath', type: MENU_TYPES.LUNCH, re: /\b(lunch)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.LUNCH, re: /\b(lunch)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.LUNCH, re: /\b(lunch)\b/i, score: 50 },

  { field: 'urlPath', type: MENU_TYPES.DINNER, re: /\b(dinner|supper|late[-\s]?night)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.DINNER, re: /\b(dinner|supper|late[-\s]?night)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.DINNER, re: /\b(dinner|supper)\b/i, score: 50 },

  // ── Drinks / dessert / kids / happy hour ────────────────────────────
  { field: 'urlPath', type: MENU_TYPES.DRINKS, re: /\b(drinks?|cocktails?|wine|beer|spirits?|bar[-\s]menu|beverages?)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.DRINKS, re: /\b(drinks?|cocktails?|wine\s+list|beer\s+list|spirits?|bar\s+menu|beverages?)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.DRINKS, re: /\b(drinks?\s+menu|cocktail\s+menu|wine\s+list|beer\s+list|bar\s+menu)\b/i, score: 50 },

  { field: 'urlPath', type: MENU_TYPES.DESSERT, re: /\b(dessert|pastr(?:y|ies)|sweets?)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.DESSERT, re: /\b(dessert|pastr(?:y|ies)|sweets?)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.DESSERT, re: /\b(dessert\s+menu|pastry\s+menu)\b/i, score: 50 },

  { field: 'urlPath', type: MENU_TYPES.KIDS, re: /\b(kids?|childrens?|little[-\s]ones?)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.KIDS, re: /\b(kids?\s+menu|childrens?\s+menu)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.KIDS, re: /\b(kids?\s+menu|childrens?\s+menu)\b/i, score: 50 },

  { field: 'urlPath', type: MENU_TYPES.HAPPY_HOUR, re: /\b(happy[-\s]hour|social[-\s]hour)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.HAPPY_HOUR, re: /\b(happy\s+hour|social\s+hour)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.HAPPY_HOUR, re: /\b(happy\s+hour|social\s+hour)\b/i, score: 50 },

  // ── Specials / seasonal ─────────────────────────────────────────────
  { field: 'urlPath', type: MENU_TYPES.SPECIALS, re: /\b(specials?|features?)\b/i, score: 35 },
  { field: 'anchor', type: MENU_TYPES.SPECIALS, re: /\b(specials?|chef'?s?\s+specials?|features?)\b/i, score: 35 },
  { field: 'title', type: MENU_TYPES.SPECIALS, re: /\b(specials?|features?)\b/i, score: 30 },

  { field: 'urlPath', type: MENU_TYPES.SEASONAL, re: /\b(seasonal|winter|summer|spring|fall|autumn|holiday)\b/i, score: 30 },
  { field: 'anchor', type: MENU_TYPES.SEASONAL, re: /\b(seasonal\s+menu|winter\s+menu|summer\s+menu|holiday\s+menu)\b/i, score: 35 },
  { field: 'title', type: MENU_TYPES.SEASONAL, re: /\b(seasonal|winter|summer|spring|fall|autumn|holiday)\b/i, score: 30 },

  // ── Main / all-day defaults ─────────────────────────────────────────
  { field: 'urlPath', type: MENU_TYPES.MAIN, re: /\b(the[-\s]?menu|main[-\s]?menu|food|eats?|dining|kitchen)\b/i, score: 40 },
  { field: 'urlPath', type: MENU_TYPES.MAIN, re: /^\/menus?\/?$/i, score: 45 },
  { field: 'anchor', type: MENU_TYPES.MAIN, re: /\b(menu|food\s+menu|main\s+menu|the\s+menu)\b/i, score: 30 },
  { field: 'title', type: MENU_TYPES.MAIN, re: /\b(main\s+menu|food\s+menu|dinner\s*\/\s*lunch)\b/i, score: 35 },

  { field: 'urlPath', type: MENU_TYPES.ALL_DAY, re: /\b(all[-\s]?day)\b/i, score: 50 },
  { field: 'anchor', type: MENU_TYPES.ALL_DAY, re: /\b(all[-\s]?day)\b/i, score: 50 },
  { field: 'title', type: MENU_TYPES.ALL_DAY, re: /\b(all[-\s]?day\s+menu)\b/i, score: 50 },
];

// Item-level catering signals: phrases that, when frequent in dish names,
// strongly imply the menu is a catering / bulk-order menu even when no
// URL / anchor / title evidence fired.
const ITEM_CATERING_RES = [
  /\b(serves?\s+\d+|feeds?\s+\d+)\b/i,
  /\b\d+\s+(?:guests?|people|portions?)\b/i,
  /\b(tray|trays|platter|platters)\b/i,
  /\b\d+\s+(?:dozen|piece(?:s)?)\b/i,
  /\b(party\s+pack|family\s+pack|combo\s+pack)\b/i,
  /\bbulk\s+order/i,
  /\bboxed\s+lunch(?:es)?\b/i,
];

// ─── Public: classify a single menu candidate ──────────────────────────────

/**
 * @param {object} input
 * @param {string} [input.urlPath]   - pathname portion of sourceUrl, lowercased
 * @param {string} [input.anchorText] - anchor text that led us to this page
 * @param {string} [input.title]      - menu title / page <title> / page <h1>
 * @param {string[]} [input.sectionTitles]
 * @param {string[]} [input.itemNames]
 * @returns {{ type: string, confidence: number, scores: Record<string, number>, signals: string[] }}
 */
function classifyMenuType(input = {}) {
  const fields = {
    urlPath: String(input.urlPath || ''),
    anchor: String(input.anchorText || ''),
    title: String(input.title || ''),
  };
  const sectionTitles = Array.isArray(input.sectionTitles) ? input.sectionTitles : [];
  const itemNames = Array.isArray(input.itemNames) ? input.itemNames : [];
  const scores = {};
  const signals = [];

  for (const rule of PATTERN_RULES) {
    const text = fields[rule.field] || '';
    if (!text) continue;
    if (rule.re.test(text)) {
      scores[rule.type] = (scores[rule.type] || 0) + rule.score;
      signals.push(`${rule.type}:${rule.field}~${rule.re.source.slice(0, 30)}`);
    }
  }

  // Section-title hints — slightly lower weight than URL/anchor/title.
  for (const sec of sectionTitles) {
    const t = String(sec || '');
    if (!t) continue;
    for (const rule of PATTERN_RULES) {
      if (rule.field !== 'title') continue;
      if (rule.re.test(t)) {
        scores[rule.type] = (scores[rule.type] || 0) + Math.floor(rule.score / 2);
        signals.push(`${rule.type}:section~${t.slice(0, 40)}`);
      }
    }
  }

  // Item-level catering signals. Counted per-item, capped so a single
  // verbose menu doesn't accidentally classify itself as catering by
  // mentioning "serves 4" twice.
  let cateringItemHits = 0;
  for (const name of itemNames) {
    const t = String(name || '');
    if (!t) continue;
    if (ITEM_CATERING_RES.some((re) => re.test(t))) cateringItemHits += 1;
  }
  if (cateringItemHits >= 1) {
    // 1-2 hits → soft contribution, 3+ → strong.
    const itemBoost = Math.min(40, 10 + cateringItemHits * 8);
    scores[MENU_TYPES.CATERING] = (scores[MENU_TYPES.CATERING] || 0) + itemBoost;
    signals.push(`catering:items~${cateringItemHits}`);
  }

  if (Object.keys(scores).length === 0) {
    return { type: MENU_TYPES.UNKNOWN, confidence: 0, scores, signals };
  }
  let bestType = MENU_TYPES.UNKNOWN;
  let bestScore = -1;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) { bestType = type; bestScore = score; }
  }
  // Confidence: a saturating function of the winning score so 0–1 stays
  // monotonic but doesn't run off to infinity for super-strong matches.
  const confidence = Math.max(0, Math.min(1, bestScore / 100));
  return { type: bestType, confidence, scores, signals };
}

// ─── Public: select primary from a list of candidate menus ─────────────────

/**
 * @param {Array<{
 *   sections: Array<{ title?: string, items: Array<{ name?: string }> }>,
 *   sourceUrl?: string,
 *   anchorText?: string,
 *   menuTitle?: string,
 *   source?: string,
 *   menuType?: string,
 *   confidence?: number,
 * }>} candidates
 * @param {object} [opts]
 * @param {boolean} [opts.allowCateringFallback=false] - if no non-catering
 *   menu exists, surface the best catering candidate anyway. The default
 *   matches the product requirement: prefer "Menu unavailable" over a
 *   group-order menu.
 * @returns {{
 *   primary: object|null,
 *   hidden: Array<object>,
 *   rejected: Array<{ candidate: object, reason: string }>,
 *   trace: object,
 * }}
 */
function selectPrimaryMenu(candidates, opts = {}) {
  const allowCateringFallback = !!opts.allowCateringFallback;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { primary: null, hidden: [], rejected: [], trace: { reason: 'no_candidates' } };
  }

  // Annotate every candidate with its classification + priority.
  const annotated = candidates.map((cand) => {
    let urlPath = '';
    try { if (cand.sourceUrl) urlPath = new URL(cand.sourceUrl).pathname; }
    catch { urlPath = ''; }

    const sectionTitles = (cand.sections || []).map((s) => s?.title || '').filter(Boolean);
    const itemNames = (cand.sections || [])
      .flatMap((s) => (s?.items || []).map((it) => it?.name || ''))
      .filter(Boolean);

    // Trust pre-existing classification if the caller already ran it
    // (e.g. provider parser knew the menu was a wine list). Otherwise
    // classify here.
    const fromCand = cand.menuType
      ? { type: cand.menuType, confidence: cand.confidence ?? 0.7, scores: {}, signals: ['caller-provided'] }
      : classifyMenuType({
          urlPath,
          anchorText: cand.anchorText || '',
          title: cand.menuTitle || '',
          sectionTitles,
          itemNames,
        });

    const priority = MENU_TYPE_PRIORITY[fromCand.type] ?? MENU_TYPE_PRIORITY[MENU_TYPES.UNKNOWN];
    const itemCount = (cand.sections || []).reduce((n, s) => n + ((s?.items || []).length || 0), 0);
    return {
      candidate: cand,
      classification: fromCand,
      priority,
      itemCount,
      hiddenByDefault: HIDDEN_BY_DEFAULT_TYPES.has(fromCand.type),
    };
  });

  // Reject empties up front — no items, nothing to surface.
  const withItems = annotated.filter((a) => a.itemCount > 0);
  const rejected = annotated
    .filter((a) => a.itemCount === 0)
    .map((a) => ({ candidate: a.candidate, reason: 'no_items', classification: a.classification }));

  if (withItems.length === 0) {
    return {
      primary: null,
      hidden: [],
      rejected,
      trace: { reason: 'all_candidates_empty', annotated },
    };
  }

  // Hidden = catering / group / party / family. Held aside; never the
  // primary unless allowCateringFallback is set AND it's the only option.
  const visible = withItems.filter((a) => !a.hiddenByDefault);
  const hidden = withItems.filter((a) => a.hiddenByDefault);

  if (visible.length === 0) {
    if (allowCateringFallback && hidden.length > 0) {
      // Sort hidden by priority + size, take the best.
      hidden.sort((a, b) => a.priority - b.priority || b.itemCount - a.itemCount);
      const chosen = hidden[0];
      return {
        primary: { ...chosen.candidate, menuType: chosen.classification.type, confidence: chosen.classification.confidence },
        hidden: hidden.slice(1).map((h) => ({ ...h.candidate, menuType: h.classification.type })),
        rejected,
        trace: {
          reason: 'only_catering_available_promoted',
          chosen: chosen.classification,
        },
      };
    }
    return {
      primary: null,
      hidden: hidden.map((h) => ({ ...h.candidate, menuType: h.classification.type })),
      rejected,
      trace: {
        reason: 'only_catering_available_suppressed',
        hiddenTypes: hidden.map((h) => h.classification.type),
      },
    };
  }

  // Tiebreaker chain: lower priority number, then higher confidence, then
  // higher item count, then stable order.
  visible.sort((a, b) => (
    a.priority - b.priority
    || (b.classification.confidence - a.classification.confidence)
    || (b.itemCount - a.itemCount)
  ));
  const chosen = visible[0];
  const others = visible.slice(1);

  return {
    primary: { ...chosen.candidate, menuType: chosen.classification.type, confidence: chosen.classification.confidence },
    // Returned to the caller so the UI can offer a tab switcher between
    // all available menus. Hidden catering menus are still here but
    // flagged so the UI can default to "Off" / require explicit opt-in.
    hidden: hidden.map((h) => ({ ...h.candidate, menuType: h.classification.type, confidence: h.classification.confidence, hiddenByDefault: true })),
    others: others.map((o) => ({ ...o.candidate, menuType: o.classification.type, confidence: o.classification.confidence })),
    rejected,
    trace: {
      reason: 'standard_priority',
      chosen: chosen.classification,
      othersTypes: others.map((o) => o.classification.type),
      hiddenTypes: hidden.map((h) => h.classification.type),
    },
  };
}

module.exports = {
  MENU_TYPES,
  MENU_TYPE_PRIORITY,
  HIDDEN_BY_DEFAULT_TYPES,
  classifyMenuType,
  selectPrimaryMenu,
};
