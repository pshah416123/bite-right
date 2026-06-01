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
const cheerio = require('cheerio');
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
  // SpotApps (spotapps.co) — small CMS popular with independent restaurants
  // (Indian, Thai, neighborhood spots). Server-rendered menu with stable
  // class names (food-item-holder / food-item-title / food-price).
  if (u.includes('spotapps.co') || /spotapps\.co|spot_id|food-item-holder/i.test(h)) return 'spotapps';
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

// ─── ChowNow (widget config / iframe) ───────────────────────────────────────

/**
 * ChowNow embeds via either:
 *   a) widget script that initializes from window.chownow_widget = {...}
 *   b) iframe to order.chownow.com/restaurant/<slug>
 *
 * For (a), the config blob carries the restaurant slug, which we use to fetch
 * the canonical menu page from order.chownow.com.
 * For (b), we follow the iframe src and parse the order page.
 *
 * The order page itself embeds menu data in a Next.js __NEXT_DATA__ blob,
 * with shape:
 *   pageProps.menu.categories[].items[]
 */
async function parseChowNowMenu(html, baseUrl) {
  try {
    // Find iframe or widget config
    let orderUrl = null;
    const iframeRe = /<iframe[^>]+src\s*=\s*["']([^"']*chownow\.com[^"']*)["']/i;
    const im = html.match(iframeRe);
    if (im) orderUrl = im[1];

    if (!orderUrl) {
      const widgetRe = /chownow_widget\s*=\s*\{[^}]*?["']restaurant_slug["']\s*:\s*["']([^"']+)["']/;
      const wm = html.match(widgetRe);
      if (wm) orderUrl = `https://order.chownow.com/restaurant/${wm[1]}`;
    }
    if (!orderUrl) return null;
    const absoluteOrderUrl = absoluteUrl(orderUrl, baseUrl) || orderUrl;

    const { data: orderHtml } = await axios.get(absoluteOrderUrl, {
      timeout: 10000,
      headers: SCRAPE_HEADERS,
      maxRedirects: 5,
      responseType: 'text',
    });
    if (typeof orderHtml !== 'string') return null;

    // Parse __NEXT_DATA__ on the order page
    const m = orderHtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const menuRoot = data?.props?.pageProps?.menu || data?.props?.pageProps?.restaurantMenu;
    if (!menuRoot) return null;
    const categories = menuRoot.categories || menuRoot.menuCategories || [];
    const sections = categories.map((c) => ({
      title: c.name || 'Menu',
      items: (c.items || c.menuItems || []).map(chowNowItemToMenuItem).filter((it) => it && it.name),
    })).filter((s) => s.items.length > 0);
    if (sections.length === 0) return null;
    return { sections, rawData: data, source: 'chownow' };
  } catch {
    return null;
  }
}

function chowNowItemToMenuItem(it) {
  if (!it) return null;
  const name = it.name || it.title;
  if (!name) return null;
  let priceStr = null;
  const raw = it.price ?? it.basePrice ?? it.amount;
  if (typeof raw === 'number' && raw > 0) {
    priceStr = `$${(raw > 1000 ? raw / 100 : raw).toFixed(2)}`;
  } else if (typeof raw === 'string' && /\d/.test(raw)) {
    priceStr = raw.startsWith('$') ? raw : `$${raw}`;
  }
  return {
    name: String(name).trim(),
    description: typeof it.description === 'string' ? it.description.trim() : null,
    price: priceStr,
    tags: null,
    photoUrl: it.imageUrl || it.image_url || null,
  };
}

// ─── SpotApps ───────────────────────────────────────────────────────────────

/**
 * SpotApps (spotapps.co) renders restaurant menus server-side with a stable
 * class structure used across the many independent restaurants on the platform:
 *
 *   <section>
 *     <div class="food-menu-grid-item-content">
 *       <h2>Section Name</h2>
 *       <div class="food-menu-content">
 *         <div class="food-item-holder">
 *           <div class="food-item-title"><h3>Dish</h3></div>
 *           <div class="food-price">$12.00</div>
 *           <div class="food-item-description">…</div>
 *         </div>
 *         …
 *       </div>
 *     </div>
 *   </section>
 *
 * We use cheerio here (vs. the regex approach in parseBentoBoxMenu) because
 * the nested structure with multiple food-menu-content blocks per section
 * makes regex-with-backreferences hairy. cheerio is already a dep.
 */
function parseSpotAppsMenu(html) {
  try {
    if (!/spotapps|spot_id|food-item-holder/i.test(html)) return null;
    const $ = cheerio.load(html);
    const sections = [];
    $('.food-menu-grid-item-content').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2').first().text().trim() || 'Menu';
      const items = [];
      $el.find('.food-item-holder').each((_, item) => {
        const $it = $(item);
        const name = $it.find('.food-item-title').first().text().trim();
        if (!name || name.length < 2 || name.length > 80) return;
        const rawPrice = $it.find('.food-price').first().text().trim();
        const desc = $it.find('.food-item-description').first().text().trim();
        items.push({
          name,
          description: desc || null,
          price: rawPrice ? normalizePrice(rawPrice) : null,
          tags: null,
          photoUrl: null,
        });
      });
      if (items.length > 0) sections.push({ title, items });
    });
    if (sections.length === 0) return null;
    return { sections, rawData: null, source: 'spotapps' };
  } catch {
    return null;
  }
}

