#!/usr/bin/env node
/**
 * Backfill server/data/restaurantEnrichment.json with Google place_id for seed restaurants.
 *
 * Requires GOOGLE_PLACES_API_KEY in server/.env (or env).
 *
 * Usage: npm run backfill:places
 *        node server/scripts/backfill-restaurant-places.mjs
 *
 * Preserves internal restaurantId keys; writes { [restaurantId]: { placeId, name?, formattedAddress?, lat?, lng? } }.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(serverRoot, '.env') });

const KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!KEY) {
  console.error('Set GOOGLE_PLACES_API_KEY in server/.env');
  process.exit(1);
}

const seedPath = path.join(serverRoot, 'data', 'seedRestaurantsForEnrichment.json');
const outPath = path.join(serverRoot, 'data', 'restaurantEnrichment.json');

const seeds = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

async function findPlace(input, lat, lng) {
  const url = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
  const params = {
    input,
    inputtype: 'textquery',
    fields: 'place_id,name,geometry,formatted_address',
    key: KEY,
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    params.locationbias = `circle:2000@${lat},${lng}`;
  }
  const { data } = await axios.get(url, { params, timeout: 15000 });
  if (data.status !== 'OK' || !data.candidates?.length) {
    return null;
  }
  const c = data.candidates[0];
  return {
    placeId: c.place_id,
    name: c.name,
    formattedAddress: c.formatted_address,
    lat: c.geometry?.location?.lat,
    lng: c.geometry?.location?.lng,
  };
}

const out = {};
for (const row of seeds) {
  const q = [row.name, row.address || row.neighborhood, row.city, row.state].filter(Boolean).join(' ');
  console.log('Resolving:', row.restaurantId, q);
  try {
    const hit = await findPlace(q, row.lat, row.lng);
    if (hit) {
      out[row.restaurantId] = {
        placeId: hit.placeId,
        googlePlaceId: hit.placeId,
        canonicalName: hit.name,
        canonicalAddress: hit.formattedAddress,
        lat: hit.lat,
        lng: hit.lng,
      };
      console.log('  ->', hit.placeId, hit.name);
    } else {
      console.log('  -> NO MATCH');
    }
  } catch (e) {
    console.error('  -> ERROR', e.message);
  }
  await new Promise((r) => setTimeout(r, 200));
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', outPath, Object.keys(out).length, 'entries');
console.log('Restart the API server to load new place IDs.');
