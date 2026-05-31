/**
 * Provider-aware menu extraction.
 *
 * Each extractor returns:
 *   { sections: MenuSection[], rawData: any, source: string }
 * or null if the page isn't this provider / the parse failed.
 *
 * MenuSection: { title: string, items: MenuItem[] }
 * MenuItem:    { name, description?, price?, tags?, photoUrl? }
 */

const axios = require('axios');
const { detectMenuPdfUrls, extractMenuFromPdfUrl } = require('./menuPdf');

const SCRAPE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── Provider detection ─────────────────────────────────────────────────────

/**
 * @returns one of: 'toast','popmenu','square','chownow','bentobox','clover',
 *                  'wix','wordpress','generic'
 */
function detectProvider(url, html) {
  const u = (url || '').toLowerCase();
  const h = (html || '').slice(0, 50000); // first 50KB is plenty

  if (u.includes('toasttab.com') || u.includes('toast-menu-host.com')) return 'toast';
  if (u.includes('popmenu.com') || /popmenu_token|window\.PopmenuApi/i.test(h)) return 'popmenu';
  if (u.includes('square.site') || /<meta[^>]+generator[^>]+square/i.test(h)) return 'square';
  if (u.includes('chownow.com') || /chownow_widget|chownow_iframe/i.test(h)) return 'chownow';
  if (u.includes('getbento.com') || /bentobox|bento-cms/i.test(h)) return 'bentobox';
  if (u.includes('clover.com')) return 'clover';
  if (u.includes('wixsite.com') || u.includes('editorx.io')) return 'wix';
  if (/<meta[^>]+generator[^>]+wordpress/i.test(h)) return 'wordpress';

  return 'generic';
}

// ─── Toast (___NEXT_DATA___ JSON) ───────────────────────────────────────────

function parseToastMenu(html) {
  try {
    const m = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!m) return null;
    const data = JSON.parse(m[1]);
    // Toast's menu shape lives under pageProps.menu or pageProps.restaurant.menus
    const pageProps = data?.props?.pageProps ?? {};
    const candidates = [
      pageProps.menu,
      pageProps.menus,
      pageProps.restaurant?.menus,
      pageProps.restaurant?.menu,
      pageProps.initialState?.menus,
    ].filter(Boolean);
    const menusRoot = candidates[0];
    if (!menusRoot) return null;

    // Normalize: Toast nests as menus[] -> groups[] -> items[]
    // (sometimes menuGroups, sometimes groups; absorb either)
    const menus = Array.isArray(menusRoot) ? menusRoot : [menusRoot];
    const sections = [];
    for (const menu of menus) {
      const groups = menu?.groups || menu?.menuGroups || menu?.sections || [];
      for (const g of groups) {
        const items = g?.items || g?.menuItems || [];
        const parsedItems = items
          .map(toastItemToMenuItem)
          .filter((it) => it && it.name);
        if (parsedItems.length === 0) continue;
        sections.push({
          title: g?.name || g?.title || 'Menu',
          items: parsedItems,
        });
      }
    }
    if (sections.length === 0) return null;
    return { sections, rawData: data, source: 'toast' };
  } catch {
    return null;
  }
}

function toastItemToMenuItem(it) {
  if (!it) return null;
  const name = it.name || it.title || it.itemName;
  if (!name) return null;
  // Toast price often comes as cents in `price` or `defaultPrice` or `unitPrice`.
  // Sometimes formatted as a number like 14.5; sometimes as { amount, currency }.
  let priceStr = null;
  const raw = it.price ?? it.defaultPrice ?? it.unitPrice ?? it.priceWithoutTax;
  if (typeof raw === 'number' && raw > 0) {
    priceStr = `$${(raw > 1000 ? raw / 100 : raw).toFixed(2)}`;
  } else if (raw && typeof raw === 'object' && typeof raw.amount === 'number') {
    const amt = raw.amount > 1000 ? raw.amount / 100 : raw.amount;
    priceStr = `$${amt.toFixed(2)}`;
  }
  return {
    name: String(name).trim(),
    description: typeof it.description === 'string' ? it.description.trim() : null,
    price: priceStr,
    tags: null,
    photoUrl: it.imageUrl || it.imageUrls?.[0] || null,
  };
}

// ─── Popmenu (window.PopmenuApi JSON) ───────────────────────────────────────

