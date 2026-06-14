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
  // Lettuce Entertain You WordPress theme — used across their restaurant
  // portfolio (Sushi-san, RPM, Beatrix, Stella Barra, etc.) and templated
  // copies on other sites. Server-rendered with item-wrap / item-name /
  // item-price / item-desc / section-name classes.
  if (/lettuce\/css\/menu|class="menu-section\s|class="item-wrap[\s"]/i.test(h)) return 'lettuce';
  // Squarespace Menu Block (data-block-type="18"). Built-in Squarespace
  // feature with stable classes (sqs-block-menu, menu-item, menu-item-title,
  // menu-item-price-top/bottom, menu-section-title). Used by Joto Chicago
  // and many other independent restaurants on Squarespace. Detection
  // checks for the block class + menu-item-title (must have both so we
  // don't false-positive on Squarespace nav menus).
  if (/sqs-block-menu|sqs-block\s+menu-block/i.test(h) && /menu-item-title/i.test(h)) return 'squarespace';
  // "Dine" / "Dine Framework" WordPress theme + similar restaurant themes
  // (Sabroso Chicago, many independent Mexican/Italian/American spots).
  // Stable DOM: <h2 class="dine-menu-heading"> + <div class="dine-menu-item">
  // each containing .menu-item-name / .menu-item-price / .menu-item-desc.
  // Also matches restaurants using the bare WP convention of those inner
  // classes without the dine-* wrappers.
  if (/class="dine-menu(?:-item|-heading|-wrapper)?[\s"]|menu-item-name[\s"][\s\S]{0,2000}menu-item-price/i.test(h)) return 'dine_wp';
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

// ─── Generic Next.js __NEXT_DATA__ menu walker ──────────────────────────────
//
// Many Next.js corporate restaurant sites ship the entire menu hierarchy in
// the __NEXT_DATA__ script tag (no XHR, no location selection). The exact
// keys vary by site (`menuProductCategories`, `categories`, `menuGroups`,
// `productCategories`, `menus[].sections`, etc.) so we don't hardcode names.
//
// Heuristic: walk the parsed JSON looking for any array whose entries are
// objects that BOTH (a) carry a name/title/label and (b) contain a nested
// array of objects that themselves have a name/title. That structural
// signature is what "section[] → item[]" looks like in JSON regardless of
// the property names. Scores candidate arrays by total item count + name
// density and keeps the densest match.
//
// Live-tested on tacobell.com: 17 categories × ~100 products extracted
// directly from the static HTML, no API calls.
function parseNextDataMenu(html) {
  try {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    const data = JSON.parse(m[1]);

    const namingKeys = ['name', 'title', 'label', 'displayName', 'productName'];
    const descKeys = ['description', 'shortDescription', 'subtitle', 'summary', 'desc'];
    const priceKeys = ['price', 'priceCents', 'unitPrice', 'displayPrice', 'amount'];

    const nameOf = (o) => {
      if (!o || typeof o !== 'object') return null;
      for (const k of namingKeys) {
        if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
      }
      return null;
    };
    const descOf = (o) => {
      if (!o || typeof o !== 'object') return null;
      for (const k of descKeys) {
        if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
      }
      return null;
    };
    const priceOf = (o) => {
      if (!o || typeof o !== 'object') return null;
      for (const k of priceKeys) {
        const v = o[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
          // Heuristic: integers > 100 are likely cents.
          const dollars = v > 100 && Number.isInteger(v) ? v / 100 : v;
          if (dollars >= 1 && dollars <= 999) return `$${dollars.toFixed(2)}`;
        }
        if (typeof v === 'string' && /^\$?\d+(?:\.\d{1,2})?$/.test(v.trim())) {
          const num = parseFloat(v.replace('$', ''));
          if (num >= 1 && num <= 999) return `$${num.toFixed(2)}`;
        }
      }
      return null;
    };

    // Find candidate "section arrays" — arrays whose items are objects with
    // a name + a nested item array containing further name-bearing objects.
    const candidates = [];
    const walk = (node, depth = 0) => {
      if (depth > 10 || !node) return;
      if (Array.isArray(node)) {
        // Is this array a list of menu sections?
        if (node.length >= 1 && node.length <= 200 && node.every((x) => x && typeof x === 'object')) {
          const sectionsHere = [];
          for (const entry of node) {
            const sectionName = nameOf(entry);
            if (!sectionName) continue;
            // Look for a nested array of items.
            for (const k of Object.keys(entry)) {
              const v = entry[k];
              if (!Array.isArray(v) || v.length === 0 || v.length > 500) continue;
              const items = [];
              for (const it of v) {
                const itName = nameOf(it);
                if (!itName) continue;
                if (itName.length < 2 || itName.length > 120) continue;
                items.push({
                  name: itName,
                  description: descOf(it),
                  price: priceOf(it),
                  tags: null,
                  photoUrl: null,
                });
              }
              if (items.length >= 2) {
                sectionsHere.push({ title: sectionName, items });
              }
            }
          }
          if (sectionsHere.length >= 2) {
            const totalItems = sectionsHere.reduce((n, s) => n + s.items.length, 0);
            candidates.push({ sections: sectionsHere, totalItems });
          }
        }
        for (const child of node) walk(child, depth + 1);
        return;
      }
      if (typeof node === 'object') {
        for (const k of Object.keys(node)) walk(node[k], depth + 1);
      }
    };
    walk(data);

    if (candidates.length === 0) return null;
    // Pick the densest candidate. Tiebreak by section count.
    candidates.sort((a, b) => b.totalItems - a.totalItems || b.sections.length - a.sections.length);
    const winner = candidates[0];
    if (winner.totalItems < 5) return null;
    return { sections: winner.sections, rawData: null, source: 'next_data' };
  } catch {
    return null;
  }
}

// ─── Generic DOM .item-name / .product-name walker ──────────────────────────
//
// Catches restaurant sites that render the menu server-side but use
// class-keyed elements our specific parsers don't know about. McDonald's
// /us/en-us/full-menu.html for example uses `class="item-name"` with the
// item text as the element's body. Same convention shows up on AEM and
// generic CMS-built restaurant sites.
//
// Algorithm:
//   1. Find every element matching .item-name / .product-name /
//      .menu-item-name / .dish-name (and similar).
//   2. Group items by nearest preceding section heading.
//   3. For each item, look in nearby siblings for a description / price
//      element (class contains "description" / "price").
//   4. Reject if total items < 8 — guards against the parser firing on
//      generic "item" classes used for sidebar widgets, etc.
function parseGenericItemNameMenu(html) {
  try {
    const $ = cheerio.load(html);
    const itemSel = [
      '.item-name', '.product-name', '.menu-item-name', '.dish-name',
      '.item__name', '.product__name', '.menu-item__name',
      '[class*=" item-name"]', '[class$="item-name"]',
      '[class*=" product-name"]', '[class$="product-name"]',
    ].join(', ');
    const $items = $(itemSel);
    if ($items.length < 8) return null;

    const sectionsByTitle = new Map();
    const orderedTitles = [];
    const pushItem = (sectionTitle, item) => {
      const key = sectionTitle || 'Menu';
      if (!sectionsByTitle.has(key)) {
        sectionsByTitle.set(key, []);
        orderedTitles.push(key);
      }
      sectionsByTitle.get(key).push(item);
    };

    const seenNames = new Set();
    $items.each((_, el) => {
      const $el = $(el);
      const name = $el.text().replace(/\s+/g, ' ').trim();
      if (!name || name.length < 2 || name.length > 120) return;
      const nameKey = name.toLowerCase();
      if (seenNames.has(nameKey)) return;
      seenNames.add(nameKey);

      // Look around for description / price siblings — same parent first,
      // then grandparent if needed.
      let description = null;
      let price = null;
      const $card = $el.closest('[class*=card], [class*=tile], [class*=item], [class*=product]');
      const $scope = $card.length ? $card : $el.parent();
      const descCandidate = $scope.find('[class*=description], [class*=desc]').first().text().replace(/\s+/g, ' ').trim();
      if (descCandidate && descCandidate.length >= 4 && descCandidate.length <= 400) {
        description = descCandidate;
      }
      const priceText = $scope.find('[class*=price]').first().text().replace(/\s+/g, ' ').trim();
      if (priceText) {
        const num = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(num) && num >= 1 && num <= 999) {
          price = `$${num.toFixed(2)}`;
        }
      }

      // Find section title — three-pass strategy:
      //   1. Per-item category field (Webflow Collections, Squarespace
      //      summary blocks, BentoBox menus, custom React menus all
      //      attach a category label to each item)
      //   2. Nearest preceding heading by document-order DOM walk
      //   3. Fallback to "Menu"
      //
      // Why three passes: the previous single-pass logic
      // ($el.closest('div').prevAll('h1-h4').first()) misclassified every
      // item on sites where items share a single container (Webflow's
      // Collection List wrapper is the canonical case). Every item's
      // closest div was the SAME wrapper, so every item received the
      // immediately preceding heading — collapsing 50+ menu items into
      // one section named after whatever heading happened to sit just
      // above the wrapper (typically the LAST category on the page).
      // Zarella sent 24 food items to the Dessert tab via this path.
      let title = null;
      let titleSource = null;

      // Pass 1: per-item category field on or near the item.
      const CATEGORY_SELECTORS = [
        '[class*="category-name"]', '[class*="category-title"]',
        '[class*="section-name"]', '[class*="section-title"]',
        '[class*="menu-category"]', '[class*="menu-section"]',
        '[class*="item-category"]', '[class*="product-category"]',
        '[data-category]', '[data-section]',
      ];
      for (const sel of CATEGORY_SELECTORS) {
        const $cat = $scope.find(sel).first();
        if (!$cat.length) continue;
        const dataCat = $cat.attr('data-category') || $cat.attr('data-section');
        const textCat = $cat.text().replace(/\s+/g, ' ').trim();
        const value = (dataCat && dataCat.trim()) || textCat;
        if (value && value.length >= 2 && value.length <= 60 && value.toLowerCase() !== name.toLowerCase()) {
          title = value;
          titleSource = 'per-item-category';
          break;
        }
      }

      // Pass 2: walk back through document-order siblings + ancestor
      // siblings to find the nearest preceding heading. Same algorithm
      // as before but pre-Pass-3 collapse detection below catches the
      // shared-container failure mode.
      if (!title) {
        let $cursor = $el;
        for (let depth = 0; depth < 8; depth++) {
          let $prev = $cursor.prev();
          while ($prev.length) {
            const tag = ($prev.prop('tagName') || '').toLowerCase();
            if (/^h[1-5]$/.test(tag)) {
              const t = $prev.text().replace(/\s+/g, ' ').trim();
              if (t.length >= 2 && t.length <= 60 && t.toLowerCase() !== name.toLowerCase()) {
                title = t;
                titleSource = 'preceding-heading';
                break;
              }
            }
            const $inner = $prev.find('h1, h2, h3, h4, h5').last();
            if ($inner.length) {
              const t = $inner.text().replace(/\s+/g, ' ').trim();
              if (t.length >= 2 && t.length <= 60 && t.toLowerCase() !== name.toLowerCase()) {
                title = t;
                titleSource = 'inner-trailing-heading';
                break;
              }
            }
            $prev = $prev.prev();
          }
          if (title) break;
          $cursor = $cursor.parent();
          if (!$cursor.length || $cursor.is('body, html')) break;
        }
      }

      if (!title) {
        title = 'Menu';
        titleSource = 'default';
      }

      // Per-item debug logging — gated on DEBUG_MENU_EXTRACT so prod
      // logs aren't noisy. Set DEBUG_MENU_EXTRACT=1 on Render when
      // investigating misclassified menus.
      if (process.env.DEBUG_MENU_EXTRACT) {
        console.log('[MenuExtract][item]', JSON.stringify({
          itemName: name,
          sourceTab: null,
          sourceSection: title,
          assignedTab: null,
          assignedSection: title,
          titleSource,
        }));
      }

      pushItem(title, { name, description, price, tags: null, photoUrl: null });
    });

    // ── Shared-container collapse detection ─────────────────────────────
    // If the page has 3+ distinct h1-h4 headings but our per-item walk
    // collapsed every item into a SINGLE section, the per-item category
    // detection failed and the shared-container DOM pattern fooled the
    // preceding-heading walk. In that case the section title is at best
    // a guess and at worst (Zarella → "Dessert") actively misleading.
    // Fall back to a single neutral "Menu" section so downstream
    // assignMenuGroups doesn't route every food item to a dessert tab.
    const pageHeadingCount = $('h1, h2, h3, h4').filter((_, h) => {
      const t = $(h).text().replace(/\s+/g, ' ').trim();
      return t.length >= 2 && t.length <= 60;
    }).length;
    if (orderedTitles.length === 1 && pageHeadingCount >= 3) {
      const onlyTitle = orderedTitles[0];
      const allItems = sectionsByTitle.get(onlyTitle) || [];
      console.log('[MenuExtract] shared-container collapse detected', {
        collapsedTitle: onlyTitle,
        itemCount: allItems.length,
        pageHeadings: pageHeadingCount,
        action: 'reset-to-Menu',
      });
      sectionsByTitle.clear();
      orderedTitles.length = 0;
      sectionsByTitle.set('Menu', allItems);
      orderedTitles.push('Menu');
    }

    const sections = orderedTitles
      .map((title) => ({ title, items: sectionsByTitle.get(title) || [] }))
      .filter((s) => s.items.length > 0);
    const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
    if (totalItems < 8) return null;
    return { sections, rawData: null, source: 'dom_item_name' };
  } catch {
    return null;
  }
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

// ─── Lettuce theme (Lettuce Entertain You + similar WP themes) ─────────────

/**
 * Restaurant pages built on the Lettuce Entertain You WordPress theme
 * (Sushi-san, RPM Italian, RPM Steak, Beatrix, Stella Barra, etc.) and
 * templated copies on other restaurants. Common markup:
 *
 *   <article class="menu-wrap" aria-label="All Day">
 *     <h2>All Day</h2>
 *     <div class="menu-section Specials">
 *       <h3 class="section-name">Specials</h3>
 *       <p class="item-wrap">
 *         <span class="item-name">
 *           King Crab Gunkan Nigiri
 *           <span class="item-desc"> motoyaki sauce</span>  ← nested inside name
 *         </span>
 *         <span class="item-price"><span>2pcs 22</span></span>
 *       </p>
 *     </div>
 *   </article>
 *
 * Quirks:
 *   - item-desc is nested INSIDE item-name, so we have to strip it before
 *     using item-name as the dish name.
 *   - item-price can have multiple <span> children for size variants
 *     ("13 glass" / "32 carafe") — we join them with " / ".
 *   - Prices often omit the "$" prefix (just "22" or "2pcs 22"); the
 *     normalizePrice helper handles the spelling.
 */
function parseLettuceMenu(html) {
  try {
    if (!/class="item-wrap[\s"]|class="menu-section\s/i.test(html)) return null;
    const $ = cheerio.load(html);
    const sections = [];
    $('.menu-section').each((_, el) => {
      const $sec = $(el);
      const title =
        $sec.find('.section-name').first().text().trim() ||
        $sec.find('h3, h2').first().text().trim() ||
        'Menu';
      const items = [];
      $sec.find('.item-wrap').each((_, item) => {
        const $it = $(item);
        // item-desc lives inside item-name; clone, strip children, get text.
        const $name = $it.find('.item-name').first();
        if ($name.length === 0) return;
        const nameOnly = $name.clone().children().remove().end().text().trim();
        if (!nameOnly || nameOnly.length < 2 || nameOnly.length > 100) return;
        const desc = $it.find('.item-desc').first().text().trim();
        // Price spans (could be multiple for size variants).
        const priceParts = [];
        $it.find('.item-price span').each((_, p) => {
          const t = $(p).text().trim();
          if (t) priceParts.push(t);
        });
        const rawPrice = priceParts.length
          ? priceParts.join(' / ')
          : $it.find('.item-price').first().text().trim();
        items.push({
          name: nameOnly,
          description: desc || null,
          price: rawPrice ? normalizePrice(rawPrice) : null,
          tags: null,
          photoUrl: null,
        });
      });
      if (items.length > 0) sections.push({ title, items });
    });
    if (sections.length === 0) return null;
    return { sections, rawData: null, source: 'lettuce' };
  } catch {
    return null;
  }
}

// ─── Squarespace Menu Block (data-block-type="18") ─────────────────────────

/**
 * Squarespace's first-party Menu Block. Used by a huge slice of independent
 * restaurants on Squarespace because it's drag-and-drop and the rendered
 * markup is consistent across every theme:
 *
 *   <div class="sqs-block menu-block sqs-block-menu" data-block-type="18">
 *     <div class="menu-section">
 *       <div class="menu-section-title">SMALL BITES</div>
 *       <div class="menu-items">
 *         <div class="menu-item">
 *           <span class="menu-item-price-top">$8</span>
 *           <div class="menu-item-title">Edamame</div>
 *           <div class="menu-item-description">umami dust</div>
 *           <div class="menu-item-price-bottom">$8</div>   ← duplicate of top
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *
 * Quirks:
 *   - menu-item-price-top and menu-item-price-bottom are duplicates (Squarespace
 *     shows one or the other based on the layout); we take whichever exists,
 *     deduping the value.
 *   - Sections can be split across multiple .menu-section blocks OR rolled
 *     into a single block — handle both.
 *   - When tabbed menus are used (one block, multiple .menu-section children
 *     each in its own tabpanel), the section title also appears as the
 *     tabpanel's aria-label. We use .menu-section-title since it's universal.
 */
function parseSquarespaceMenu(html) {
  try {
    if (!/sqs-block-menu|menu-block\s+sqs-block|menu-item-title/i.test(html)) return null;
    const $ = cheerio.load(html);
    const sections = [];
    $('.menu-section').each((_, sec) => {
      const $sec = $(sec);
      const title = $sec.find('.menu-section-title').first().text().trim() || 'Menu';
      const items = [];
      $sec.find('.menu-item').each((_, item) => {
        const $it = $(item);
        const name = $it.find('.menu-item-title').first().text().trim();
        if (!name || name.length < 2 || name.length > 100) return;
        const desc = $it.find('.menu-item-description').first().text().trim();
        // Squarespace renders price twice (top + bottom variants based on
        // layout style). Collect both, dedup, then join — produces clean
        // output for size-variant menus and a single price string otherwise.
        const priceSeen = new Set();
        const priceParts = [];
        $it.find('.menu-item-price-top, .menu-item-price-bottom').each((_, p) => {
          const t = $(p).text().trim().replace(/\s+/g, ' ');
          if (!t) return;
          const key = t.toLowerCase();
          if (priceSeen.has(key)) return;
          priceSeen.add(key);
          priceParts.push(t);
        });
        const rawPrice = priceParts.join(' / ');
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
    // Fallback: site uses .menu-item without wrapping .menu-section divs.
    // Group everything under a single "Menu" section so the items aren't
    // lost.
    if (sections.length === 0) {
      const items = [];
      $('.menu-item').each((_, item) => {
        const $it = $(item);
        const name = $it.find('.menu-item-title').first().text().trim();
        if (!name || name.length < 2 || name.length > 100) return;
        const desc = $it.find('.menu-item-description').first().text().trim();
        const priceText = $it.find('.menu-item-price-top').first().text().trim()
          || $it.find('.menu-item-price-bottom').first().text().trim();
        items.push({
          name,
          description: desc || null,
          price: priceText ? normalizePrice(priceText) : null,
          tags: null,
          photoUrl: null,
        });
      });
      if (items.length > 0) sections.push({ title: 'Menu', items });
    }
    if (sections.length === 0) return null;
    return { sections, rawData: null, source: 'squarespace' };
  } catch {
    return null;
  }
}

// ─── Squarespace text-block menus (Trivoli pattern) ─────────────────────────
//
// Not every Squarespace restaurant uses the official Menu Block. Many compose
// the menu out of free-form HTML blocks where:
//   <h3><strong>Snacks</strong></h3>     ← section title
//   <h3>Lobster Mac & Cheese</h3>        ← dish name
//   <p>maine lobster, white cheddar sauce, chives 26.99</p>   ← desc + price
//   <h3>New England Style Lobster Roll</h3>
//   <p>...</p>
//   <h3><strong>Starters</strong></h3>   ← next section…
//
// .text() flattens this into a single line per block, so .menu-item-title
// based parsers see nothing. This parser walks the children, treats h3 as
// either a section title (when it contains a <strong>) or a dish name
// (when it doesn't), and pulls the trailing price out of the following <p>.
// Promotional / operational content that the Squarespace text-block parser
// will match on (h1/h2 + p pairs) but which is NOT a menu item. Without
// rejecting these, restaurant homepages with event banners (Cabra Chicago:
// "Sunday Swim is Back!", "Industry Nights!", "Weekend Brunch", etc.) get
// classified as dishes. Match against BOTH the name and description so
// e.g. "Reservations" (name) and "$20 pool pass" (description) both
// trigger the reject.
const PROMO_REJECT_RE = new RegExp(
  [
    // Events / experiences
    'sunday\\s?swim', 'industry\\s?night', 'weekend\\s?brunch', 'brunch\\s?hours',
    'happy\\s?hour', 'grazing\\s?hour', 'lunch\\s?with\\s?us', 'lunch\\s?hours',
    'trivia\\s?night', 'karaoke\\s?night', 'live\\s?music', 'pool\\s?access',
    'pool\\s?pass', 'rooftop',
    // Calls to action / operational
    'book\\s?(your|a)?\\s?(event|table|reservation)', 'join\\s?us',
    'private\\s?event', 'private\\s?dining', 'catering',
    'newsletter', 'sign\\s?up', 'subscribe',
    // Standalone informational
    '\\breservations?\\b', '\\bhours\\s?(of\\s?operation)?\\b',
    'opening\\s?soon', 'gift\\s?card', 'merch(andise)?',
  ].join('|'),
  'i',
);

// Token sets that look like FOOD/DRINK menu content (positive signal).
// Used as a corroborator when an item has no price — a "name" with one of
// these tokens looks plausibly like food.
const FOOD_HINT_RE = /\b(?:chicken|beef|pork|lamb|duck|fish|salmon|tuna|shrimp|crab|lobster|oyster|sushi|tempura|ramen|udon|pasta|pizza|burger|sandwich|salad|soup|bread|cheese|cream|garlic|truffle|vanilla|chocolate|caramel|berry|lemon|lime|miso|soy|teriyaki|tikka|masala|curry|pho|taco|burrito|enchilada|carnitas|guacamole|crudo|ceviche|tartare|carpaccio|risotto|gnocchi|tagliatelle|cocktail|martini|negroni|spritz|aperol|cabernet|chardonnay|pinot|sauvignon|tequila|bourbon|whiskey|mezcal|gin|vodka|amaro|espresso|latte|cappuccino|matcha)\b/i;

function looksPromotional(name, description) {
  const haystack = `${name || ''} ${description || ''}`;
  return PROMO_REJECT_RE.test(haystack);
}

function looksLikeFood(name, description, price) {
  if (price) return true; // having a price is a strong food signal
  return FOOD_HINT_RE.test(`${name || ''} ${description || ''}`);
}

function parseSquarespaceTextMenu(html) {
  try {
    const $ = cheerio.load(html);
    const contentBlocks = $('.sqs-html-content');
    if (contentBlocks.length === 0) return null;

    // Trailing price: 12.99, $12.99, $12, 12.99. Squarespace's rich-text
    // editor sometimes inserts a stray space between the integer and the
    // decimal (e.g. "butter 12 .99" — the .99 is in a child <strong> tag).
    // Normalize that before extraction so we don't read $99 as the price.
    const normalizeStraySpacePrice = (s) => s.replace(/(\d)\s+\.(\d{1,2})\b/g, '$1.$2');
    // Trailing price regex: leading non-word separator, optional $, number.
    // Also handles dotted leaders ("Cynar ........ 14") on spirit lists.
    const PRICE_TAIL_RE = /[\s.•·…\-]+\$?(\d{1,3}(?:\.\d{1,2})?)\s*$/;

    const sections = [];
    let currentTitle = 'Menu';
    let currentItems = [];
    const flush = () => {
      if (currentItems.length > 0) {
        sections.push({ title: currentTitle, items: currentItems });
        currentItems = [];
      }
    };

    const isSectionHeading = ($h) => {
      // A heading with a <strong> child is the convention used for section
      // labels (often paired with a brand color). Single bare h3s are dish
      // names. Also catch all-caps short headings ("SNACKS").
      if ($h.find('strong, b').length > 0) return true;
      const t = $h.text().trim();
      if (!t) return false;
      if (t.length <= 30 && /^[A-Z][A-Z &'/—-]+$/.test(t)) return true;
      return false;
    };

    contentBlocks.each((_, block) => {
      const $block = $(block);
      // Process direct children top-to-bottom. Most menus have h1-h4 + p,
      // but some use <div>s that wrap each item — flatten via .children().
      const children = $block.children();
      // If the block has no headings at all, skip it (it's just prose).
      if (children.filter('h1, h2, h3, h4, h5, h6').length === 0) return;

      let pendingName = null;
      children.each((__, el) => {
        const $el = $(el);
        const tag = (el.tagName || el.name || '').toLowerCase();

        if (/^h[1-6]$/.test(tag)) {
          if (isSectionHeading($el)) {
            flush();
            currentTitle = $el.text().trim() || 'Menu';
            pendingName = null;
            return;
          }
          // Some restaurants pack a whole section into a single heading
          // separated by <br> ("Mushroom Casserole 15.99<br>Steamed Broccoli
          // 15.99<br>…"). Detect that and split per line instead of treating
          // the whole heading as one dish name.
          const innerHtml = $el.html() || '';
          if (/<br\s*\/?>/i.test(innerHtml)) {
            const lines = innerHtml
              .split(/<br\s*\/?>/i)
              .map((chunk) => cheerio.load(`<div>${chunk}</div>`)('div').text().replace(/\s+/g, ' ').trim())
              .filter(Boolean);
            for (const lineRaw of lines) {
              const line = normalizeStraySpacePrice(lineRaw);
              const m = line.match(PRICE_TAIL_RE);
              if (m) {
                const num = parseFloat(m[1]);
                if (!Number.isFinite(num) || num < 1 || num > 999) continue;
                const name = line.slice(0, m.index).replace(/[\s.•·…\-]+$/, '').trim();
                const priceStr = `$${num.toFixed(2)}`;
                if (name.length >= 2 && name.length <= 120 && !looksPromotional(name, null)) {
                  currentItems.push({ name, description: null, price: priceStr, tags: null, photoUrl: null });
                }
              } else if (line.length >= 2 && line.length <= 120 && !looksPromotional(line, null) && looksLikeFood(line, null, null)) {
                currentItems.push({ name: line, description: null, price: null, tags: null, photoUrl: null });
              }
            }
            pendingName = null;
            return;
          }
          // Plain heading — treat as a dish name waiting for the next <p>.
          if (pendingName) {
            currentItems.push({ name: pendingName, description: null, price: null, tags: null, photoUrl: null });
          }
          pendingName = $el.text().replace(/\s+/g, ' ').trim();
          return;
        }
        if (tag === 'p' || tag === 'div') {
          if (!pendingName) return;
          const rawText = normalizeStraySpacePrice(
            $el.text().replace(/\s+/g, ' ').trim(),
          );
          if (!rawText) return;
          const priceMatch = rawText.match(PRICE_TAIL_RE);
          let description = rawText;
          let price = null;
          if (priceMatch) {
            const num = parseFloat(priceMatch[1]);
            if (Number.isFinite(num) && num >= 1 && num <= 999) {
              price = `$${num.toFixed(2)}`;
              description = rawText.slice(0, priceMatch.index).replace(/[\s.•·…\-]+$/, '').trim();
            }
          }
          if (
            pendingName.length >= 2 &&
            pendingName.length <= 120 &&
            !looksPromotional(pendingName, description) &&
            (price || looksLikeFood(pendingName, description, price))
          ) {
            currentItems.push({
              name: pendingName,
              description: description || null,
              price,
              tags: null,
              photoUrl: null,
            });
          }
          pendingName = null;
        }
      });
      // Trailing name without a <p>. Only commit if it has a food token —
      // a bare heading with no description is almost never a menu item.
      if (pendingName && !looksPromotional(pendingName, null) && looksLikeFood(pendingName, null, null)) {
        currentItems.push({ name: pendingName, description: null, price: null, tags: null, photoUrl: null });
      }
      pendingName = null;
    });
    flush();

    // Reject the parse if it found < 3 items overall — likely a false
    // positive on a non-menu page that happens to have h3/p pairs.
    const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
    if (totalItems < 3) return null;

    return { sections, rawData: null, source: 'squarespace' };
  } catch {
    return null;
  }
}

// ─── Dine / WP restaurant theme ────────────────────────────────────────────
//
// Many WordPress restaurant themes (Dine Framework being the canonical one,
// also clones / forks) render the menu as:
//
//   <h2 class="dine-menu-heading">Section Name</h2>
//   <div class="dine-menu">
//     <div class="dine-menu-item">
//       <h3 class="menu-item-name">Dish Name</h3>
//       <span class="menu-item-price">$10.50</span>
//       <div class="menu-item-desc">Description...</div>
//     </div>
//     ...
//   </div>
//
// The inner classes (.menu-item-name / -price / -desc) are also used by
// other WP restaurant themes without the dine-* wrappers, so we accept
// either: explicit dine-menu-item containers, or bare .menu-item-name
// siblings within a parent.
function parseDineWpMenu(html) {
  try {
    const $ = cheerio.load(html);

    // Strategy A: explicit .dine-menu-item containers with surrounding
    // .dine-menu-heading siblings as section titles.
    const sectionsA = [];
    // Walk top-down so we can attach items to the most recent heading.
    let currentTitle = 'Menu';
    let currentItems = [];
    const flush = () => {
      if (currentItems.length > 0) {
        sectionsA.push({ title: currentTitle || 'Menu', items: currentItems });
        currentItems = [];
      }
    };
    $('.dine-menu-heading, .dine-menu-item').each((_, el) => {
      const $el = $(el);
      if ($el.hasClass('dine-menu-heading')) {
        flush();
        currentTitle = $el.text().trim() || 'Menu';
        return;
      }
      // .dine-menu-item
      const name = $el.find('.menu-item-name').first().text().trim();
      if (!name || name.length < 2 || name.length > 120) return;
      const desc = $el.find('.menu-item-desc, .menu-item-description').first().text().trim();
      const priceText = $el.find('.menu-item-price').first().text().trim();
      currentItems.push({
        name,
        description: desc || null,
        price: priceText ? normalizePrice(priceText) : null,
        tags: null,
        photoUrl: null,
      });
    });
    flush();
    if (sectionsA.length > 0 && sectionsA.some((s) => s.items.length > 0)) {
      return { sections: sectionsA.filter((s) => s.items.length > 0), rawData: null, source: 'dine_wp' };
    }

    // Strategy B: bare .menu-item-name / .menu-item-price pattern, no
    // dine-* wrappers. Group items by nearest preceding heading
    // (<h2>/<h3>/<h4>) so different section names survive.
    const items = [];
    $('.menu-item-name').each((_, name) => {
      const $name = $(name);
      const text = $name.text().trim();
      if (!text || text.length < 2 || text.length > 120) return;
      // Sibling structure: <h3 class="menu-item-name"> then
      // <span class="menu-item-price"> then <div class="menu-item-desc">
      let priceText = '';
      let desc = '';
      const $price = $name.nextAll('.menu-item-price').first();
      if ($price.length) priceText = $price.text().trim();
      const $desc = $name.nextAll('.menu-item-desc, .menu-item-description').first();
      if ($desc.length) desc = $desc.text().trim();
      // Find the nearest preceding heading element for section grouping.
      let title = 'Menu';
      const $parent = $name.parent();
      const $heading = $parent.prevAll('h1, h2, h3, h4, h5, h6').first();
      if ($heading.length) title = $heading.text().trim() || 'Menu';
      else {
        // Try a heading inside the same wrapper, or upstream of the wrapper.
        const $up = $name.closest('section, article, div').prevAll('h1, h2, h3, h4, h5, h6').first();
        if ($up.length) title = $up.text().trim() || 'Menu';
      }
      items.push({
        title,
        item: {
          name: text,
          description: desc || null,
          price: priceText ? normalizePrice(priceText) : null,
          tags: null,
          photoUrl: null,
        },
      });
    });
    if (items.length > 0) {
      const byTitle = new Map();
      for (const { title, item } of items) {
        if (!byTitle.has(title)) byTitle.set(title, []);
        byTitle.get(title).push(item);
      }
      const sectionsB = Array.from(byTitle.entries()).map(([title, its]) => ({ title, items: its }));
      return { sections: sectionsB, rawData: null, source: 'dine_wp' };
    }
    return null;
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
  // Generic-drinks catch-all. Intentionally last among the beverage groups so
  // sections titled bare "Drinks" / "Beverages" / "Refreshments" don't pull
  // wine/beer/cocktail/coffee/na items out of their more specific tabs. This
  // is the IMLI-style menu where the section header is just "DRINKS" and the
  // items mix alcoholic (Michelada, Mimosa) with non-alcoholic (Horchata,
  // espresso) — there's no single specific tab they all belong in.
  ['drinks', /^(?:drinks?|beverages?|refreshments?|libations?)\s*(?:menu|list)?\s*$/i],
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
  // Classification trace — single log line per request showing which
  // extraction strategy fired. Useful for coverage analysis (`grep
  // "[BiteRight] menu: strategy="` in Render logs).
  const trace = (strategy, items) => {
    console.log('[BiteRight] menu: strategy=' + strategy + ' items=' + items + ' url=' + (url || '?'));
  };

  if (provider === 'toast') {
    const r = parseToastMenu(html);
    if (r) { trace('toast', r.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return r; }
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
  if (provider === 'lettuce') {
    const r = parseLettuceMenu(html);
    if (r) return r;
  }
  if (provider === 'squarespace') {
    const r = parseSquarespaceMenu(html);
    if (r) return r;
    // Trivoli Tavern et al. — Squarespace site using free-form
    // <h3>/<p> blocks instead of the Menu Block. Try the text-pattern
    // parser before falling through.
    const textR = parseSquarespaceTextMenu(html);
    if (textR) return textR;
  }
  if (provider === 'dine_wp') {
    const r = parseDineWpMenu(html);
    if (r) return r;
  }
  if (provider === 'wix') {
    const r = parseWixMenu(html);
    if (r) return r;
  }

  // Cross-platform fallbacks — many sites embed third-party patterns on
  // top of their own template (e.g. WordPress with embedded BentoBox).
  // Try GENERIC SPA strategies (Next.js __NEXT_DATA__, JSON-LD, class-keyed
  // DOM) FIRST — they're cheap and catch a whole class of corporate sites
  // (Taco Bell-style Next.js, McDonald's-style AEM, Square-style JSON-LD)
  // without needing per-restaurant logic.
  const nextData = parseNextDataMenu(html);
  if (nextData) {
    const n = nextData.sections.reduce((acc, s) => acc + s.items.length, 0);
    trace('next_data', n);
    return nextData;
  }
  const jsonLd = parseJsonLdMenu(html);
  if (jsonLd) {
    const n = (jsonLd.sections || []).reduce((acc, s) => acc + s.items.length, 0);
    trace('json_ld', n);
    return { ...jsonLd, source: jsonLd.source || 'json_ld' };
  }
  const domItems = parseGenericItemNameMenu(html);
  if (domItems) {
    const n = domItems.sections.reduce((acc, s) => acc + s.items.length, 0);
    trace('dom_item_name', n);
    return domItems;
  }
  const crossCN = await parseChowNowMenu(html, url);
  if (crossCN) { trace('chownow', crossCN.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return crossCN; }
  const crossBB = parseBentoBoxMenu(html);
  if (crossBB) { trace('bentobox', crossBB.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return crossBB; }
  const crossSA = parseSpotAppsMenu(html);
  if (crossSA) { trace('spotapps', crossSA.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return crossSA; }
  const crossLE = parseLettuceMenu(html);
  if (crossLE) { trace('lettuce', crossLE.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return crossLE; }
  const crossSQ = parseSquarespaceMenu(html);
  if (crossSQ) { trace('squarespace', crossSQ.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return crossSQ; }
  const crossSQT = parseSquarespaceTextMenu(html);
  if (crossSQT) { trace('squarespace_text', crossSQT.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return crossSQT; }
  const crossDW = parseDineWpMenu(html);
  if (crossDW) { trace('dine_wp', crossDW.sections?.reduce((n, s) => n + s.items.length, 0) || 0); return crossDW; }

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
  parseLettuceMenu,
  parseSquarespaceMenu,
  parseWixMenu,
  scoreMenu,
  extractMenuFromUrl,
  classifyMenuGroup,
  assignMenuGroups,
  discoverMenuLinks,
  extractMenuFromHtml,
};