// ─── BentoBox ───────────────────────────────────────────────────────────────

/**
 * BentoBox uses two patterns:
 *   a) menu sections rendered as DOM with `.menu-section` / `.menu-item` classes
 *   b) menus as linked PDFs (handled by PDF pipeline)
 *
 * The DOM pattern is consistent across BentoBox sites — pull section
 * titles and item name/price/description from predictable selectors.
 */
function parseBentoBoxMenu(html) {
  try {
    // Quick check: is this actually BentoBox?
    if (!/bentobox|bento-cms|getbento\.com/i.test(html)) return null;

    // BentoBox menus are server-rendered. Use regex over HTML rather than
    // pulling in cheerio for one parser — selectors are simple.
    //
    // Class matching is whole-token (negative lookahead `(?![-_a-z0-9])`) so
    // `menu-section` doesn't also catch BEM children like `menu-section__header`
    // (which would create phantom sections), and `menu-item` doesn't catch
    // `menu-item__heading` (which fragmented each dish into a "name-only" half
    // and lost the description + price paragraphs).
    //
    // Item lookahead intentionally does NOT include `</div>`: BentoBox wraps
    // the dish name in an inner `<div class="menu-item__heading">`, and stopping
    // at its `</div>` would cut the capture short of the desc/price paragraphs.
    const sectionBlocks = [...html.matchAll(
      /<(?:div|section)[^>]+class="[^"]*\bmenu-section(?![-_a-z0-9])[^"]*"[^>]*>([\s\S]*?)(?=<(?:div|section)[^>]+class="[^"]*\bmenu-section(?![-_a-z0-9])|<\/main|<\/body|$)/gi,
    )];
    if (sectionBlocks.length === 0) return null;

    const sections = [];
    for (const block of sectionBlocks) {
      const inner = block[1];
      const titleMatch = inner.match(/<(?:h[1-4])[^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const title = (titleMatch ? stripHtml(titleMatch[1]) : 'Menu').trim() || 'Menu';

      const itemBlocks = [...inner.matchAll(
        /<(?:div|li)[^>]+class="[^"]*\bmenu-item(?![-_a-z0-9])[^"]*"[^>]*>([\s\S]*?)(?=<(?:div|li)[^>]+class="[^"]*\bmenu-item(?![-_a-z0-9])|<\/(?:ul|ol|section|main|body)\s*>)/gi,
      )];
      const items = [];
      for (const ib of itemBlocks) {
        const itemInner = ib[1];
        // Each regex captures the opening tag name (group 1) and uses a
        // backreference to close on the matching tag. Previously we used
        // /<\/\w+>/ which stopped at the FIRST close tag — so a price like
        // `<p><strong>$12</strong></p>` matched up to `</strong>` and the
        // captured group was empty. BentoBox themes (and other CMS themes)
        // routinely wrap prices in <strong> / <span> / etc.
        //
        // The name regex also accepts <p>, which the Sensei theme uses for
        // the menu-item__heading--name element.
        const nameMatch = itemInner.match(/<(h[1-6]|p|span|div|a)\b[^>]*class="[^"]*(?:menu-item-name|menu-item__heading--name|item-title|name)[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
        if (!nameMatch) continue;
        const name = stripHtml(nameMatch[2]).trim();
        if (!name || name.length < 2 || name.length > 80) continue;
        const priceMatch = itemInner.match(/<([a-z][a-z0-9]*)\b[^>]*class="[^"]*(?:menu-item-price|menu-item__details--price|price)[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
        const descMatch = itemInner.match(/<([a-z][a-z0-9]*)\b[^>]*class="[^"]*(?:menu-item-description|menu-item__details--description|description|item-description)[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
        items.push({
          name,
          description: descMatch ? stripHtml(descMatch[2]).trim() || null : null,
          price: priceMatch ? normalizePrice(stripHtml(priceMatch[2])) : null,
          tags: null,
          photoUrl: null,
        });
      }
      if (items.length > 0) sections.push({ title, items });
    }
    if (sections.length === 0) return null;
    return { sections, rawData: null, source: 'bentobox' };
  } catch {
    return null;
  }
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePrice(s) {
  const m = String(s || '').match(/\$?\s*(\d{1,4}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 500) return null;
  return `$${n.toFixed(2)}`;
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

// ─── Wix Restaurants ────────────────────────────────────────────────────────

/**
 * Wix Restaurants embeds menu data in a JSON blob via their app component.
 * The blob lives in a script tag with id matching `wix-warmup-data` or
 * inside `window.__WIX_WARMUP_DATA__`. Structure varies but typically:
 *   appsWarmupData.<menuAppId>.<key>.menus[].sections[].items[]
 *
 * Best-effort: walk the JSON to find any object that looks like a menu tree.
 */
function parseWixMenu(html) {
  try {
    const m =
      html.match(/<script id="wix-warmup-data"[^>]*>([\s\S]*?)<\/script>/i) ||
      html.match(/window\.__WIX_WARMUP_DATA__\s*=\s*(\{[\s\S]*?\});/);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const sections = findWixMenuSections(data);
    if (!sections || sections.length === 0) return null;
    return { sections, rawData: data, source: 'wix' };
  } catch {
    return null;
  }
}

function findWixMenuSections(node, depth = 0) {
  if (!node || depth > 6) return null;
  // Match: { sections: [{ name, items: [...] }] } or { menus: [{ sections: [...] }] }
  if (Array.isArray(node?.sections) && node.sections.some((s) => s?.items?.length)) {
    return wixSectionsToMenu(node.sections);
  }
  if (Array.isArray(node?.menus)) {
    for (const m of node.menus) {
      const r = findWixMenuSections(m, depth + 1);
      if (r) return r;
    }
  }
  if (typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const r = findWixMenuSections(node[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function wixSectionsToMenu(rawSections) {
  return rawSections
    .map((s) => ({
      title: s.name || s.title || 'Menu',
      items: (s.items || []).map((it) => ({
        name: String(it.name || it.title || '').trim(),
        description: typeof it.description === 'string' ? it.description.trim() : null,
        price: typeof it.price === 'number'
          ? `$${(it.price > 1000 ? it.price / 100 : it.price).toFixed(2)}`
          : (typeof it.price === 'string' && /\d/.test(it.price) ? normalizePrice(it.price) : null),
        tags: null,
        photoUrl: it.imageUrl || it.image || null,
      })).filter((it) => it.name),
    }))
    .filter((s) => s.items.length > 0);
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

// ─── Menu-group classification ──────────────────────────────────────────────
// Multi-menu restaurants (lunch + dinner + brunch + drinks on one page) tend
// to dump every section into one flat list. Tagging each section with its
// category lets the client render tabs (Food / Cocktails / Wine / Beer / ...)
// instead of forcing the user to scroll past 50 wine entries to find a burger.
//
// Phase 1: keyword classification on the section title only. We intentionally
// don't try to split food into lunch vs. dinner here — that requires either
// explicit page structure or strong duplicate-section heuristics, and most
// of the UX win is just separating drinks/dessert from food anyway.

const GROUP_PATTERNS = [
  // Order matters: more specific patterns first. Wine is intentionally above
  // dessert so "Dessert Wines" routes to wine (the more useful classification
  // for someone browsing wine). Meal-time keywords (brunch/breakfast/lunch/
  // dinner) are intentionally above drinks so "Brunch Cocktails" routes to
  // brunch.
  ['brunch', /\bbrunch\b/i],
  ['breakfast', /\bbreakfast\b/i],
  ['lunch', /\blunch\b/i],
  ['dinner', /\bdinner\b|\bsupper\b/i],
  ['wine', /\b(wine|champagne|sparkling|prosecco|ros[eé]|chardonnay|sauvignon|pinot|cabernet|merlot|riesling|gamay|sangiovese|nebbiolo|tempranillo|chianti|port|barbera|syrah|chenin|gew[uü]rztraminer|burgund(?:y|ian)|bordeaux|barolo|rioja)\b/i],
  ['beer', /\b(beer|draft|ipa|ale|lager|stout|pilsner|porter|cider|brews?|on\s+tap)\b/i],
  ['cocktails', /\b(cocktail|spirit|liquor|amaro|amaretto|whisk(?:e)?y|gin|vodka|tequila|mezcal|rum|martini|negroni|bourbon|scotch|digestif|aperitif|cordial|old\s+fashioned|manhattan|highball|sour|spritz|punch)\b/i],
  ['na', /\b(non[- ]alcoholic|mocktail|no\s+booze|soft\s+drink|juice|soda|lemonade|kombucha)\b/i],
  ['coffee', /\b(coffee|espresso|cappuccino|latte|americano|macchiato|chai|tea(?:s)?)\b/i],
  ['dessert', /\b(dessert|sweet(?:s)?|gelato|sorbet|ice\s?cream|pastr(?:y|ies)|cake|tart|pavlova|cheesecake|french\s+toast|monkey\s+bread|beignet|donut|doughnut|cookies?|crepe(?:s)?)\b/i],
];

/**
 * Classify a section title into a menu group. Returns null when the title
 * gives no clear signal — caller should default to 'food' or apply smoothing.
 */
function classifyMenuGroup(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  for (const [group, re] of GROUP_PATTERNS) {
    if (re.test(t)) return group;
  }
  return null;
}

/**
 * Tag each section with a `group` field, smoothing isolated unknowns into
 * their neighbors' group when both neighbors agree. Defaults remaining
 * unknowns to 'food'. Idempotent — sections that already have a group are
 * preserved.
 */
const MEAL_GROUPS = new Set(['breakfast', 'lunch', 'dinner', 'brunch']);

function assignMenuGroups(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return sections || [];

  // Pass 1: classify (preserve any pre-assigned group).
  const groups = sections.map((s) => {
    if (s && typeof s.group === 'string' && s.group.trim()) return s.group;
    return classifyMenuGroup(s?.title);
  });

  // Pass 2: meal-time forward propagation. SinglePlatform / Toast / many
  // BentoBox menus structure meals as headers followed by sub-sections that
  // don't include the meal name in their title ("Breakfast" → "Omelets" →
  // "Toast" → "Lunch" → "Sandwiches"). Once a meal header appears, propagate
  // it forward to unclassified sections until the next meal header. Drinks
  // (wine/beer/cocktails) and dessert keep their own classification —
  // propagation only fills in null/unmatched slots.
  let currentMeal = null;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] && MEAL_GROUPS.has(groups[i])) {
      currentMeal = groups[i];
    } else if (!groups[i] && currentMeal) {
      groups[i] = currentMeal;
    }
  }

  // Pass 3: smooth. An unknown section sandwiched between two same-category
  // neighbors inherits that category. Handles e.g. "Celebrating Women's
  // History Month" appearing between two cocktail sections — it's almost
  // certainly cocktails too.
  for (let i = 0; i < groups.length; i++) {
    if (groups[i]) continue;
    let prev = null;
    for (let j = i - 1; j >= 0; j--) if (groups[j]) { prev = groups[j]; break; }
    let next = null;
    for (let j = i + 1; j < groups.length; j++) if (groups[j]) { next = groups[j]; break; }
    if (prev && prev === next) groups[i] = prev;
  }

  // Pass 4: default unknowns to 'food'.
  return sections.map((s, i) => ({ ...s, group: groups[i] || 'food' }));
}

// ─── Top-level extractor ────────────────────────────────────────────────────
// Fetches the URL, runs provider detection, and returns whatever the
// best-matched parser produces. Returns null if nothing parsed. Caller is
// responsible for falling back to the legacy generic scraper / Puppeteer.

/**
 * Find menu-like anchors on a page so we can follow them when direct
 * extraction returns nothing. We were blindly probing `/menu` and `/menus`
 * before, which missed sites that put menus at `/chicago/menus`,
 * `/menus-1`, `/menu/south-loop`, or any other non-default path. Scoring
 * prefers same-host links with strong "menu" signal in either anchor text
 * or href; deprioritizes catering / nutrition / careers PDFs and external
 * social/order/booking sites that aren't worth scraping.
 *
 * Returns up to 5 absolute URLs, highest-score first.
 */
function discoverMenuLinks(html, baseUrl) {
  if (typeof html !== 'string' || !html) return [];
  let baseHost = '';
  try { baseHost = new URL(baseUrl).host.toLowerCase(); } catch { return []; }

  const candidates = new Map(); // absUrl -> {score, anchorText}
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

    let abs;
    try { abs = new URL(href, baseUrl).href; } catch { continue; }
    if (abs === baseUrl) continue;                          // don't loop on self
    if (/\.(pdf|png|jpe?g|gif|webp|svg|mp4|mov|webm)(\?|$)/i.test(abs)) continue; // PDFs go through the PDF pipeline
    let host;
    try { host = new URL(abs).host.toLowerCase(); } catch { continue; }

    const anchorText = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const path = (new URL(abs).pathname + new URL(abs).search).toLowerCase();
    const sameHost = host === baseHost;
    const score = scoreMenuLink(path, anchorText, sameHost, host);
    if (score <= 0) continue;
    const prev = candidates.get(abs);
    if (!prev || score > prev.score) candidates.set(abs, { score, anchorText });
  }
  return [...candidates.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .map(([url]) => url);
}

function scoreMenuLink(path, text, sameHost, host) {
  let score = 0;

  // Path signals — match menu words as path segments, not substrings, to
  // avoid /elements/elementary or /document-management hits.
  if (/(?:^|\/)menus?(?:\/|$)/.test(path)) score += 50;
  if (/(?:^|\/)food(?:\/|$)/.test(path)) score += 30;
  if (/(?:^|\/)(dinner|lunch|brunch|breakfast)(?:\/|$|-menu)/.test(path)) score += 35;
  if (/(?:^|\/)(drinks|cocktails|wine|beer|bar)(?:\/|$|-menu|-list)/.test(path)) score += 15;
  if (/(?:^|\/)(eat|dine|dining)(?:\/|$)/.test(path)) score += 15;

  // Anchor-text signals
  if (/\bmenus?\b/.test(text)) score += 25;
  if (/\bview menu\b|\bsee menu\b|\bfull menu\b|\border menu\b/.test(text)) score += 20;
  if (/\b(dinner|lunch|brunch)\s+menu\b/.test(text)) score += 25;

  // Negative signals — paths we don't want to follow
  if (/(?:^|\/)(careers|jobs|press|events|gift-?cards?|catering|merchandise|merch|shop|store|gallery|about|contact|location|hours|reservation|reserve|book|order-online|delivery|takeout|privacy|terms|legal|sitemap)(?:\/|$)/.test(path)) score -= 50;
  if (/(?:facebook|instagram|twitter|tiktok|youtube|yelp|opentable|resy|tock|grubhub|doordash|ubereats|seamless|toasttab|chownow|popmenu|squareup)\.(com|app|net|io)/.test(host)) score -= 50;

  // External (different-host) links are less trusted unless they look like
  // dedicated order/menu platforms hosted by the restaurant's vendor (e.g.
  // oneoffhospitality.orderexperience.net). Cap their boost.
  if (!sameHost) {
    score -= 15;
    if (/orderexperience|menustar|singleplatform|tripleseat|tableneeds/.test(host)) score += 25;
  }

  return score;
}

/**
 * Run all provider parsers + fallbacks against already-fetched HTML.
 * Exposed so callers (e.g. the test harness or a Puppeteer-based renderer)
 * can reuse the same chain on pre-rendered markup without re-fetching.
 *
 * Does NOT follow links — that's the caller's responsibility. The
 * link-following loop in extractMenuFromUrl is what owns recursion + the
 * shared `visited` set.
 */
async function extractMenuFromHtml(html, url) {
  if (typeof html !== 'string' || html.length < 100) return null;

  const provider = detectProvider(url || '', html);
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
  if (provider === 'chownow') {
    const r = await parseChowNowMenu(html, url);
    if (r) return r;
  }
  if (provider === 'bentobox') {
    const r = parseBentoBoxMenu(html);
    if (r) return r;
  }
  if (provider === 'spotapps') {
    const r = parseSpotAppsMenu(html);
    if (r) return r;
  }
  if (provider === 'wix') {
    const r = parseWixMenu(html);
    if (r) return r;
  }

  // Cross-platform fallbacks — many sites embed third-party patterns on
  // top of their own template (e.g. WordPress with embedded BentoBox).
  const crossCN = await parseChowNowMenu(html, url);
  if (crossCN) return crossCN;
  const crossBB = parseBentoBoxMenu(html);
  if (crossBB) return crossBB;
  const crossSA = parseSpotAppsMenu(html);
  if (crossSA) return crossSA;
  const jsonLd = parseJsonLdMenu(html);
  if (jsonLd) return { ...jsonLd, source: jsonLd.source || provider };

  // PDF pipeline: scan for ranked PDF candidates linked from the page.
  const pdfCandidates = detectMenuPdfUrls(html, url);
  for (const pdfUrl of pdfCandidates) {
    try {
      const r = await extractMenuFromPdfUrl(pdfUrl);
      if (r) return { ...r, pdfUrl };
    } catch { /* try next */ }
  }

  return null;
}

async function extractMenuFromUrl(url, opts = {}) {
  // Recursion guard. We follow at most 2 levels deep (homepage → menu
  // index → individual menu page) and never revisit a URL we've already
  // tried in this resolve.
  const depth = typeof opts.depth === 'number' ? opts.depth : 0;
  const visited = opts.visited instanceof Set ? opts.visited : new Set();
  const MAX_DEPTH = 2;

  if (!url || visited.has(url)) return null;
  visited.add(url);

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

  const direct = await extractMenuFromHtml(html, url);
  if (direct) return direct;

  // Link discovery + recursion. The page we landed on may not be the menu
  // itself — it might be a homepage or a hub page. Look for menu-like
  // anchors and try the best candidates. Bounded by MAX_DEPTH and the
  // shared `visited` set so we never revisit the same URL.
  if (depth < MAX_DEPTH) {
    const linkCandidates = discoverMenuLinks(html, url);
    for (const candidateUrl of linkCandidates) {
      if (visited.has(candidateUrl)) continue;
      const r = await extractMenuFromUrl(candidateUrl, { depth: depth + 1, visited });
      if (r) return r;
    }
  }

  return null;
}

module.exports = {
  detectProvider,
  parseToastMenu,
  parsePopmenuMenu,
  parseJsonLdMenu,
  parseChowNowMenu,
  parseBentoBoxMenu,
  parseSpotAppsMenu,
  parseWixMenu,
  scoreMenu,
  extractMenuFromUrl,
  classifyMenuGroup,
  assignMenuGroups,
  discoverMenuLinks,
  extractMenuFromHtml,
};
