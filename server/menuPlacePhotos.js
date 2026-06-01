/**
 * Google Place Photos → Claude Haiku Vision → structured menu.
 *
 *   extractMenuFromPlacePhotos(placeId, opts)
 *     → { sections, source: 'google_photo_ocr', photoRefs } | null
 *
 * Slotted into the menu pipeline AFTER Puppeteer and BEFORE the review-LLM
 * fallback. Targets restaurants whose websites are scrape-resistant
 * (Squarespace, Webflow, image-only menus like Au Cheval) but whose Google
 * Maps listing includes photos uploaded by the owner or by diners — many
 * of which are pictures of the printed menu.
 *
 * Design tradeoffs:
 *   - Synchronous, not queued. Same-request latency = ~3-5s per photo we
 *     OCR, capped to MAX_PHOTOS_PER_REQUEST candidates. Vision cost is
 *     bounded by that cap; production-side a daily budget gate would sit
 *     above this module.
 *   - No separate menu-vs-food classifier. We let the vision call decide
 *     via its `isMenu` field — one API call does OCR + classification +
 *     structuring. Skips photos where confidence is low.
 *   - Downloads photos server-side and passes base64 to Claude. This keeps
 *     the Google Places API key out of Claude's request logs and avoids
 *     the place-photo URL's redirect dance.
 *   - Multi-photo merge: any photo that returns isMenu=true contributes
 *     its sections. We dedupe near-duplicate sections by title; assumes
 *     the OCR output for the same physical menu page from two photos
 *     would yield similar titles.
 */

const axios = require('axios');
const { extractMenuFromPhoto, isConfigured: isVisionConfigured } = require('./menuVision');

const GOOGLE_PLACES_API_KEY = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
const MAX_PHOTOS_PER_REQUEST = 5;
const MIN_CONFIDENCE = 0.4;
const PHOTO_MAX_WIDTH = 1600;
const PHOTO_FETCH_TIMEOUT_MS = 8000;

function isConfigured() {
  return !!GOOGLE_PLACES_API_KEY && isVisionConfigured();
}

/**
 * Fetch photo refs (not images) from Google Places. Cheap call — one
 * Place Details with `fields=photos`.
 */
async function fetchPhotoRefs(placeId) {
  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/place/details/json',
      {
        params: { place_id: placeId, key: GOOGLE_PLACES_API_KEY, fields: 'photos' },
        timeout: 6000,
      },
    );
    if (data?.status !== 'OK') return [];
    const photos = Array.isArray(data?.result?.photos) ? data.result.photos : [];
    return photos
      .filter((p) => p?.photo_reference)
      .slice(0, MAX_PHOTOS_PER_REQUEST)
      .map((p) => ({
        ref: p.photo_reference,
        width: p.width || null,
        height: p.height || null,
        attribution: Array.isArray(p.html_attributions) ? p.html_attributions[0] || null : null,
      }));
  } catch (e) {
    console.warn('[placePhotos] details lookup failed', placeId, e?.message);
    return [];
  }
}

/**
 * Download a Google Place Photo by ref, returning {buffer, mediaType}.
 * Returns null on any failure.
 */
async function downloadPhoto(ref) {
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/place/photo', {
      params: { photo_reference: ref, maxwidth: PHOTO_MAX_WIDTH, key: GOOGLE_PLACES_API_KEY },
      timeout: PHOTO_FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const mediaType = String(res.headers?.['content-type'] || 'image/jpeg').split(';')[0];
    if (!mediaType.startsWith('image/')) return null;
    const buffer = Buffer.from(res.data);
    if (buffer.length < 5000) return null; // implausibly small for a menu photo
    return { buffer, mediaType };
  } catch (e) {
    console.warn('[placePhotos] photo download failed', ref.slice(0, 20), e?.message);
    return null;
  }
}

/** Dedupe sections from multiple OCR passes. Sections with the same title
 *  (case-insensitive, normalized whitespace) are merged: items concatenated,
 *  duplicates within a section dropped by case-insensitive name match. */
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
 * Top-level: given a Google place_id, fetch up to MAX_PHOTOS_PER_REQUEST
 * photos, run each through Claude Haiku vision, merge any that came back
 * as menus, and return a unified menu (or null).
 */
async function extractMenuFromPlacePhotos(placeId, _opts = {}) {
  if (!isConfigured()) return null;
  if (!placeId || typeof placeId !== 'string') return null;

  const refs = await fetchPhotoRefs(placeId);
  if (refs.length === 0) return null;

  const allSections = [];
  const usedRefs = [];

  for (const photo of refs) {
    const downloaded = await downloadPhoto(photo.ref);
    if (!downloaded) continue;

    // menuVision currently accepts a URL or file path. For Google Place
    // Photos we have a buffer — write it to a stable temp path so vision
    // can read it. (Going through a temp file rather than refactoring
    // menuVision to take a buffer keeps the vision module's input shape
    // small and matches how the test harness drives it.)
    const tmpPath = `/tmp/place-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${downloaded.mediaType.split('/')[1] || 'jpg'}`;
    require('fs').writeFileSync(tmpPath, downloaded.buffer);

    let result;
    try {
      result = await extractMenuFromPhoto(tmpPath);
    } finally {
      try { require('fs').unlinkSync(tmpPath); } catch { /* noop */ }
    }

    if (!result || !result.isMenu || result.confidence < MIN_CONFIDENCE) continue;
    if (!Array.isArray(result.sections) || result.sections.length === 0) continue;

    allSections.push(...result.sections);
    usedRefs.push(photo.ref);
  }

  const merged = mergeSections(allSections);
  if (merged.length === 0) return null;

  const totalItems = merged.reduce((n, s) => n + s.items.length, 0);
  if (totalItems < 3) return null;

  console.log('[placePhotos] OCR-extracted menu', {
    placeId, photosTried: refs.length, photosUsed: usedRefs.length,
    sections: merged.length, items: totalItems,
  });

  return {
    sections: merged,
    source: 'google_photo_ocr',
    photoRefs: usedRefs,
  };
}

module.exports = {
  extractMenuFromPlacePhotos,
  isConfigured,
};
