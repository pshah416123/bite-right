#!/usr/bin/env node
/**
 * Quick one-off debug for any restaurant by name or place_id.
 *
 * Usage:
 *   node server/scripts/debug-restaurant.js "Sushi-san, Chicago"
 *   node server/scripts/debug-restaurant.js ChIJ...
 *
 * Reports: Google Places result (name, types, website, editorial summary)
 * and the full extractMenuFromUrl output (source, sections, items, score).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const axios = require('axios');
const {
  extractMenuFromUrl,
  assignMenuGroups,
  scoreMenu,
  detectProvider,
} = require('../menuExtractors');

const KEY = (process.env.GOOGLE_PLACES_API_KEY || '').trim();

async function resolvePlaceId(arg) {
  if (/^ChIJ/.test(arg)) return arg;
  const { data } = await axios.get(
    'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    { params: { input: arg, inputtype: 'textquery', fields: 'place_id', key: KEY } },
  );
  return data?.candidates?.[0]?.place_id || null;
}

async function main() {
  const arg = process.argv.slice(2).join(' ');
  if (!arg) { console.error('Usage: node debug-restaurant.js "<name>" | <place_id>'); process.exit(1); }
  if (!KEY) { console.error('GOOGLE_PLACES_API_KEY missing'); process.exit(1); }

  const placeId = await resolvePlaceId(arg);
  if (!placeId) { console.error('Could not resolve:', arg); process.exit(1); }
  console.log('place_id:', placeId);

  const { data } = await axios.get(
    'https://maps.googleapis.com/maps/api/place/details/json',
    {
      params: {
        place_id: placeId, key: KEY,
        fields: 'name,website,types,editorial_summary,formatted_address',
      },
    },
  );
  const r = data?.result;
  console.log('name:', r?.name);
  console.log('address:', r?.formatted_address);
  console.log('types:', (r?.types || []).join(', '));
  console.log('website:', r?.website || '-');
  if (r?.editorial_summary?.overview) {
    console.log('editorial:', r.editorial_summary.overview);
  }

  if (!r?.website) { console.log('\n(no website on place; pipeline would fall to photos/LLM)'); return; }

  console.log('\nRunning extractMenuFromUrl...');
  const t0 = Date.now();
  const result = await extractMenuFromUrl(r.website);
  console.log('elapsed:', Date.now() - t0, 'ms');
  if (!result) { console.log('result: null'); return; }
  const tagged = assignMenuGroups(result.sections);
  const totalItems = tagged.reduce((n, s) => n + s.items.length, 0);
  console.log('source:', result.source, '| pdfUrl:', result.pdfUrl || '-');
  console.log('sections:', tagged.length, '| items:', totalItems, '| score:', scoreMenu(tagged).score);
  console.log('');
  for (const s of tagged.slice(0, 10)) {
    console.log('[' + s.title + ']', '(' + s.group + ',', s.items.length + ')');
    for (const it of s.items.slice(0, 3)) {
      console.log('  -', it.name, (it.price || ''));
    }
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
