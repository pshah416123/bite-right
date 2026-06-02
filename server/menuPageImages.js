/**
 * Page-image menu OCR — extractMenuFromPageImages(html, baseUrl)
 *
 *   → { sections, source: 'page_image_ocr' } | null
 *
 * Many Squarespace / Wix / Webflow restaurant sites publish their menu as
 * uploaded screenshots embedded on the /menu page rather than as structured
 * DOM or a PDF (Birdman Ramen, Au Cheval, many independent spots). The DOM
 * parsers + PDF pipeline don't see anything they can extract. This module
 * is the fallback: pull image URLs off the page, rank them by "looks like
 * a menu screenshot", download the top few, and run them through the same
 * Claude Haiku Vision wrapper we already use for Google Place Photos.
 *
 * Slotted into the menu endpoint AFTER Puppeteer and BEFORE the Google
 * Place Photos OCR fallback — page images are a stronger signal than
 * Google's user-uploaded set because the restaurant uploaded them
 * deliberately as the menu.
 *
 * Cost: capped at MAX_IMAGES_PER_REQUEST Vision calls per restaurant.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { extractMenuFromPhoto, isConfigured: isVisionConfigured } = require('./menuVision');

const MAX_IMAGES_PER_REQUEST = 4;
const MIN_CONFIDENCE = 0.4;
const IMAGE_FETCH_TIMEOUT_MS = 8000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Filename patterns we should always skip — favicons, logos, branding,
// social icons. These rule out tiny header/footer assets.
const SKIP_PATTERNS = /(favicon|logo|brand|mark|crest|social|icon|avatar|profile|sprite|emoji|loading|spinner|placeholder|hero[-_]?bg|background)/i;
// Filename hints that strongly suggest a menu image. Used to RANK
// candidates — anything matching here gets pulled to the front of the
// queue so we spend the OCR budget on the most likely hits.
const MENU_HINTS = /(menu|screenshot|food.menu|drinks?.menu|cocktails?|wine|dinner|lunch|brunch|breakfast)/i;

function isConfigured() {
  return isVisionConfigured();
}

/**
 * Pull candidate image URLs out of a page. Looks at <img src>, <img data-src>,
 * <source srcset>, and a few other lazy-load conventions Squarespace uses.
 * Returns absolute URLs, deduped.
 */
function collectImageUrls(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const urls = [];

  const push = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    let u = raw.trim();
    if (!u) return;
    // srcset entries are "url 1x, url 2x" — take the first part.
    if (u.includes(',')) u = u.split(',')[0].trim();
    if (u.includes(' ')) u = u.split(' ')[0].trim();
    // Resolve relative to the page URL.
    try {
      u = new URL(u, baseUrl).toString();
    } catch {
      return;
    }
    // Only http(s) image-ish URLs.
    if (!/^https?:\/\//i.test(u)) return;
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(u) && !/squarespace-cdn|wixstatic|images\.unsplash|cloudinary/i.test(u)) return;
    if (SKIP_PATTERNS.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  $('img').each((_, el) => {
    const $el = $(el);
    push($el.attr('src'));
    push($el.attr('data-src'));
    push($el.attr('data-image'));
    push($el.attr('data-lazy-src'));
    push($el.attr('data-original'));
    const srcset = $el.attr('srcset') || $el.attr('data-srcset');
    if (srcset) push(srcset);
  });
  $('source').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) push(srcset);
  });

  return urls;
}

/**
 * Rank candidates: menu-hint filenames first, then everything else.
 * Stable within each bucket so document order is preserved (matches how
 * the restaurant arranged them).
 */
function rankCandidates(urls) {
  const hinted = [];
  const rest = [];
  for (const u of urls) {
    if (MENU_HINTS.test(u)) hinted.push(u);
    else rest.push(u);
  }
  return [...hinted, ...rest];
}

async function downloadImage(url) {
  try {
    const res = await axios.get(url, {
      timeout: IMAGE_FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: IMAGE_MAX_BYTES,
      maxBodyLength: IMAGE_MAX_BYTES,
      headers: FETCH_HEADERS,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(res.data);
    // Skip tiny images — they're almost certainly icons we missed in the
    // filename filter. 8KB is roughly the upper bound for icon-sized PNGs.
    if (buf.length < 8 * 1024) return null;
    return { buffer: buf, mediaType: contentType.split(';')[0].trim() };
  } catch {
    return null;
  }
}

function mergeSections(allSections) {
  const byTitle = new Map();
  for (const s of allSections) {
    const key = (s.title || 'Menu').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!byTitle.has(key)) {
      byTitle.set(key, { title: s.title || 'Menu', items: [], seenNames: new Set() });
    }
    const bucket = byTitle.get(key);
    for (const it of s.items || []) {
      const nameKey = (it.name || '').toLowerCase().trim();
      if (!nameKey || bucket.seenNames.has(nameKey)) continue;
      bucket.seenNames.add(nameKey);
      bucket.items.push(it);
    }
  }
  return Array.from(byTitle.values())
    .map(({ title, items }) => ({ title, items }))
    .filter((s) => s.items.length > 0);
}

/**
 * Top-level: scan a page for menu-image candidates, OCR up to
 * MAX_IMAGES_PER_REQUEST of them, merge sections, return null if nothing
 * resembling a menu came back.
 */
async function extractMenuFromPageImages(html, baseUrl) {
  if (!isConfigured()) return null;
  if (typeof html !== 'string' || html.length < 100) return null;

  const all = collectImageUrls(html, baseUrl);
  if (all.length === 0) return null;
  const ranked = rankCandidates(all).slice(0, MAX_IMAGES_PER_REQUEST);

  const allSections = [];
  let usedUrls = [];

  for (const url of ranked) {
    const downloaded = await downloadImage(url);
    if (!downloaded) continue;

    // menuVision wants a path or URL — write to a temp path. (Same pattern
    // as menuPlacePhotos.)
    const ext = (downloaded.mediaType.split('/')[1] || 'jpg').split('+')[0];
    const tmpPath = path.join('/tmp', `page-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
    try {
      fs.writeFileSync(tmpPath, downloaded.buffer);
    } catch {
      continue;
    }

    let result;
    try {
      result = await extractMenuFromPhoto(tmpPath);
    } catch (e) {
      console.warn('[pageImages] vision threw', url, e?.message);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* noop */ }
    }

    if (!result || !result.isMenu || result.confidence < MIN_CONFIDENCE) continue;
    if (!Array.isArray(result.sections) || result.sections.length === 0) continue;

    allSections.push(...result.sections);
    usedUrls.push(url);
  }

  const merged = mergeSections(allSections);
  if (merged.length === 0) return null;
  const totalItems = merged.reduce((n, s) => n + s.items.length, 0);
  if (totalItems < 3) return null;

  console.log('[pageImages] OCR-extracted menu', {
    baseUrl, tried: ranked.length, used: usedUrls.length,
    sections: merged.length, items: totalItems,
  });

  return {
    sections: merged,
    source: 'page_image_ocr',
    imageUrls: usedUrls,
  };
}

module.exports = {
  extractMenuFromPageImages,
  isConfigured,
};
