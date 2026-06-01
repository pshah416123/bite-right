#!/usr/bin/env node
/**
 * Smoke test for the Google Place Photos → Claude Vision menu pipeline.
 *
 * Usage:
 *   node server/scripts/testPlacePhotosOcr.js "Au Cheval, Chicago"
 *   node server/scripts/testPlacePhotosOcr.js ChIJ...placeId
 *
 * If the argument starts with "ChIJ" it's treated as a place_id directly.
 * Otherwise it's resolved via Google Places Find Place.
 *
 * Reports: photos discovered, photos used, sections, items, cost guess,
 * latency. Use this to validate the OCR path before relying on it in
 * production.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const axios = require('axios');
const { extractMenuFromPlacePhotos, isConfigured } = require('../menuPlacePhotos');

const KEY = (process.env.GOOGLE_PLACES_API_KEY || '').trim();

async function resolveToPlaceId(arg) {
  if (/^ChIJ/.test(arg)) return arg;
  const { data } = await axios.get(
    'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    { params: { input: arg, inputtype: 'textquery', fields: 'place_id,name', key: KEY } },
  );
  return data?.candidates?.[0]?.place_id || null;
}

async function main() {
  if (!isConfigured()) {
    console.error('Missing GOOGLE_PLACES_API_KEY or ANTHROPIC_API_KEY. Aborting.');
    process.exit(1);
  }
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node server/scripts/testPlacePhotosOcr.js "<restaurant name>" | <place_id>');
    process.exit(1);
  }

  const placeId = await resolveToPlaceId(arg);
  if (!placeId) {
    console.error(`Could not resolve "${arg}" to a place_id`);
    process.exit(1);
  }
  console.log(`Resolved place_id: ${placeId}`);
  console.log('Extracting menu from Google Place Photos…\n');

  const t0 = Date.now();
  const result = await extractMenuFromPlacePhotos(placeId);
  const elapsed = Date.now() - t0;

  if (!result) {
    console.log(`No menu extracted (${elapsed}ms). Photos may not include readable menus.`);
    return;
  }

  const totalItems = result.sections.reduce((n, s) => n + s.items.length, 0);
  console.log('──────── Result ────────');
  console.log(`Source:        ${result.source}`);
  console.log(`Photos used:   ${result.photoRefs.length}`);
  console.log(`Sections:      ${result.sections.length}`);
  console.log(`Items:         ${totalItems}`);
  console.log(`Latency:       ${elapsed}ms`);
  console.log('');
  for (const s of result.sections.slice(0, 8)) {
    console.log(`[${s.title}] (${s.items.length})`);
    for (const it of s.items.slice(0, 4)) {
      const price = it.price ? `  ${it.price}` : '';
      const desc = it.description ? `  — ${it.description.slice(0, 50)}` : '';
      console.log(`  • ${it.name}${price}${desc}`);
    }
  }
}

main().catch((e) => {
  console.error('crashed:', e?.message || e);
  process.exit(1);
});