function parsePopmenuMenu(html) {
  try {
    // Popmenu embeds menu data in several script shapes; try the most stable:
    // a JSON blob assigned to window.menus or window.PopmenuApi.menuData
    let blob = null;

    let m = html.match(/window\.PopmenuApi\.menuData\s*=\s*(\{[\s\S]*?\});/);
    if (m) blob = m[1];

    if (!blob) {
      m = html.match(/<script[^>]+type="application\/json"[^>]+id="data-menu"[^>]*>([\s\S]*?)<\/script>/i);
      if (m) blob = m[1];
    }

    if (!blob) {
      // Some Popmenu sites embed sections via __NEXT_DATA__-style JSON
      m = html.match(/"menuItems":\s*(\[[\s\S]*?\])\s*,/);
      if (m) {
        const items = JSON.parse(m[1]);
        return popmenuFlatItemsToSections(items);
      }
    }

    if (!blob) return null;
    const data = JSON.parse(blob);

    // Popmenu shape: { menu: { sections: [{ name, menuItems: [...] }] } }
    const root = data?.menu || data;
    const sections = (root.sections || []).map((s) => ({
      title: s.name || 'Menu',
      items: (s.menuItems || []).map(popmenuItemToMenuItem).filter((it) => it && it.name),
    })).filter((s) => s.items.length > 0);
    if (sections.length === 0) return null;
    return { sections, rawData: data, source: 'popmenu' };
  } catch {
    return null;
  }
}

function popmenuItemToMenuItem(it) {
  if (!it) return null;
  const name = it.name || it.title;
  if (!name) return null;
  const priceCents = typeof it.priceCents === 'number' ? it.priceCents : null;
  return {
    name: String(name).trim(),
    description: typeof it.description === 'string' ? it.description.trim() : null,
    price: priceCents != null ? `$${(priceCents / 100).toFixed(2)}` : (it.price ? String(it.price) : null),
    tags: null,
    photoUrl: it.photoUrl || it.imageUrl || null,
  };
}

function popmenuFlatItemsToSections(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const byCategory = new Map();
  for (const it of items) {
    const cat = it.categoryName || it.section || 'Menu';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const parsed = popmenuItemToMenuItem(it);
    if (parsed && parsed.name) byCategory.get(cat).push(parsed);
  }
  const sections = Array.from(byCategory.entries())
    .filter(([, arr]) => arr.length > 0)
    .map(([title, arr]) => ({ title, items: arr }));
  if (sections.length === 0) return null;
  return { sections, rawData: items, source: 'popmenu' };
}

// ─── Square / JSON-LD (schema.org Menu) ─────────────────────────────────────

