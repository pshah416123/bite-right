/**
 * Multi-location site detection + URL picker.
 *
 * A meaningful fraction of restaurant websites that return zero menu items
 * aren't broken — they're location selectors. The user lands on
 * chiporestaurantgroup.com/locations and is expected to pick a city. The
 * scraper sees a list of locations with no menu items and gives up,
 * even though the actual menu lives one hop away at .../chicago-loop.
 *
 * This module:
 *   1. detectMultiLocationSite(html, baseUrl) — recognizes location-picker
 *      patterns and returns the candidate location URLs found on the page
 *   2. pickBestLocationUrl(candidates, restaurantContext) — uses the
 *      restaurant's address tokens (city, neighborhood, state, zip) to
 *      pick the URL most likely to match this specific location
 *
 * Both are pure functions — no network calls, no caching. The pipeline
 * decides whether to fetch the picked URL.
 */
const cheerio = require('cheerio');

// Path-based signals: any URL whose path begins with a location route.
// Tight on segment boundaries so we don't false-positive on /restaurant/
// in a single-location restaurant's homepage (e.g. "About the Restaurant").
const LOCATION_PATH_RE = /\/(?:locations?|find-a-location|find-(?:a-)?(?:store|cafe|restaurant)|find-us|our-locations?|stores?|store-locator|restaurants?|cafes?|outlets?|branches?|cities|nearby|areas?|neighborhood)(?:\/[a-z0-9-]+)+(?:\/?$|\?)/i;

// Text-based signals: anchor text or page headings that explicitly tell
// the visitor to pick a location. These are strong markers even when the
// URL pattern isn't itself location-shaped (e.g. JS-driven selectors).
const LOCATION_PICKER_TEXT_RE = /\b(?:choose\s+(?:a\s+|your\s+)?location|find\s+(?:a\s+|your\s+)?(?:location|nearest|store|cafe|restaurant)|select\s+(?:a\s+)?(?:location|store|city)|all\s+locations|view\s+all\s+locations|locations\s+near\s+you|where\s+are\s+you|pick\s+(?:a\s+|your\s+)location|nearest\s+(?:store|location|cafe|restaurant))\b/i;

// Junk anchor text we should never treat as a location candidate even if
// the URL pattern matches (e.g. "View on map" → /locations/map.html).
const NON_LOCATION_TEXT_RE = /\b(?:about|contact|career|hire|legal|terms|privacy|press|media|gallery|news|reservation|directions|map)\b/i;

/**
 * Inspect a page and decide whether it looks like a multi-location
 * landing. Returns:
 *   {
 *     isMultiLocation: boolean,
 *     candidateLinks: [{ url, label }],
 *     signals: { pathLinks, textHeader, locationSelect, pickerAnchor },
 *   }
 */
function detectMultiLocationSite(html, baseUrl) {
  const empty = { isMultiLocation: false, candidateLinks: [], signals: {} };
  if (!html || typeof html !== 'string') return empty;
  if (!baseUrl) return empty;

  let $;
  try { $ = cheerio.load(html); } catch { return empty; }

  // ── Pattern 1: anchor URLs that look like /locations/<slug> ──
  const seen = new Set();
  const candidateLinks = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').trim().replace(/\s+/g, ' ');
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return;

    let abs;
    try { abs = new URL(href, baseUrl).href; } catch { return; }
    // Skip off-domain — multi-location signal is intra-site.
    try {
      const base = new URL(baseUrl);
      const cand = new URL(abs);
      if (cand.host !== base.host && !cand.host.endsWith('.' + base.host)) return;
    } catch { return; }

    if (seen.has(abs)) return;
    if (NON_LOCATION_TEXT_RE.test(text)) return;

    const hrefLooksLocational = LOCATION_PATH_RE.test(abs);
    const textLooksLocational = LOCATION_PICKER_TEXT_RE.test(text);
    if (hrefLooksLocational || textLooksLocational) {
      seen.add(abs);
      candidateLinks.push({ url: abs, label: text || href });
    }
  });

  // ── Pattern 2: page heading / title says "find your location" ──
  const title = ($('title').text() || '').trim();
  const headings = $('h1, h2, h3').map((_, el) => $(el).text() || '').get().join(' ');
  const textHeader = LOCATION_PICKER_TEXT_RE.test(`${title} ${headings}`);

  // ── Pattern 3: <select> dropdown with ≥3 location-y options ──
  let locationSelect = false;
  $('select').each((_, sel) => {
    const optCount = $(sel).find('option').length;
    if (optCount < 3) return;
    const idAttr = ($(sel).attr('id') || '').toLowerCase();
    const nameAttr = ($(sel).attr('name') || '').toLowerCase();
    if (/(location|store|city|outlet|branch|restaurant)/.test(idAttr + ' ' + nameAttr)) {
      locationSelect = true;
    }
  });

  // ── Pattern 4: explicit "select a location" button/anchor on the page ──
  let pickerAnchor = false;
  $('a, button').each((_, el) => {
    const text = ($(el).text() || '').trim();
    if (LOCATION_PICKER_TEXT_RE.test(text)) { pickerAnchor = true; return false; }
  });

  const pathLinks = candidateLinks.length;
  // Threshold logic: 3+ intra-domain location links is the strong signal;
  // header/picker/select text are confirmations that bump us over the
  // line when there are only 1-2 link candidates (e.g. JS-rendered).
  const isMultiLocation =
    pathLinks >= 3 ||
    (pathLinks >= 1 && (textHeader || locationSelect || pickerAnchor));

  return {
    isMultiLocation,
    candidateLinks,
    signals: { pathLinks, textHeader, locationSelect, pickerAnchor },
  };
}

/**
 * Tokenize an address into normalized lowercase words ≥3 chars. Used to
 * score candidate location URLs against the restaurant's actual address.
 */
function tokenizeAddress(context) {
  if (!context) return [];
  const tokens = new Set();
  const add = (s) => {
    if (!s) return;
    String(s).toLowerCase()
      .split(/[\s,\-/.]+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ''))
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      .forEach((t) => tokens.add(t));
  };
  add(context.city);
  add(context.state);
  add(context.neighborhood);
  add(context.address);
  if (context.zip) tokens.add(String(context.zip));
  return Array.from(tokens);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'usa', 'inc', 'llc',
  'st', 'street', 'ave', 'avenue', 'road', 'rd', 'blvd', 'boulevard',
  'dr', 'drive', 'lane', 'ln', 'way', 'pl', 'place', 'ct', 'court',
  'apt', 'suite', 'unit', 'floor',
]);

/**
 * Pick the candidate URL most likely to belong to the given restaurant.
 * Scores each candidate by how many address tokens appear in its URL
 * path + anchor label. Longer matching tokens count more (so a city name
 * outweighs a single shared digit). Returns null when no candidate has
 * any token overlap — better to fall through to other pipeline steps
 * than to follow an arbitrary link.
 */
function pickBestLocationUrl(candidateLinks, context) {
  if (!Array.isArray(candidateLinks) || candidateLinks.length === 0) return null;
  const tokens = tokenizeAddress(context);
  if (tokens.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const c of candidateLinks) {
    const hay = `${c.url} ${c.label || ''}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      // Word-boundary-ish match: require the token to appear as its own
      // segment to avoid "lake" matching "lakeland-mall".
      const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (re.test(hay)) score += t.length;
    }
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

module.exports = {
  detectMultiLocationSite,
  pickBestLocationUrl,
  tokenizeAddress,
};
