/**
 * PDF menu pipeline.
 *
 * Pipeline:
 *   1. detectMenuPdfUrls(html, baseUrl) — scan for likely menu PDFs
 *   2. extractMenuFromPdfUrl(url)       — download + pdf-parse + structure
 *
 * Heuristics, not magic. Works well for text-layer PDFs (the majority).
 * Image-only PDFs would need OCR — out of scope for Phase 2.
 */

const axios = require('axios');
// pdf-parse@2 is a complete API rewrite — it exports a `PDFParse` class
// instead of a default function. Calling the old `pdfParse(buf)` shape
// throws TypeError, which our try/catch silently swallowed, so PDF menus
// looked like "discovery works but extraction returns empty" for every
// restaurant. New shape: `new PDFParse({ data: buf }).getText()`.
const { PDFParse } = require('pdf-parse');
const visionWrapper = (() => {
  try { return require('./menuVision'); }
  catch { return { extractMenuFromPdfBytes: null, isConfigured: () => false }; }
})();

// 15MB — covers most graphic-design menu PDFs (GoDaddy/Wix hosts often
// publish 5–10MB versions). The earlier 5MB cap silently rejected the
// 6.4MB Rebecca's Northville PDF, leaving the pipeline to fall through
// to garbage text from a smaller variant. We never load the buffer twice,
// so the memory cost is the file size itself.
const PDF_MAX_BYTES = 15 * 1024 * 1024;
const PDF_FETCH_TIMEOUT_MS = 12000;

const PDF_DOWNLOAD_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/pdf,*/*;q=0.8',
};

// ─── 1. Detect ──────────────────────────────────────────────────────────────

/**
 * Find candidate PDF URLs in HTML, ranked by likelihood of being a real menu.
 * Returns up to 3 absolute URLs.
 */
function detectMenuPdfUrls(html, baseUrl) {
  if (typeof html !== 'string' || !html) return [];
  const candidates = new Map(); // url -> score

  // <a href="...pdf"> with surrounding anchor text
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const anchorText = m[2].replace(/<[^>]+>/g, '').toLowerCase();
    const abs = absoluteUrl(href, baseUrl);
    if (!abs) continue;
    const score = scorePdfCandidate(abs, anchorText);
    if (score <= 0) continue;
    candidates.set(abs, Math.max(candidates.get(abs) || 0, score));
  }

  // <embed src="...pdf"> / <iframe src="...pdf"> — usually the primary menu
  const embedRe = /<(?:embed|iframe)\s+[^>]*src\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi;
  while ((m = embedRe.exec(html)) !== null) {
    const abs = absoluteUrl(m[1], baseUrl);
    if (!abs) continue;
    const score = scorePdfCandidate(abs, '') + 30; // embed bias
    candidates.set(abs, Math.max(candidates.get(abs) || 0, score));
  }

  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([url]) => url);
}