function parseJsonLdMenu(html) {
  try {
    const matches = [...html.matchAll(
      /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    )];
    for (const m of matches) {
      try {
        const obj = JSON.parse(m[1]);
        const candidates = Array.isArray(obj) ? obj : [obj];
        for (const c of candidates) {
          if (!c) continue;
          if (c['@type'] === 'Menu' || c.hasMenuSection) {
            const sections = (c.hasMenuSection || c.menuSection || []).map((s) => ({
              title: s.name || 'Menu',
              items: (s.hasMenuItem || s.menuItem || []).map((it) => ({
                name: String(it.name || '').trim(),
                description: typeof it.description === 'string' ? it.description.trim() : null,
                price: it.offers?.price ? `$${parseFloat(it.offers.price).toFixed(2)}` : null,
                tags: null,
                photoUrl: it.image || null,
              })).filter((it) => it.name),
            })).filter((s) => s.items.length > 0);
            if (sections.length > 0) return { sections, rawData: c, source: 'square' };
          }
        }
      } catch { /* skip bad blob */ }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Quality scoring (0-100) ────────────────────────────────────────────────

const NOT_A_DISH_RE =
  /\b(we are closed|we're closed|kitchen open|kitchen closed|open now|currently open|currently closed|opening hours|hours of operation|order online|delivery|takeout|pickup|reservations?|book a table|call us|contact|follow us|visit us)\b/i;
const MODIFIER_RE = /^(half|no|extra|mild|medium|hot|full|less|more|light|double|triple|add|side of)\s/i;
const MODIFIER_EXACT = new Set([
  'spice', 'no spice', 'half spice', 'full spice', 'extra spice', 'mild', 'medium', 'hot',
  'small', 'regular', 'large', 'extra large', 'gluten free', 'vegetarian', 'vegan',
]);

function scoreMenu(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return { score: 0, reasons: ['no sections'] };
  }
  let score = 0;
  const reasons = [];

  // Flatten items
  const allItems = sections.flatMap((s) => s.items || []);
  const itemCount = allItems.length;

  // 1. Item count
  if (itemCount < 3) {
    return { score: 0, reasons: [`only ${itemCount} items`] };
  } else if (itemCount < 5) {
    score += 5;
    reasons.push('few items (5pts)');
  } else {
    score += 20;
    reasons.push('item count ok (20pts)');
  }

  // 2. Price presence
  const withPrice = allItems.filter((it) => it.price && /\d/.test(it.price)).length;
  const priceRatio = withPrice / itemCount;
  if (priceRatio < 0.3) {
    score += 0;
    reasons.push(`prices missing (${Math.round(priceRatio * 100)}%)`);
  } else {
    score += 20;
    reasons.push(`prices ok (${Math.round(priceRatio * 100)}%)`);
  }

  // 3. Category presence
  if (sections.length === 0) {
    reasons.push('-15 no sections');
  } else if (sections.length === 1) {
    score += 7;
    reasons.push('1 section (7pts)');
  } else {
    score += 15;
    reasons.push(`${sections.length} sections (15pts)`);
  }

  // 4. Average item name length
  const avgLen = allItems.reduce((acc, it) => acc + (it.name?.length ?? 0), 0) / itemCount;
  if (avgLen >= 6 && avgLen <= 50) {
    score += 10;
    reasons.push(`avg name len ok (${avgLen.toFixed(1)})`);
  } else {
    reasons.push(`bad avg name len (${avgLen.toFixed(1)})`);
  }

  // 5. Modifier ratio
  const modifiers = allItems.filter((it) => {
    const lower = (it.name || '').toLowerCase().trim();
    return MODIFIER_EXACT.has(lower) || MODIFIER_RE.test(lower);
  }).length;
  const modRatio = modifiers / itemCount;
  if (modRatio > 0.7) {
    score = Math.max(0, score - 15);
    reasons.push(`mostly modifiers (${Math.round(modRatio * 100)}%)`);
  } else if (modRatio < 0.4) {
    score += 15;
    reasons.push(`modifier ratio ok (${Math.round(modRatio * 100)}%)`);
  }

  // 6. Junk text matches
  const junkHits = allItems.filter((it) => NOT_A_DISH_RE.test((it.name || '').toLowerCase())).length;
  if (junkHits === 0) {
    score += 10;
    reasons.push('no junk text');
  } else {
    score = Math.max(0, score - junkHits * 5);
    reasons.push(`${junkHits} junk hits`);
  }

  // 7. Uniqueness
  const names = allItems.map((it) => (it.name || '').toLowerCase().trim()).filter(Boolean);
  const uniqueRatio = new Set(names).size / Math.max(1, names.length);
  if (uniqueRatio >= 0.8) {
    score += 10;
    reasons.push(`unique (${Math.round(uniqueRatio * 100)}%)`);
  } else {
    score = Math.max(0, score - 5);
    reasons.push(`duplicates (${Math.round((1 - uniqueRatio) * 100)}%)`);
  }

  return { score: Math.min(100, Math.max(0, Math.round(score))), reasons };
}

// ─── Top-level extractor ────────────────────────────────────────────────────
// Fetches the URL, runs provider detection, and returns whatever the
// best-matched parser produces. Returns null if nothing parsed. Caller is
// responsible for falling back to the legacy generic scraper / Puppeteer.
async function extractMenuFromUrl(url) {
  if (!url) return null;
  let html = '';
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: SCRAPE_HEADERS,
      maxRedirects: 5,
      responseType: 'text',
    });
    if (typeof data !== 'string' || data.length < 100) return null;
    html = data;
  } catch {
    return null;
  }

  const provider = detectProvider(url, html);
  if (provider === 'toast') {
    const r = parseToastMenu(html);
    if (r) return r;
  }
  if (provider === 'popmenu') {
    const r = parsePopmenuMenu(html);
    if (r) return r;
  }
  if (provider === 'square') {
    const r = parseJsonLdMenu(html);
    if (r) return r;
  }
  // JSON-LD parser is a useful general fallback for many other sites that
  // happen to publish schema.org markup (BentoBox, some WordPress sites).
  const jsonLd = parseJsonLdMenu(html);
  if (jsonLd) return { ...jsonLd, source: jsonLd.source || provider };

  // PDF pipeline: ~30-40% of independent restaurants link to a PDF menu
  // (especially fine dining + bars). Scan the HTML for ranked PDF
  // candidates and try them in order until one yields a structured menu.
  const pdfCandidates = detectMenuPdfUrls(html, url);
  for (const pdfUrl of pdfCandidates) {
    try {
      const r = await extractMenuFromPdfUrl(pdfUrl);
      if (r) return { ...r, pdfUrl };
    } catch { /* try next */ }
  }

  return null;
}

module.exports = {
  detectProvider,
  parseToastMenu,
  parsePopmenuMenu,
  parseJsonLdMenu,
  scoreMenu,
  extractMenuFromUrl,
};