function scorePdfCandidate(url, anchorText) {
  const u = url.toLowerCase();
  const t = anchorText.toLowerCase();
  let score = 10; // baseline for being a PDF link

  // Filename signals
  if (/\bmenu\b/.test(u)) score += 40;
  if (/\bdinner\b/.test(u)) score += 25;
  if (/\blunch\b/.test(u)) score += 20;
  if (/\bbrunch\b/.test(u)) score += 18;
  if (/\bfood\b/.test(u)) score += 15;
  if (/\bdrinks?\b|\bwine\b|\bbeer\b|\bcocktail\b/.test(u)) score += 5; // useful but not primary
  if (/\bcatering\b|\bevent\b|\bprivate\b|\bbuyout\b/.test(u)) score -= 25;
  if (/\bnutrition\b|\ballergens?\b/.test(u)) score -= 30;
  if (/\bcareers?\b|\bjobs?\b|\bemployment\b|\bw2\b/.test(u)) score -= 100;

  // Anchor-text signals
  if (/\bmenu\b/.test(t)) score += 30;
  if (/\bdinner\b/.test(t)) score += 15;
  if (/\bsee our menu\b|\bview menu\b|\bfull menu\b|\bdownload menu\b/.test(t)) score += 25;

  return score;
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

// ─── 2. Download + parse ────────────────────────────────────────────────────

async function downloadPdf(url) {
  try {
    const res = await axios.get(url, {
      timeout: PDF_FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: PDF_MAX_BYTES,
      maxBodyLength: PDF_MAX_BYTES,
      headers: PDF_DOWNLOAD_HEADERS,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    // Some servers return text/html for redirects we missed; bail.
    if (contentType && !contentType.includes('pdf')) return null;
    const buf = Buffer.from(res.data);
    if (buf.length < 1000) return null; // implausibly small for a menu
    return buf;
  } catch {
    return null;
  }
}

const DEBUG_PDF = !!process.env.DEBUG_MENU_EXTRACT;
const dlog = (...args) => { if (DEBUG_PDF) console.log('[menuPdf]', ...args); };

// Beverage-category indicators. Used during a post-processing pass to
// detect items that bled in from a different physical column of a
// multi-column PDF (e.g. a sake item landing under a food header like
// "ZUZU ROLLS" or "LOBSTER TEMPURA"). We don't want to split sushi
// rolls into a sake section just because of a column accident.
const SAKE_INDICATORS_RE =
  /\b(?:sake|junmai|ginjo|daiginjo|honjozo|nigori|namazake|tokubetsu|kura|brewery|polish(?:ing|ed)?\s*rate|seimaibuai|rice\s*polish|hakkaisan|dassai|kubota|otokoyama|kikusui|fukucho|nanbu\s*bijin|den\s*kotobuki|tatenokawa|izumibashi)\b/i;
const WINE_INDICATORS_RE =
  /\b(?:vintage|chardonnay|cabernet|sauvignon|merlot|pinot\s+(?:noir|grigio|gris)|riesling|syrah|shiraz|tempranillo|malbec|prosecco|champagne|sparkling|rose|rosé|sangiovese|grenache|zinfandel|gewurztraminer|albari[ñn]o|viognier|nebbiolo|cava|brut|reserve|napa|sonoma|bordeaux|burgundy|tuscany|piedmont)\b/i;
const COCKTAIL_INDICATORS_RE =
  /\b(?:negroni|martini|margarita|manhattan|old\s*fashioned|daiquiri|mojito|paloma|spritz|sour|highball|julep|cosmo|gimlet|aperol|campari|amaro|vermouth|bitters|gin|vodka|rum|tequila|mezcal|bourbon|rye|scotch|whiskey|whisky)\b/i;
const BEER_INDICATORS_RE =
  /\b(?:ipa|pilsner|lager|stout|porter|hefeweizen|saison|kolsch|kölsch|gose|sour\s+ale|hazy|pale\s+ale|amber\s+ale|wheat\s+ale|on\s+draft|draft|cask|abv)\b/i;
// Short evaluative phrases that show up in beverage tasting notes — e.g.
// sake menus list "Light & Dry", "Full & Sweet". When these are item
// names, they are almost certainly column-bleed flavor descriptors.
const BEVERAGE_FLAVOR_RE =
  /^(?:light(?:\s*&\s*|\s+(?:and\s+)?)(?:dry|crisp|sweet|fruity)|full(?:\s*&\s*|\s+(?:and\s+)?)(?:sweet|bodied|dry|rich)|sweet(?:\s*&\s*|\s+(?:and\s+)?)(?:tart|fruity|dry|crisp)|dry(?:\s*&\s*|\s+(?:and\s+)?)(?:crisp|spicy|earthy)|rich(?:\s*&\s*|\s+(?:and\s+)?)(?:fruity|sweet|smooth)|earthy(?:\s*&\s*|\s+(?:and\s+)?)\w+)$/i;

function categorizeItem(name, description) {
  const blob = `${name || ''} ${description || ''}`;
  if (BEVERAGE_FLAVOR_RE.test((name || '').trim())) return 'beverage-flavor';
  if (SAKE_INDICATORS_RE.test(blob)) return 'sake';
  if (WINE_INDICATORS_RE.test(blob)) return 'wine';
  if (COCKTAIL_INDICATORS_RE.test(blob)) return 'cocktail';
  if (BEER_INDICATORS_RE.test(blob)) return 'beer';
  return 'food';
}

function categorizeSectionTitle(title) {
  const t = (title || '').toLowerCase();
  if (/\b(?:sake|junmai|ginjo|daiginjo|nigori)\b/.test(t)) return 'sake';
  if (/\b(?:wine|wines|champagne|sparkling|by\s+the\s+(?:glass|bottle))\b/.test(t)) return 'wine';
  if (/\b(?:cocktail|cocktails|spirit|spirits|whisk(?:e)?y|bourbon|gin|vodka|rum|tequila|mezcal)\b/.test(t)) return 'cocktail';
  if (/\b(?:beer|beers|draft|drafts|on\s+tap|brews?)\b/.test(t)) return 'beer';
  if (/\b(?:drink|drinks|beverage|beverages|bar|libation)\b/.test(t)) return 'beverage';
  return 'food';
}

/**
 * Parse extracted PDF text into MenuSection[].
 * Heuristics:
 *   - ALL-CAPS line (≥3 chars, no digits) -> section header
 *   - line ending with $X.XX            -> item + price
 *   - long line right after an item     -> description for that item
 *
 * After parsing, a category-consistency pass detects beverage items
 * (sake, wine, cocktails, beer) that bled into food sections from
 * adjacent PDF columns and either moves them into a proper beverage
 * section or drops them entirely if they look like flavor descriptors.
 */
function parsePdfTextToSections(text) {
  if (typeof text !== 'string' || text.length < 50) return null;

  // Normalize: keep meaningful newlines; collapse runs of spaces
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim())
    .filter(Boolean);

  if (lines.length < 5) return null;

  const PRICE_LINE_RE = /^(.*?)[\s.…-]+\$?\s*(\d{1,4}(?:\.\d{1,2})?)$/;
  const isAllCaps = (s) =>
    s.length >= 3 && s.length <= 60 &&
    /^[A-Z0-9 &'/-]+$/.test(s) &&
    /[A-Z]/.test(s) &&
    !/\d{2,}/.test(s);
  const NOT_A_DISH_RE =
    /\b(closed|kitchen|opening hours|order online|delivery|takeout|pickup|reservations?|book a table|call us|contact|follow us|visit us|hours|allergen)\b/i;

  // Whitelist of words that genuinely identify menu sections vs items.
  // An ALL-CAPS line that doesn't include one of these is more likely a
  // dish name styled in caps than a section header. Previously
  // "LOBSTER TEMPURA" and "SHRIMP TEMPURA" were being promoted to
  // sections (each containing 1 unrelated item from the next column of
  // the multi-column PDF), which produced garbage like a "Lobster
  // Tempura" section full of sake items.
  const SECTION_HINT_RE = /\b(?:menu|appetizers?|starters?|small\s?plates?|mains?|entr[ée]es?|sides?|sandwich|burger|burritos?|tacos?|pasta|noodles?|salads?|soups?|desserts?|sweets?|drinks?|beverages?|wines?|beers?|cocktails?|spirits?|sakes?|whisk(?:e)?ys?|breakfast|brunch|lunch|dinner|specials?|features?|rolls?|nigiri|sashimi|maki|tempura\s+rolls?|signature|kids|family|sides?\s+and|grill|raw\s?bar|oyster|sushi|pizza|favorites?|classics?|chef'?s)\b/i;

  const sections = [];
  let current = null;
  const ensureCurrent = (title = 'Menu') => {
    if (!current) {
      current = { title, items: [] };
      sections.push(current);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isAllCaps(line)) {
      // Only treat this as a section header if it CONTAINS a recognized
      // menu-category word. Otherwise it's almost certainly a dish name
      // styled in all-caps (e.g. "LOBSTER TEMPURA", "BLUEFIN").
      if (SECTION_HINT_RE.test(line)) {
        current = { title: titleCase(line), items: [] };
        sections.push(current);
      }
      // Either way, skip this line — never emit it as an item.
      continue;
    }

    const priceMatch = line.match(PRICE_LINE_RE);
    if (priceMatch) {
      const name = priceMatch[1].trim().replace(/[.…-]+$/, '').trim();
      const priceNum = parseFloat(priceMatch[2]);
      if (!name || NOT_A_DISH_RE.test(name) || name.length < 2 || name.length > 80) continue;
      if (!Number.isFinite(priceNum) || priceNum < 1 || priceNum > 500) continue;
      // Reject fragment "names" with no real content — "Your choice of",
      // "Add to any", "Add a". Indicates we caught an inter-item fragment.
      if (/^(?:your\s+choice|add\s+to|add\s+a|served\s+with|comes\s+with|choice\s+of)\b/i.test(name)) continue;
      ensureCurrent();
      const item = {
        name,
        description: null,
        price: `$${priceNum.toFixed(2)}`,
        tags: null,
        photoUrl: null,
      };
      // Look ahead: if the next line is sentence-like (lowercase, doesn't match
      // a price, isn't a header), treat it as the description.
      const next = lines[i + 1];
      if (next && !PRICE_LINE_RE.test(next) && !isAllCaps(next) && /[a-z]/.test(next) && next.length > 8 && next.length < 200) {
        item.description = next;
        i++;
      }
      current.items.push(item);
    }
  }

  // Drop sections that ended up with 0 or 1 items — those are usually
  // misclassified headers from a multi-column PDF where the items below
  // belong to a different physical column. The previous-section sweep
  // merges single-item orphans into the previous valid section so the
  // dish itself isn't lost.
  const cleaned = [];
  for (const sec of sections) {
    if (sec.items.length >= 2) {
      cleaned.push(sec);
    } else if (sec.items.length === 1 && cleaned.length > 0) {
      cleaned[cleaned.length - 1].items.push(sec.items[0]);
    }
    // sec.items.length === 0 → drop entirely
  }

  // Category-consistency pass: for each section, classify each item.
  // If a section's title is "food" but a majority of its items are
  // beverages, the header was a column-bleed accident — relabel the
  // section. If only a minority of items are beverages, hoist those
  // items into separate beverage sections. Drop beverage-flavor
  // descriptor "items" (e.g. "Light & Dry") entirely — those are tasting
  // notes captured as item names.
  const beverageBuckets = { sake: null, wine: null, cocktail: null, beer: null };
  const getBucket = (cat) => {
    const title = cat === 'sake' ? 'Sake'
      : cat === 'wine' ? 'Wine'
      : cat === 'cocktail' ? 'Cocktails'
      : 'Beer';
    if (!beverageBuckets[cat]) beverageBuckets[cat] = { title, items: [] };
    return beverageBuckets[cat];
  };

  const recategorized = [];
  for (const sec of cleaned) {
    const sectionCat = categorizeSectionTitle(sec.title);
    const itemCats = sec.items.map((it) => categorizeItem(it.name, it.description));
    dlog('section', JSON.stringify(sec.title), 'cat=', sectionCat, 'itemCats=', itemCats);

    if (sectionCat !== 'food') {
      // Section is already beverage-typed — keep all its items as-is,
      // dropping only obvious tasting-note fragments.
      const kept = sec.items.filter((_, idx) => itemCats[idx] !== 'beverage-flavor');
      if (kept.length >= 2) recategorized.push({ title: sec.title, items: kept });
      continue;
    }

    // Food-titled section. Count beverage items.
    const beverageIdx = itemCats
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c === 'sake' || c === 'wine' || c === 'cocktail' || c === 'beer');
    const flavorIdx = itemCats
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c === 'beverage-flavor');

    if (beverageIdx.length > sec.items.length / 2 && sec.items.length >= 3) {
      // Section is majority-beverage — header was wrong. Move all
      // beverage items into the dominant beverage bucket.
      const dominant = beverageIdx
        .map((x) => x.c)
        .reduce((acc, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {});
      const top = Object.entries(dominant).sort((a, b) => b[1] - a[1])[0][0];
      const bucket = getBucket(top);
      beverageIdx.forEach(({ idx }) => bucket.items.push(sec.items[idx]));
      dlog('section reclassified as beverage', sec.title, '->', top);
      // Any remaining food items? Drop the misnamed section but keep them
      // in a generic Menu bucket so they're not lost.
      const remaining = sec.items.filter((_, idx) =>
        itemCats[idx] === 'food' && !flavorIdx.find((f) => f.idx === idx),
      );
      if (remaining.length >= 2) recategorized.push({ title: 'Menu', items: remaining });
      continue;
    }

    // Minority beverage bleed — hoist those items into the right bucket.
    const keptItems = [];
    sec.items.forEach((it, idx) => {
      const c = itemCats[idx];
      if (c === 'beverage-flavor') {
        dlog('dropped flavor descriptor', it.name);
        return;
      }
      if (c === 'sake' || c === 'wine' || c === 'cocktail' || c === 'beer') {
        getBucket(c).items.push(it);
        dlog('hoisted', it.name, 'from', sec.title, '->', c);
        return;
      }
      keptItems.push(it);
    });
    if (keptItems.length >= 1) recategorized.push({ title: sec.title, items: keptItems });
  }

  // Append populated beverage buckets in a sensible order. We use a
  // threshold of 1 here (not 2) because every item in these buckets was
  // hoisted out of a food section we already trusted — losing it would
  // mean either dropping a real item or leaving it misfiled.
  for (const cat of ['cocktail', 'sake', 'wine', 'beer']) {
    const bucket = beverageBuckets[cat];
    if (bucket && bucket.items.length >= 1) recategorized.push(bucket);
  }

  // Earlier passes (cleaned + category-consistency) already filtered
  // orphans and recovered hoisted items; we deliberately do NOT apply
  // another >=2 filter here, since that would drop legitimate single
  // beverage items that were hoisted out of food sections.
  const totalItems = recategorized.reduce((acc, s) => acc + s.items.length, 0);
  if (totalItems < 3) return null;
  return recategorized;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// ─── Embedded-PDF page signals ─────────────────────────────────────────────
// Heuristic detector for pages whose "menu" is really a PDF behind a viewer
// shell — GoDaddy Website Builder pages, Wix file-viewer embeds, plain
// "Download PDF" links on otherwise-empty pages, etc. When this returns
// true the generic HTML extractors are almost guaranteed to return junk
// (header text, JS strings) — the pipeline should route directly to PDF
// extraction. The signal scoring is intentionally additive so multiple
// weak hints can combine: any single strong hint OR two weak ones gives
// us enough confidence to short-circuit HTML parsing.
const STRONG_PDF_HINT_RE =
  /\b(download\s+(?:the\s+)?(?:full\s+)?menu(?:\s+pdf)?|view\s+(?:our\s+)?menu\s+pdf)\b/i;
const WEAK_PDF_HINT_RE =
  /\bdownload\s+pdf\b|\bloading\s+files\b|\bopen\s+pdf\b|\bview\s+pdf\b|pdfviewer|pdf-viewer/i;
// GoDaddy Website Builder fires tracking on PDF widget clicks via
// data-tccl="ux2.pdf.*" / "ux2.PDF.pdf*" — strong signal that the page is
// a GoDaddy PDF-embed shell.
const GODADDY_PDF_TCCL_RE = /data-tccl=["'][^"']*ux2\.(?:pdf|PDF)[^"']*["']/;

function hasPdfMenuSignal(html) {
  if (typeof html !== 'string' || !html) return false;
  let score = 0;
  if (STRONG_PDF_HINT_RE.test(html)) score += 3;
  if (WEAK_PDF_HINT_RE.test(html)) score += 1;
  if (GODADDY_PDF_TCCL_RE.test(html)) score += 2;
  // <embed src="…pdf"> / <iframe src="…pdf"> / <object data="…pdf"> — the
  // page is *literally* embedding a PDF.
  if (/<(?:embed|iframe|object)\s+[^>]*(?:src|data)\s*=\s*["'][^"']*\.pdf/i.test(html)) score += 3;
  // GoDaddy / Wix host PDFs at img1.wsimg.com/blobby/... – co-occurring
  // with a "menu" word elsewhere on the page is a near-certain match.
  if (/img1\.wsimg\.com[^"'\s]*\.pdf/i.test(html) && /menu/i.test(html)) score += 2;
  return score >= 2;
}

// Quality check on pdf-parse output. Multi-column design PDFs (Adobe
// InDesign exports, the Rebecca's Northville case) drop text in spatial
// scan order rather than reading order, so prices and dish names get
// interleaved with operational text. The text-mode section parser ends
// up producing items whose "name" is a price modifier ("Cheese +.50 /
// Bleu and Feta +"), an operational fragment ("Carry-out orders may be
// charged..."), or a bare number, paired with a random price from the
// next column over. Detect that.
function looksFragmented(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return true;
  const items = sections.flatMap((s) => s.items || []);
  if (items.length === 0) return true;
  let junky = 0;
  for (const it of items) {
    const name = String(it.name || '').trim();
    if (!name) { junky += 1; continue; }
    // Orphaned modifier — ends with "+", "-", or "/".
    if (/[+\-/]$/.test(name)) { junky += 1; continue; }
    // Mid-name modifier punctuation pile.
    if (/[+|]/.test(name) && /\d/.test(name)) { junky += 1; continue; }
    // Operational text leaked in as a dish.
    if (/\b(charged|prices? are subject|service fee|carry-?out|no deduction|gluten-free options|deletions?)\b/i.test(name)) {
      junky += 1; continue;
    }
    // Name is just a number/price.
    if (/^[\d$.\s]+$/.test(name)) { junky += 1; continue; }
    // Single short fragment ("Cheese", "Mushroom") — could be a modifier.
    // Only count when it co-occurs with a "+ price" pattern further along.
    if (name.length <= 6 && /^[A-Z]/.test(name) && !/[a-z]/.test(name.slice(1))) {
      junky += 1; continue;
    }
  }
  const junkyRatio = junky / items.length;
  return junkyRatio >= 0.3 || items.length < 4;
}

/**
 * Top-level: download a PDF and return a MenuMeta or null.
 *
 * Order of attempts (each gated on ANTHROPIC_API_KEY for Vision):
 *   1. Vision PDF extraction when `preferVision` is requested.
 *   2. Text-mode parse via pdf-parse + heuristic sectioning.
 *   3. Vision PDF extraction as a fallback when text mode looks fragmented.
 *
 * `preferVision` is set by the HTML pipeline when the source page had a
 * strong embedded-PDF signal — we know the layout is graphic-design and
 * the text-mode parser is very unlikely to win.
 */
async function extractMenuFromPdfUrl(pdfUrl, opts = {}) {
  const buf = await downloadPdf(pdfUrl);
  if (!buf) {
    console.log('[menuPdf] download failed', pdfUrl);
    return null;
  }

  const visionConfigured = visionWrapper.isConfigured?.() || false;
  const preferVision = !!opts.preferVision && visionConfigured;

  const runVision = async () => {
    if (!visionConfigured || typeof visionWrapper.extractMenuFromPdfBytes !== 'function') {
      return null;
    }
    const result = await visionWrapper.extractMenuFromPdfBytes(buf);
    if (!result || !result.isMenu || !Array.isArray(result.sections) || result.sections.length === 0) {
      return null;
    }
    const items = result.sections.reduce((n, s) => n + (s.items?.length || 0), 0);
    if (items < 3) return null;
    console.log('[menuPdf] vision extraction succeeded', {
      pdfUrl, sections: result.sections.length, items, confidence: result.confidence,
    });
    return { sections: result.sections, rawData: { bytes: buf.length }, source: 'pdf_vision' };
  };

  if (preferVision) {
    const visionResult = await runVision();
    if (visionResult) return visionResult;
    console.log('[menuPdf] vision path returned null, falling back to text', pdfUrl);
  }

  let text = '';
  let pageCount = null;
  let parser;
  try {
    parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    text = result?.text || '';
    pageCount = result?.total ?? (Array.isArray(result?.pages) ? result.pages.length : null);
  } catch (e) {
    console.warn('[menuPdf] parse failed', pdfUrl, e?.message);
    // If text mode crashed but Vision is configured and we haven't tried,
    // fall through to it.
    if (!preferVision) {
      const visionResult = await runVision();
      if (visionResult) return visionResult;
    }
    return null;
  } finally {
    try { await parser?.destroy?.(); } catch { /* noop */ }
  }

  const sections = parsePdfTextToSections(text);
  const textItems = sections ? sections.reduce((n, s) => n + (s.items?.length || 0), 0) : 0;
  console.log('[menuPdf] text-mode parse', {
    pdfUrl, textLength: text.length, pages: pageCount,
    sections: sections?.length || 0, items: textItems,
  });

  // Bad text-mode output → try Vision as a last resort. Only fires when
  // we haven't already tried Vision (preferVision=false) and Vision is
  // configured. This is the safety net for design PDFs whose embed page
  // didn't trip the strong-signal detector.
  if ((!sections || looksFragmented(sections)) && !preferVision) {
    console.log('[menuPdf] text-mode output looks fragmented, trying vision');
    const visionResult = await runVision();
    if (visionResult) return visionResult;
  }

  if (!sections) return null;
  return { sections, rawData: { textLength: text.length, pages: pageCount }, source: 'pdf' };
}

module.exports = {
  detectMenuPdfUrls,
  hasPdfMenuSignal,
  looksFragmented,
  extractMenuFromPdfUrl,
  parsePdfTextToSections, // exported for tests / debugging
};
