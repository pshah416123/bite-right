const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
/** Public base URL for absolute image URLs in API responses (no trailing slash). */
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

if (!GOOGLE_PLACES_API_KEY) {
  console.warn(
    '[BiteRight backend] GOOGLE_PLACES_API_KEY is not set. Autocomplete and photo fallback will not work until you add it to server/.env',
  );
}

app.use(cors());
app.use(express.json());

// Neutral placeholder when no restaurant photo is available (used only as last resort).
const NEUTRAL_PLACEHOLDER_URL = 'https://placehold.co/800x600/e5e7eb/6b7280?text=No+photo';

// In‑memory storage (swap with a real DB later)
/** @type {Array<{
 *  restaurantId: string;
 *  placeId: string;
 *  name: string;
 *  address: string;
 *  lat: number;
 *  lng: number;
 *  websiteUrl?: string;
 *  googleMapsUrl?: string;
 *  phone?: string;
 *  reservationUrl?: string;
 *  fallbackPhotoRef?: string;
 *  fallbackPhotoUrl?: string;
 *  bestFoodPhotoRef?: string;
 *  bestFoodPhotoUrl?: string;
 *  bestFoodPhotoUpdatedAt?: string;
 *  createdAt: string;
 * }>} */
const restaurants = [];

/** @type {Array<{
 *  id: string;
 *  restaurantId: string;
 *  rating: number;
 *  notes?: string;
 *  photos?: string[];
 *  previewPhotoUrl?: string;
 *  createdAt: string;
 * }>} */
const logs = [];

/** SavedRestaurant: one per (userId, restaurantId). source: TONIGHT | DISCOVER | FEED | MANUAL */
/** @type {Array<{ id: string; userId: string; restaurantId: string; savedAt: string; source: string; note?: string; snapshot?: { name?: string; previewPhotoUrl?: string | null; address?: string | null; city?: string | null; neighborhood?: string | null; lat?: number | null; lng?: number | null; cuisines?: string[] } }>} */
const savedRestaurants = [];

/** Negative feedback on recommendations: hide / suggest_less. */
/** @type {Array<{ id: string; userId: string; restaurantId: string; actionType: 'hide'|'suggest_less'; createdAt: string; relatedFeatures?: { cuisine?: string; neighborhood?: string; priceLevel?: number } }>} */
const negativeFeedback = [];

/** Static restaurant info for rest_1..rest_5 (Chicago). Google-selected places are in `restaurants`. */
const STATIC_RESTAURANTS = {
  // Use real food imagery for static restaurants so Discover/Tonight cards never appear blank.
  // Pizza-specific photo (avoid mismatched cuisine imagery in Feed/Discover).
  rest_1: { name: "Lou Malnati's", address: 'River North, IL', city: 'Chicago', neighborhood: 'River North', lat: 41.8902, lng: -87.6369, websiteUrl: 'https://www.loumalnatis.com', phone: '+1-312-828-9800' },
  rest_2: { name: 'Girl & the Goat', address: 'West Loop, IL', city: 'Chicago', neighborhood: 'West Loop', lat: 41.8815, lng: -87.6472, websiteUrl: 'https://www.girlandthegoat.com', googleMapsUrl: 'https://maps.google.com/?cid=123' },
  rest_3: { name: "Portillo's", address: 'River North, IL', city: 'Chicago', neighborhood: 'River North', lat: 41.8902, lng: -87.6369, websiteUrl: 'https://www.portillos.com' },
  rest_4: { name: 'The Purple Pig', address: 'Magnificent Mile, IL', city: 'Chicago', neighborhood: 'Magnificent Mile', lat: 41.8904, lng: -87.6242, websiteUrl: 'https://www.thepurplepigchicago.com' },
  rest_5: { name: 'Au Cheval', address: 'West Loop, IL', city: 'Chicago', neighborhood: 'West Loop', lat: 41.8815, lng: -87.6472, websiteUrl: 'https://www.aucheval.com' },
};

function getRestaurantInfo(restaurantId) {
  // rest_1..rest_5 are always the static Chicago list (Lou Malnati's, etc.). Prefer static over DB so Reserve/labels stay correct.
  const stat = STATIC_RESTAURANTS[restaurantId];
  if (stat) {
    const dbRow = findRestaurantById(restaurantId);
    return {
      restaurantId,
      ...stat,
      placeId: dbRow?.placeId ?? null,
      websiteUrl: stat.websiteUrl || null,
      googleMapsUrl: stat.googleMapsUrl || null,
      phone: stat.phone || null,
      reservationUrl: stat.reservationUrl || stat.websiteUrl || null,
    };
  }
  let fromDb = findRestaurantById(restaurantId);
  if (!fromDb && restaurantId && String(restaurantId).startsWith('ChIJ')) {
    fromDb = findRestaurantByPlaceId(restaurantId);
  }
  if (fromDb) {
    return {
      restaurantId: fromDb.restaurantId,
      placeId: fromDb.placeId || null,
      name: fromDb.name,
      address: fromDb.address || '',
      city: fromDb.city || 'Chicago',
      neighborhood: fromDb.neighborhood || null,
      lat: fromDb.lat ?? 41.88,
      lng: fromDb.lng ?? -87.63,
      previewPhotoUrl: fromDb.bestFoodPhotoUrl || fromDb.fallbackPhotoUrl || null,
      websiteUrl: fromDb.websiteUrl || null,
      googleMapsUrl: fromDb.googleMapsUrl || null,
      phone: fromDb.phone || null,
      reservationUrl: fromDb.reservationUrl || fromDb.websiteUrl || null,
    };
  }
  return null;
}

function findRestaurantByPlaceId(placeId) {
  return restaurants.find((r) => r.placeId === placeId);
}

function findRestaurantById(id) {
  return restaurants.find((r) => r.restaurantId === id);
}

const fs = require('fs');
const path = require('path');
const {
  googleFindPlaceFromText,
  buildEnrichmentQuery,
  logRestaurantImageResolution,
} = require('./restaurantEnrichment');

let loadedRestaurantEnrichment = {};
try {
  loadedRestaurantEnrichment = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'restaurantEnrichment.json'), 'utf8'),
  );
} catch (_e) {
  /* optional file */
}

function seedStaticRestaurantsIntoDb() {
  for (const restaurantId of Object.keys(STATIC_RESTAURANTS)) {
    if (findRestaurantById(restaurantId)) continue;
    const stat = STATIC_RESTAURANTS[restaurantId];
    const enc = loadedRestaurantEnrichment[restaurantId] || {};
    const placeId = enc.placeId || enc.googlePlaceId || null;
    restaurants.push({
      restaurantId,
      placeId,
      name: stat.name,
      address: stat.address || '',
      city: stat.city || 'Chicago',
      neighborhood: stat.neighborhood || null,
      lat: stat.lat,
      lng: stat.lng,
      websiteUrl: stat.websiteUrl,
      googleMapsUrl: stat.googleMapsUrl,
      phone: stat.phone,
      reservationUrl: stat.reservationUrl || stat.websiteUrl,
      createdAt: new Date().toISOString(),
    });
  }
}

seedStaticRestaurantsIntoDb();

/** Skip repeated Find Place calls for ids that already failed. */
const lazyEnrichFailedIds = new Set();

// --- Google Places helpers ---------------------------------------------------

async function googlePlacesAutocomplete(query) {
  if (!GOOGLE_PLACES_API_KEY) return [];

  const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  const params = {
    input: query,
    key: GOOGLE_PLACES_API_KEY,
    types: 'establishment',
    location: '37.7749,-122.4194',
    radius: 50000,
  };

  let data;
  try {
    const res = await axios.get(url, { params });
    data = res.data;
  } catch (err) {
    console.error('[BiteRight] Google Autocomplete network error:', err.message);
    return [];
  }

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn('[BiteRight] Google Autocomplete status:', data.status, data.error_message || '');
    if (data.status === 'REQUEST_DENIED') {
      console.warn(
        '[BiteRight] Fix: 1) Enable "Places API" in Google Cloud Console. 2) Key must allow SERVER use (restriction "None" or "IP addresses"), not only iOS/HTTP.',
      );
    }
    return [];
  }

  const predictions = data.predictions || [];
  if (predictions.length === 0) {
    console.log('[BiteRight] Google returned status=%s with 0 predictions. Try a different query (e.g. "pizza" or a real restaurant name).', data.status);
  }
  return predictions;
}

async function googlePlaceDetails(placeId) {
  if (!GOOGLE_PLACES_API_KEY) return null;

  const url = 'https://maps.googleapis.com/maps/api/place/details/json';
  const params = {
    place_id: placeId,
    key: GOOGLE_PLACES_API_KEY,
    fields: 'name,formatted_address,geometry,photos,website,url,international_phone_number',
  };

  const { data } = await axios.get(url, { params });
  if (data.status !== 'OK') {
    return null;
  }
  return data.result;
}

async function googlePlacesNearbyRestaurants(lat, lng, radiusMeters, keyword) {
  if (!GOOGLE_PLACES_API_KEY) return [];
  const url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
  const params = {
    location: `${lat},${lng}`,
    radius: Math.max(500, Math.min(50000, Math.round(radiusMeters))),
    type: 'restaurant',
    key: GOOGLE_PLACES_API_KEY,
  };
  const kw = typeof keyword === 'string' && keyword.trim() ? keyword.trim() : '';
  if (kw) params.keyword = kw;
  const { data } = await axios.get(url, { params });
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn('[BiteRight] Nearby search status:', data.status, data.error_message || '');
    return [];
  }
  const list = Array.isArray(data.results) ? data.results : [];
  return list.map((r) => ({
    placeId: r.place_id,
    name: r.name || '',
    address: r.vicinity || r.formatted_address || '',
    lat: r.geometry?.location?.lat ?? null,
    lng: r.geometry?.location?.lng ?? null,
    rating: typeof r.rating === 'number' ? r.rating : null,
    priceLevel: typeof r.price_level === 'number' ? r.price_level : null,
    types: Array.isArray(r.types) ? r.types : [],
    photoRef: r.photos?.[0]?.photo_reference || null,
  }));
}

const FOOD_TYPE_ALLOWLIST = new Set([
  'restaurant',
  'meal_takeaway',
  'meal_delivery',
  'cafe',
  'bakery',
  'food',
  'bar',
  'coffee_shop',
  'ice_cream_shop',
]);

const FOOD_TYPE_BLOCKLIST = new Set([
  'lodging',
  'night_club',
  'tourist_attraction',
  'shopping_mall',
  'clothing_store',
  'department_store',
  'gym',
  'museum',
  'park',
  'beauty_salon',
  'spa',
  'car_dealer',
  'hospital',
  'school',
  'bank',
]);

function isFoodPlace(types) {
  const t = Array.isArray(types) ? types : [];
  if (!t.length) return false;
  if (t.some((x) => FOOD_TYPE_BLOCKLIST.has(x))) return false;
  return t.some((x) => FOOD_TYPE_ALLOWLIST.has(x));
}

const CUISINE_TYPE_MAP = [
  { key: 'italian_restaurant', label: 'Italian' },
  { key: 'mexican_restaurant', label: 'Mexican' },
  { key: 'chinese_restaurant', label: 'Chinese' },
  { key: 'indian_restaurant', label: 'Indian' },
  { key: 'thai_restaurant', label: 'Thai' },
  { key: 'japanese_restaurant', label: 'Japanese' },
  { key: 'korean_restaurant', label: 'Korean' },
  { key: 'mediterranean_restaurant', label: 'Mediterranean' },
  { key: 'american_restaurant', label: 'American' },
  { key: 'seafood_restaurant', label: 'Seafood' },
  { key: 'steak_house', label: 'American' },
  { key: 'barbecue_restaurant', label: 'BBQ' },
  { key: 'pizza_restaurant', label: 'Pizza' },
  { key: 'hamburger_restaurant', label: 'Burgers' },
  { key: 'sushi_restaurant', label: 'Sushi' },
  { key: 'vegan_restaurant', label: 'Vegan' },
  { key: 'vegetarian_restaurant', label: 'Vegetarian' },
  { key: 'breakfast_restaurant', label: 'Brunch' },
  { key: 'brunch_restaurant', label: 'Brunch' },
  { key: 'cafe', label: 'Coffee' },
  { key: 'coffee_shop', label: 'Coffee' },
  { key: 'bakery', label: 'Bakery' },
  { key: 'ice_cream_shop', label: 'Dessert' },
  { key: 'dessert_shop', label: 'Dessert' },
];

const CUISINE_NAME_KEYWORDS = [
  { re: /\bitalian|pasta|trattoria\b/i, label: 'Italian' },
  { re: /\bmexican|taco|taqueria|burrito\b/i, label: 'Mexican' },
  { re: /\bchinese|dim\s*sum|szechuan|sichuan\b/i, label: 'Chinese' },
  { re: /\bindian|curry\b/i, label: 'Indian' },
  { re: /\bthai\b/i, label: 'Thai' },
  { re: /\bjapanese|ramen|izakaya\b/i, label: 'Japanese' },
  { re: /\bkorean|kimchi|korean bbq\b/i, label: 'Korean' },
  { re: /\bmediterranean|greek|falafel\b/i, label: 'Mediterranean' },
  { re: /\bpizza|pizzeria\b/i, label: 'Pizza' },
  { re: /\bburger|hamburger\b/i, label: 'Burgers' },
  { re: /\bsushi|omakase\b/i, label: 'Sushi' },
  { re: /\bvegan\b/i, label: 'Vegan' },
  { re: /\bvegetarian\b/i, label: 'Vegetarian' },
  { re: /\bbrunch|breakfast\b/i, label: 'Brunch' },
  { re: /\bseafood|oyster|fish\b/i, label: 'Seafood' },
  { re: /\bbbq|barbecue|smokehouse\b/i, label: 'BBQ' },
  { re: /\bbakery|boulangerie\b/i, label: 'Bakery' },
  { re: /\bdessert|gelato|ice cream|boba|tea|juice\b/i, label: 'Dessert' },
  { re: /\bcafe|coffee|espresso\b/i, label: 'Coffee' },
];

function mapFoodCategory(types, name) {
  const t = Array.isArray(types) ? types : [];
  const tSet = new Set(t);

  // 1) Prefer cuisine-specific Google types when available.
  for (const entry of CUISINE_TYPE_MAP) {
    if (tSet.has(entry.key)) return entry.label;
  }

  // 2) Then infer from place name keywords.
  const n = typeof name === 'string' ? name : '';
  for (const entry of CUISINE_NAME_KEYWORDS) {
    if (entry.re.test(n)) return entry.label;
  }

  // 3) Fallback to generic food categories only if no cuisine match exists.
  if (tSet.has('bakery')) return 'Bakery';
  if (tSet.has('cafe') || tSet.has('coffee_shop')) return 'Coffee';
  if (tSet.has('ice_cream_shop') || tSet.has('dessert_shop')) return 'Dessert';
  if (tSet.has('meal_takeaway') || tSet.has('meal_delivery')) return 'Takeout';
  if (tSet.has('restaurant') || tSet.has('food')) return 'Restaurant';
  return '';
}

/** All cuisine-like labels we can attach to a place (for filtering + cards). */
function deriveCuisinesFromPlace(types, name, cuisineHint) {
  const labels = new Set();
  const t = Array.isArray(types) ? types : [];
  const tSet = new Set(t);
  const n = `${typeof name === 'string' ? name : ''} ${typeof cuisineHint === 'string' ? cuisineHint : ''}`;

  for (const entry of CUISINE_TYPE_MAP) {
    if (tSet.has(entry.key)) labels.add(entry.label);
  }
  for (const entry of CUISINE_NAME_KEYWORDS) {
    if (entry.re.test(n)) labels.add(entry.label);
  }
  const mapped = mapFoodCategory(types, name);
  if (mapped && mapped !== 'Restaurant' && mapped !== 'Takeout') labels.add(mapped);

  if (labels.has('Bakery')) labels.add('Dessert');

  return Array.from(labels);
}

/** Maps Discover cuisine chip labels to Google Nearby Search keyword hints. */
function cuisineChipToNearbyKeyword(chip) {
  const c = (chip || '').trim();
  const table = {
    Italian: 'italian',
    Mexican: 'mexican',
    Chinese: 'chinese',
    Indian: 'indian',
    Thai: 'thai',
    Japanese: 'japanese',
    Korean: 'korean',
    Mediterranean: 'mediterranean',
    American: 'american',
    Pizza: 'pizza',
    Burgers: 'burger',
    Sushi: 'sushi',
    Bakery: 'bakery',
    Dessert: 'dessert',
    Coffee: 'coffee',
    Vegetarian: 'vegetarian',
    Vegan: 'vegan',
    Brunch: 'brunch',
    Seafood: 'seafood',
    BBQ: 'barbecue',
  };
  return table[c] || c.toLowerCase() || '';
}

function restaurantMatchesCuisineFilter(derivedLabels, selectedChip) {
  if (!selectedChip || !selectedChip.trim()) return true;
  const chip = selectedChip.trim();
  const related = {
    Italian: ['Italian', 'Pizza'],
    Japanese: ['Japanese', 'Sushi'],
    American: ['American', 'Burgers', 'BBQ', 'Brunch'],
    Dessert: ['Dessert', 'Bakery', 'Coffee'],
    Vegan: ['Vegan', 'Vegetarian'],
    Vegetarian: ['Vegetarian', 'Vegan'],
  };
  const want = new Set([chip, ...(related[chip] || [])]);
  return derivedLabels.some((l) => want.has(l));
}

// We store photo_reference and a relative proxy URL so the frontend never sees the Google API key.
function buildPhotoProxyUrl(restaurantId) {
  return `/api/restaurants/${restaurantId}/photo`;
}

/** Turn relative image path into absolute https URL for API responses. */
function toAbsoluteImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const u = url.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('/')) return `${PUBLIC_API_URL}${u}`;
  return `${PUBLIC_API_URL}/${u}`;
}

/** Source of resolved image for dev logging. */
const IMAGE_SOURCE = {
  USER_PHOTO: 'USER_PHOTO',
  LOG_PHOTO: 'LOG_PHOTO',
  PLACES: 'PLACES',
  WEBSITE: 'WEBSITE',
  PLACEHOLDER: 'PLACEHOLDER',
};

function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Allow http(s) and relative paths (served by this API, e.g. /api/restaurants/:id/photo)
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  );
}

const websiteImageCache = {};

/**
 * Try to resolve an image from a restaurant's official website.
 * Looks for og:image / twitter:image meta tags and returns an absolute URL
 * on the same domain as the website.
 */
async function resolveWebsiteImage(websiteUrl) {
  if (!websiteUrl || typeof websiteUrl !== 'string') return null;
  const key = websiteUrl.trim().toLowerCase();
  if (websiteImageCache[key] !== undefined) {
    return websiteImageCache[key];
  }

  let base;
  try {
    base = new URL(websiteUrl);
  } catch {
    websiteImageCache[key] = null;
    return null;
  }

  try {
    const res = await axios.get(websiteUrl, { timeout: 7000 });
    const html = typeof res.data === 'string' ? res.data : String(res.data || '');

    const candidates = [];
    const metaTagRegex = /<meta[^>]+(property|name)=['\"]([^'\"]+)['\"][^>]*>/gi;
    let match;
    while ((match = metaTagRegex.exec(html))) {
      const propName = (match[2] || '').toLowerCase();
      if (
        propName === 'og:image' ||
        propName === 'og:image:secure_url' ||
        propName === 'twitter:image'
      ) {
        const tag = match[0];
        const contentMatch = tag.match(/content=['\"]([^'\"]+)['\"]/i);
        if (contentMatch && contentMatch[1]) {
          candidates.push(contentMatch[1]);
        }
      }
    }

    for (const raw of candidates) {
      try {
        const url = new URL(raw, base.href);
        // Only accept images hosted on the same registrable domain (ignore random CDNs/third-parties)
        const baseHost = base.hostname.replace(/^www\./, '');
        const candidateHost = url.hostname.replace(/^www\./, '');
        if (baseHost !== candidateHost) continue;
        if (isValidImageUrl(url.href)) {
          websiteImageCache[key] = url.href;
          return url.href;
        }
      } catch {
        // ignore bad candidate
      }
    }
  } catch (err) {
    console.warn('[BiteRight] Website image fetch failed for %s: %s', websiteUrl, err.message);
  }

  websiteImageCache[key] = null;
  return null;
}

function logImageResolve(restaurantId, extra) {
  if (process.env.NODE_ENV === 'production' && !process.env.BITERIGHT_LOG_IMAGES) return;
  const row = findRestaurantById(restaurantId);
  const stat = STATIC_RESTAURANTS[restaurantId];
  logRestaurantImageResolution({
    internalId: restaurantId,
    restaurantName: row?.name || stat?.name || restaurantId,
    googlePlaceId: row?.placeId || extra?.effectivePlaceId || null,
    googlePlaceIdFound: !!(row?.placeId || extra?.effectivePlaceId),
    ...extra,
  });
}

/**
 * Lazy attach place_id + Places photo ref for seeded / pool rows (no stock food imagery).
 */
async function lazyEnrichPlaceId(restaurantId) {
  if (!GOOGLE_PLACES_API_KEY || lazyEnrichFailedIds.has(restaurantId)) return null;
  const row = findRestaurantById(restaurantId);
  if (!row || row.placeId) return row?.placeId || null;
  const stat = STATIC_RESTAURANTS[restaurantId];
  const query = stat
    ? buildEnrichmentQuery({
        name: stat.name,
        neighborhood: stat.neighborhood,
        city: stat.city,
        address: stat.address,
      })
    : `${row.name || ''} ${row.address || ''}`.trim();
  if (!query) {
    lazyEnrichFailedIds.add(restaurantId);
    return null;
  }
  const pid = await googleFindPlaceFromText(axios, GOOGLE_PLACES_API_KEY, query, row.lat, row.lng);
  if (!pid) {
    lazyEnrichFailedIds.add(restaurantId);
    logImageResolve(restaurantId, {
      chosenImageSourceType: 'ENRICH_FAILED',
      placeholderUsed: false,
      effectivePlaceId: null,
    });
    return null;
  }
  row.placeId = pid;
  const details = await googlePlaceDetails(pid);
  const photoRefs = details?.photos?.slice(0, 10)?.map((p) => p.photo_reference).filter(Boolean) || [];
  if (photoRefs.length > 0) {
    row.bestFoodPhotoRef = photoRefs[0];
    row.bestFoodPhotoUrl = buildPhotoProxyUrl(restaurantId);
    row.bestFoodPhotoUpdatedAt = new Date().toISOString();
  }
  return pid;
}

/**
 * Resolve the image URL for a restaurant card. Used by Feed, Discover, Tonight, and logs.
 * Priority:
 * 1) User-uploaded photo (logPreviewPhotoUrl)
 * 2) First stored log photo for that restaurant
 * 3) Google Places photo (cached proxy URL)
 * 4) Lazy enrich → Google Places photo (Find Place + Details)
 * 5) Google Places Details when placeId already known
 * 6) Discover nearby fallbackPhoto proxy
 * 7) Official website hero (same-domain og:image only)
 * 8) Neutral placeholder — no cuisine stock photos
 * @returns {Promise<{ url: string; source: string }>}
 */
async function resolveRestaurantCardImageWithSource(restaurantId, placeId, logPreviewPhotoUrl) {
  const staticInfo = STATIC_RESTAURANTS[restaurantId];

  if (isValidImageUrl(logPreviewPhotoUrl)) {
    logImageResolve(restaurantId, {
      chosenImageSourceType: 'USER_PHOTO',
      placeholderUsed: false,
      effectivePlaceId: placeId || findRestaurantById(restaurantId)?.placeId,
    });
    return { url: logPreviewPhotoUrl.trim(), source: IMAGE_SOURCE.USER_PHOTO };
  }
  const logForRestaurant = logs.find((l) => l.restaurantId === restaurantId);
  const firstLogPhoto = Array.isArray(logForRestaurant?.photos) && logForRestaurant.photos.length > 0
    ? logForRestaurant.photos[0]
    : undefined;
  if (isValidImageUrl(firstLogPhoto)) {
    logImageResolve(restaurantId, {
      chosenImageSourceType: 'LOG_PHOTO',
      placeholderUsed: false,
      effectivePlaceId: placeId || findRestaurantById(restaurantId)?.placeId,
    });
    return { url: firstLogPhoto.trim(), source: IMAGE_SOURCE.LOG_PHOTO };
  }

  const fromDb = findRestaurantById(restaurantId);
  let effectivePlaceId = placeId || fromDb?.placeId || null;

  if (isValidImageUrl(fromDb?.bestFoodPhotoUrl)) {
    logImageResolve(restaurantId, {
      chosenImageSourceType: 'PLACES',
      placeholderUsed: false,
      effectivePlaceId,
    });
    return { url: fromDb.bestFoodPhotoUrl, source: IMAGE_SOURCE.PLACES };
  }

  if (!effectivePlaceId && fromDb && GOOGLE_PLACES_API_KEY) {
    effectivePlaceId = await lazyEnrichPlaceId(restaurantId);
  }

  if (isValidImageUrl(fromDb?.bestFoodPhotoUrl)) {
    logImageResolve(restaurantId, {
      chosenImageSourceType: 'PLACES',
      placeholderUsed: false,
      effectivePlaceId: effectivePlaceId || fromDb?.placeId,
    });
    return { url: fromDb.bestFoodPhotoUrl, source: IMAGE_SOURCE.PLACES };
  }

  if (effectivePlaceId && GOOGLE_PLACES_API_KEY) {
    const details = await googlePlaceDetails(effectivePlaceId);
    const photoRefs = details?.photos?.slice(0, 10)?.map((p) => p.photo_reference).filter(Boolean) || [];
    if (photoRefs.length > 0) {
      const chosenRef = photoRefs[0];
      if (fromDb) {
        fromDb.bestFoodPhotoRef = chosenRef;
        fromDb.bestFoodPhotoUrl = buildPhotoProxyUrl(restaurantId);
        fromDb.bestFoodPhotoUpdatedAt = new Date().toISOString();
      }
      const url = fromDb?.bestFoodPhotoUrl || buildPhotoProxyUrl(restaurantId);
      if (isValidImageUrl(url)) {
        logImageResolve(restaurantId, {
          chosenImageSourceType: 'PLACES',
          placeholderUsed: false,
          effectivePlaceId,
        });
        return { url, source: IMAGE_SOURCE.PLACES };
      }
    }
  }

  if (isValidImageUrl(fromDb?.fallbackPhotoUrl)) {
    logImageResolve(restaurantId, {
      chosenImageSourceType: 'PLACES',
      placeholderUsed: false,
      effectivePlaceId,
    });
    return { url: fromDb.fallbackPhotoUrl, source: IMAGE_SOURCE.PLACES };
  }
  if (fromDb?.fallbackPhotoRef && !fromDb.fallbackPhotoUrl) {
    fromDb.fallbackPhotoUrl = buildPhotoProxyUrl(restaurantId);
    if (isValidImageUrl(fromDb.fallbackPhotoUrl)) {
      logImageResolve(restaurantId, {
        chosenImageSourceType: 'PLACES',
        placeholderUsed: false,
        effectivePlaceId,
      });
      return { url: fromDb.fallbackPhotoUrl, source: IMAGE_SOURCE.PLACES };
    }
  }

  const websiteUrl = fromDb?.websiteUrl || staticInfo?.websiteUrl;
  if (websiteUrl) {
    const siteImage = await resolveWebsiteImage(websiteUrl);
    if (isValidImageUrl(siteImage)) {
      logImageResolve(restaurantId, {
        chosenImageSourceType: 'WEBSITE',
        placeholderUsed: false,
        effectivePlaceId,
      });
      return { url: siteImage, source: IMAGE_SOURCE.WEBSITE };
    }
  }

  logImageResolve(restaurantId, {
    chosenImageSourceType: 'PLACEHOLDER',
    placeholderUsed: true,
    effectivePlaceId,
  });
  return { url: NEUTRAL_PLACEHOLDER_URL, source: IMAGE_SOURCE.PLACEHOLDER };
}

/** Resolve image URL only (backward compatible). */
async function resolveRestaurantCardImage(restaurantId, placeId, logPreviewPhotoUrl) {
  const { url } = await resolveRestaurantCardImageWithSource(restaurantId, placeId, logPreviewPhotoUrl);
  return url;
}

// --- Routes ------------------------------------------------------------------

// 0) Health check (so the app can show setup hints)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    googleConfigured: !!GOOGLE_PLACES_API_KEY,
  });
});

// 1) Autocomplete endpoint
app.get('/api/restaurants/autocomplete', async (req, res) => {
  const query = String(req.query.query || '').trim();
  if (!query || query.length < 2) {
    return res.json([]);
  }

  try {
    const predictions = await googlePlacesAutocomplete(query);
    const simplified = predictions.map((p) => ({
      placeId: p.place_id,
      name: (p.structured_formatting && p.structured_formatting.main_text) || p.description || '',
      address: p.description || '',
    }));
    console.log('[BiteRight] Autocomplete query "%s" -> %d results', query, simplified.length);
    if (simplified.length === 0 && GOOGLE_PLACES_API_KEY) {
      console.log('[BiteRight] Google returned 0 results. Check server terminal for any REQUEST_DENIED or error_message above.');
    }
    res.json(simplified);
  } catch (err) {
    console.error('[BiteRight] Autocomplete error', err.message);
    res.status(500).json({ error: 'Failed to fetch autocomplete results' });
  }
});

// 2) Upsert restaurant when a user selects an autocomplete result
app.post('/api/restaurants/select', async (req, res) => {
  const { placeId } = req.body || {};
  if (!placeId) {
    return res.status(400).json({ error: 'placeId is required' });
  }

  try {
    let restaurant = findRestaurantByPlaceId(placeId);

    if (!restaurant) {
      const details = await googlePlaceDetails(placeId);
      if (!details) {
        return res.status(500).json({ error: 'Failed to fetch place details' });
      }

      // rest_1..rest_5 are reserved for STATIC_RESTAURANTS (Lou Malnati's, etc.). Google-selected places start at rest_6.
      const baseId = `rest_${6 + restaurants.length}`;
      const photoRef = details.photos?.[0]?.photo_reference;
      const now = new Date().toISOString();

      const websiteUrl = details.website || undefined;
      restaurant = {
        restaurantId: baseId,
        placeId,
        name: details.name,
        address: details.formatted_address,
        lat: details.geometry?.location?.lat ?? 0,
        lng: details.geometry?.location?.lng ?? 0,
        websiteUrl,
        googleMapsUrl: details.url || undefined,
        phone: details.international_phone_number || undefined,
        reservationUrl: websiteUrl,
        fallbackPhotoRef: photoRef,
        fallbackPhotoUrl: photoRef ? buildPhotoProxyUrl(baseId) : undefined,
        bestFoodPhotoRef: photoRef,
        bestFoodPhotoUrl: photoRef ? buildPhotoProxyUrl(baseId) : undefined,
        bestFoodPhotoUpdatedAt: photoRef ? now : undefined,
        createdAt: now,
      };

      restaurants.push(restaurant);
    }

    res.json({
      restaurantId: restaurant.restaurantId,
      placeId: restaurant.placeId,
      name: restaurant.name,
      address: restaurant.address,
      lat: restaurant.lat,
      lng: restaurant.lng,
      fallbackPhotoUrl: restaurant.fallbackPhotoUrl,
    });
  } catch (err) {
    console.error('Select restaurant error', err.message);
    res.status(500).json({ error: 'Failed to upsert restaurant' });
  }
});

// 3) Logging a restaurant visit
app.post('/api/logs', async (req, res) => {
  const { restaurantId, rating, notes, photos, userId } = req.body || {};

  if (!restaurantId || typeof rating !== 'number') {
    return res.status(400).json({ error: 'restaurantId and numeric rating are required' });
  }

  const info = getRestaurantInfo(restaurantId);
  if (!info) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  const placeId = findRestaurantById(restaurantId)?.placeId ?? null;

  const logPreviewPhotoUrl = Array.isArray(photos) && photos.length > 0 ? photos[0] : undefined;
  const { url: resolvedUrl, source } = await resolveRestaurantCardImageWithSource(
    restaurantId,
    placeId,
    logPreviewPhotoUrl,
  );
  const previewPhotoUrl = (resolvedUrl && resolvedUrl.trim()) ? resolvedUrl.trim() : NEUTRAL_PLACEHOLDER_URL;
  const previewPhotoUrlAbsolute = toAbsoluteImageUrl(previewPhotoUrl);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[BiteRight] addLog image', { restaurantId, previewPhotoUrl: previewPhotoUrlAbsolute, source });
  }

  const id = `log_${logs.length + 1}`;
  const createdAt = new Date().toISOString();

  const log = {
    id,
    restaurantId,
    userId: typeof userId === 'string' ? userId : 'default',
    rating,
    notes,
    photos,
    previewPhotoUrl: previewPhotoUrlAbsolute,
    createdAt,
  };

  logs.push(log);

  res.json({
    id,
    restaurantId,
    restaurantName: info.name,
    address: info.address || '',
    lat: info.lat ?? null,
    lng: info.lng ?? null,
    rating,
    notes,
    previewPhotoUrl: previewPhotoUrlAbsolute,
    createdAt,
  });
});

// 4) Restaurant detail (for Reserve and detail view)
app.get('/api/restaurants/:restaurantId', (req, res) => {
  const restaurantId = req.params.restaurantId;
  const info = getRestaurantInfo(restaurantId);
  if (!info) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  const fromDb = findRestaurantById(restaurantId);
  const placeId = fromDb?.placeId ?? info.placeId ?? null;
  const debug = String(req.query.debug || '') === '1';
  resolveRestaurantCardImageWithSource(restaurantId, placeId, undefined)
    .then(({ url, source }) => {
      const imageUrl = url && url.trim() ? toAbsoluteImageUrl(url.trim()) : null;
      res.json({
        name: info.name,
        address: info.address || '',
        lat: info.lat ?? null,
        lng: info.lng ?? null,
        websiteUrl: info.websiteUrl || null,
        googleMapsUrl: info.googleMapsUrl || null,
        phone: info.phone || null,
        reservationUrl: info.reservationUrl || null,
        placeId: placeId || null,
        imageUrl,
        ...(debug ? { imageSource: source } : {}),
      });
    })
    .catch((err) => {
      console.error('[BiteRight] restaurant detail image resolution error', err.message);
      res.json({
        name: info.name,
        address: info.address || '',
        lat: info.lat ?? null,
        lng: info.lng ?? null,
        websiteUrl: info.websiteUrl || null,
        googleMapsUrl: info.googleMapsUrl || null,
        phone: info.phone || null,
        reservationUrl: info.reservationUrl || null,
        imageUrl: null,
      });
    });
});

// 5) Photo proxy (frontend can use /api/restaurants/:id/photo as an Image source)
app.get('/api/restaurants/:id/photo', async (req, res) => {
  const restaurantId = req.params.id;
  const restaurant = findRestaurantById(restaurantId);
  const photoRef = restaurant?.bestFoodPhotoRef || restaurant?.fallbackPhotoRef;
  if (!restaurant || !photoRef || !GOOGLE_PLACES_API_KEY) {
    return res.status(404).end();
  }

  try {
    const url = 'https://maps.googleapis.com/maps/api/place/photo';
    const response = await axios.get(url, {
      params: {
        maxwidth: 800,
        photo_reference: photoRef,
        key: GOOGLE_PLACES_API_KEY,
      },
      responseType: 'stream',
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    response.data.pipe(res);
  } catch (err) {
    console.error('Photo proxy error', err.message);
    res.status(500).end();
  }
});

// --- Tonight: Group Session + Swipe + Matches --------------------------------

const crypto = require('crypto');

const SESSION_CODE_LENGTH = 6;
const SESSION_EXPIRY_HOURS = 24;
const MATCH_THRESHOLD_DEFAULT = 1.0; // 100% = all participants (strict-all)

/** @type {Array<{ id: string; code: string; hostUserId: string; sessionName?: string; locationBias?: string; status: 'ACTIVE'|'CLOSED'; createdAt: string; expiresAt: string; participants: Array<{ participantId: string; userId?: string }> }>} */
const groupSessions = [];

/** @type {Array<{ id: string; sessionId: string; participantId: string; restaurantId: string; action: 'LIKE'|'PASS'; createdAt: string }>} */
const tonightSwipes = [];

/** Friend relationships: { userId, friendId }. Optional userDisplayNames: { [userId]: 'Sarah' } for badge text. */
const friends = [];
const userDisplayNames = {};

// Large Tonight pool (100–300 target). Each item: restaurantId, name, address, lat, lng, previewPhotoUrl, rating, cuisine, neighborhood, priceLevel.
const TONIGHT_POOL_BASE = [
  { restaurantId: 'rest_1', name: "Lou Malnati's", address: 'River North, IL', lat: 41.8902, lng: -87.6369, rating: 4.5, cuisine: 'Pizza · Deep dish', neighborhood: 'River North', priceLevel: 2 },
  { restaurantId: 'rest_2', name: 'Girl & the Goat', address: 'West Loop, IL', lat: 41.8815, lng: -87.6472, rating: 4.7, cuisine: 'American · Small plates', neighborhood: 'West Loop', priceLevel: 3 },
  { restaurantId: 'rest_3', name: "Portillo's", address: 'River North, IL', lat: 41.8902, lng: -87.6369, rating: 4.2, cuisine: 'Hot dogs · Chicago classics', neighborhood: 'River North', priceLevel: 1 },
  { restaurantId: 'rest_4', name: 'The Purple Pig', address: 'Magnificent Mile, IL', lat: 41.8904, lng: -87.6242, rating: 4.6, cuisine: 'Mediterranean · Shared plates', neighborhood: 'Magnificent Mile', priceLevel: 3 },
  { restaurantId: 'rest_5', name: 'Au Cheval', address: 'West Loop, IL', lat: 41.8815, lng: -87.6472, rating: 4.5, cuisine: 'Burgers · American', neighborhood: 'West Loop', priceLevel: 2 },
];

const TONIGHT_EXPANDED_NAMES = [
  'Sushi San', 'Taco Joint', 'Green Leaf Salad', 'Brickhouse BBQ', 'Noodle Bar', 'The French Press', 'Spice Route', 'Coastal Catch', 'Garden Bistro', 'Smoke & Fire',
  'Pasta Place', 'Curry House', 'Pho King', 'Diner 24', 'Tapas Bar', 'Poke Bowl', 'Pizza Napoletana', 'Steak & Co', 'Ramen Spot', 'Brunch Cafe',
  'Soul Kitchen', 'Vegan Table', 'Fish Market', 'Burrito Bros', 'Thai Orchid', 'Dim Sum Palace', 'Bakery & Brew', 'Oyster Bar', 'Comfort Kitchen', 'Fusion Lab',
];
const TONIGHT_CUISINES = [
  'Sushi · Japanese', 'Mexican · Tacos', 'Salads · Healthy', 'BBQ · American', 'Noodles · Asian', 'French · Cafe', 'Indian · Curry', 'Seafood', 'Vegetarian', 'BBQ · Southern',
  'Italian · Pasta', 'Indian · Curry', 'Vietnamese · Pho', 'American · Diner', 'Spanish · Tapas', 'Hawaiian · Poke', 'Pizza · Neapolitan', 'Steakhouse', 'Ramen · Japanese', 'Brunch · American',
  'Soul · Southern', 'Vegan', 'Seafood · Fresh', 'Mexican · Burritos', 'Thai', 'Chinese · Dim Sum', 'Bakery · Coffee', 'Seafood · Oysters', 'American · Comfort', 'Fusion',
];
const TONIGHT_NEIGHBORHOODS = [
  'River North', 'West Loop', 'Magnificent Mile', 'Lincoln Park', 'Wicker Park', 'Logan Square', 'Lakeview', 'Wrigleyville', 'Hyde Park', 'Pilsen',
  'Andersonville', 'Bucktown', 'Gold Coast', 'South Loop', 'Ukrainian Village', 'Rogers Park', 'Lincoln Square', 'Edgewater', 'Bridgeport', 'Chinatown',
];
function buildExpandedTonightPool() {
  const out = [...TONIGHT_POOL_BASE];
  const centerLat = 41.88;
  const centerLng = -87.63;
  const mileToDeg = 1 / 69;
  for (let i = 6; i <= 100; i++) {
    const j = (i - 6) % TONIGHT_EXPANDED_NAMES.length;
    const k = (i - 6) % TONIGHT_CUISINES.length;
    const n = (i - 6) % TONIGHT_NEIGHBORHOODS.length;
    const lat = centerLat + (Math.sin(i * 0.7) * 4 * mileToDeg);
    const lng = centerLng + (Math.cos(i * 0.5) * 5 * mileToDeg);
    out.push({
      restaurantId: 'rest_' + i,
      name: TONIGHT_EXPANDED_NAMES[j] + (i > 20 ? ' ' + (i % 10) : ''),
      address: TONIGHT_NEIGHBORHOODS[n] + ', IL',
      lat,
      lng,
      rating: 4 + Math.floor((i % 10) * 0.09 * 10) / 10,
      cuisine: TONIGHT_CUISINES[k],
      neighborhood: TONIGHT_NEIGHBORHOODS[n],
      priceLevel: (i % 3) + 1,
    });
  }
  return out;
}

const TONIGHT_POOL = buildExpandedTonightPool();

const { getTonightPoolRanked } = require('./tonightPool');
const { getSocialProofBadge } = require('./socialProof');

const geocodeCache = {};
const MILES_TO_DEG = 1 / 69; // approx

async function geocodeQuery(query) {
  const cached = await geocodeWithLabel(query);
  return cached ? { lat: cached.lat, lng: cached.lng } : null;
}

/** Geocode with label; cached by query string. Returns { label, lat, lng } or null. */
async function geocodeWithLabel(query) {
  const list = await geocodeAutocomplete(query);
  return list && list.length ? list[0] : null;
}

const geocodeAutocompleteCache = {};

/** Returns up to 5 place suggestions { label, lat, lng }[] for autocomplete. Cached by query. */
async function geocodeAutocomplete(query) {
  const key = (query || '').trim().toLowerCase();
  if (!key) return [];
  if (geocodeAutocompleteCache[key]) return geocodeAutocompleteCache[key];
  if (!GOOGLE_PLACES_API_KEY) return [];
  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json';
    const { data } = await axios.get(url, {
      params: { address: query.trim(), key: GOOGLE_PLACES_API_KEY },
    });
    if (data.status !== 'OK' || !data.results?.length) {
      return [];
    }
    const results = data.results.slice(0, 5).map((r) => {
      const loc = r.geometry.location;
      const label = r.formatted_address || r.address_components?.[0]?.long_name || query.trim();
      return { label, lat: loc.lat, lng: loc.lng };
    });
    geocodeAutocompleteCache[key] = results;
    return results;
  } catch (err) {
    console.error('[BiteRight] Geocode autocomplete error', err.message);
    return [];
  }
}

function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function generateSessionCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, SESSION_CODE_LENGTH);
}

function findSessionByCode(code) {
  const c = (code || '').toUpperCase().trim();
  return groupSessions.find((s) => s.code === c && s.status === 'ACTIVE');
}

function findSessionById(id) {
  return groupSessions.find((s) => s.id === id);
}

function isSessionExpired(session) {
  return new Date(session.expiresAt) < new Date();
}

// POST /api/tonight/sessions
app.post('/api/tonight/sessions', (req, res) => {
  const { sessionName, locationBias } = req.body || {};
  let code;
  do {
    code = generateSessionCode();
  } while (groupSessions.some((s) => s.code === code));

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
  const hostUserId = 'user_' + Date.now();
  const sessionId = 'sess_' + Date.now();

  const session = {
    id: sessionId,
    code,
    hostUserId,
    sessionName: sessionName || null,
    locationBias: locationBias || null,
    status: 'ACTIVE',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    participants: [{ participantId: 'p_' + Date.now(), userId: hostUserId }],
  };
  groupSessions.push(session);

  const hostParticipantId = session.participants[0].participantId;
  const shareUrl = `biteright://tonight/join?code=${code}`;
  res.status(201).json({
    sessionId,
    code,
    shareUrl,
    expiresAt: session.expiresAt,
    participantId: hostParticipantId,
  });
});

// POST /api/tonight/sessions/:code/join
app.post('/api/tonight/sessions/:code/join', (req, res) => {
  const code = req.params.code;
  const session = findSessionByCode(code);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  if (isSessionExpired(session)) {
    session.status = 'CLOSED';
    return res.status(410).json({ error: 'Session expired' });
  }

  const { userId } = req.body || {};
  const participantId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  session.participants.push({ participantId, userId: userId || null });

  res.json({
    sessionId: session.id,
    participantId,
    sessionState: {
      sessionId: session.id,
      code: session.code,
      sessionName: session.sessionName,
      participantCount: session.participants.length,
    },
  });
});

// GET /api/tonight/sessions/:code/pool — ranked, variety-constrained, paginated. Optional participantId for personalization.
app.get('/api/tonight/sessions/:code/pool', async (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  if (isSessionExpired(session)) {
    return res.status(410).json({ error: 'Session expired' });
  }
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const participantId = req.query.participantId || session.participants?.[0]?.participantId || null;
  const participant = session.participants?.find((p) => p.participantId === participantId);
  const userId = participant?.userId || 'default';
  const lat = 41.88;
  const lng = -87.63;
  const ranked = getTonightPoolRanked({
    pool: TONIGHT_POOL,
    lat,
    lng,
    radiusMiles: 10,
    participantId,
    sessionId: session.id,
    tonightSwipes,
    savedRestaurants,
    groupSessions,
    negativeFeedback,
    distanceMiles,
  });
  const start = page * pageSize;
  const slice = ranked.slice(start, start + pageSize);
  const tonightCtx = { savedRestaurants, tonightSwipes, logs, friends, groupSessions, userDisplayNames };
  const pool = await Promise.all(
    slice.map(async (r) => {
      const totalParticipants = session.participants?.length || 0;
      const likeCount = (tonightSwipes || []).filter(
        (s) => s.sessionId === session.id && s.restaurantId === r.restaurantId && s.action === 'LIKE',
      ).length;
      const groupSignal = totalParticipants > 0 ? `${likeCount}/${totalParticipants} liked this` : null;

      let fromDb = findRestaurantById(r.restaurantId);
      if (!fromDb) {
        restaurants.push({
          restaurantId: r.restaurantId,
          placeId: null,
          name: r.name,
          address: r.address || '',
          lat: r.lat,
          lng: r.lng,
          createdAt: new Date().toISOString(),
        });
        fromDb = findRestaurantById(r.restaurantId);
      }
      const rawUrl = await resolveRestaurantCardImage(r.restaurantId, fromDb?.placeId ?? null, null);
      const abs = toAbsoluteImageUrl(rawUrl);
      const socialProofBadge =
        getSocialProofBadge(r.restaurantId, userId, {
          ...tonightCtx,
          similarTasteSignal: r.similarTasteSignal,
          cuisine: r.cuisine,
        }) || null;
      return {
        restaurantId: r.restaurantId,
        name: r.name,
        address: r.address,
        placeId: fromDb?.placeId ?? null,
        previewPhotoUrl: abs,
        imageUrl: abs,
        socialProofBadge,
        groupSignal,
      };
    }),
  );
  res.json({
    pool,
    total: ranked.length,
    page,
    pageSize,
  });
});

// POST /api/tonight/sessions/:code/swipe (idempotent upsert per participantId + restaurantId).
// If action===LIKE and userId provided, upsert SavedRestaurant. Guests (participantId only): no save; MVP does not persist saves for guests.
app.post('/api/tonight/sessions/:code/swipe', (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  if (isSessionExpired(session)) {
    return res.status(410).json({ error: 'Session expired' });
  }

  const { participantId, userId, restaurantId, action } = req.body || {};
  if (!participantId || !restaurantId || !action || !['LIKE', 'PASS'].includes(action)) {
    return res.status(400).json({ error: 'participantId, restaurantId, and action (LIKE|PASS) required' });
  }

  const inSession = session.participants.some((p) => p.participantId === participantId);
  if (!inSession) {
    return res.status(403).json({ error: 'Not a participant of this session' });
  }

  const existing = tonightSwipes.find(
    (s) => s.sessionId === session.id && s.participantId === participantId && s.restaurantId === restaurantId,
  );
  if (existing) {
    existing.action = action;
    existing.createdAt = new Date().toISOString();
  } else {
    tonightSwipes.push({
      id: 'swipe_' + Date.now(),
      sessionId: session.id,
      participantId,
      restaurantId,
      action,
      createdAt: new Date().toISOString(),
    });
  }

  let saved = false;
  if (action === 'LIKE' && userId) {
    const existingSaved = savedRestaurants.find((s) => s.userId === userId && s.restaurantId === restaurantId);
    if (!existingSaved) {
      savedRestaurants.push({
        id: 'saved_' + Date.now(),
        userId,
        restaurantId,
        savedAt: new Date().toISOString(),
        source: 'TONIGHT',
      });
      saved = true;
    }
  }

  res.json({ ok: true, saved });
});

// --- Saved restaurants (Profile) --------------------------------------------

// GET /api/users/:userId/saved?sort=location|distance&lat=&lng=
app.get('/api/users/:userId/saved', (req, res) => {
  const userId = req.params.userId;
  const sort = (req.query.sort || 'location').toLowerCase();
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  const saved = savedRestaurants.filter((s) => s.userId === userId);
  const withInfo = saved
    .map((s) => {
      const info = getRestaurantInfo(s.restaurantId);
      const snap = s.snapshot || null;
      if (!info && !snap) return null;
      const name = info?.name || snap?.name || 'Saved place';
      const address = info?.address ?? snap?.address ?? null;
      const city = info?.city ?? snap?.city ?? null;
      const neighborhood = info?.neighborhood ?? snap?.neighborhood ?? null;
      const lat = info?.lat ?? snap?.lat ?? null;
      const lng = info?.lng ?? snap?.lng ?? null;
      const previewPhotoUrl =
        toAbsoluteImageUrl(info?.previewPhotoUrl || snap?.previewPhotoUrl || null) || null;
      const canonicalId = info?.restaurantId || s.restaurantId;
      const placeId = info?.placeId || (String(s.restaurantId).startsWith('ChIJ') ? s.restaurantId : null);
      return {
        restaurantId: canonicalId,
        place_id: placeId || canonicalId,
        name,
        address,
        city,
        neighborhood,
        lat,
        lng,
        previewPhotoUrl,
        savedAt: s.savedAt,
        source: (s.source === 'swipe' || s.source === 'TONIGHT') ? 'swipe' : 'manual',
      };
    })
    .filter(Boolean);

  if (sort === 'distance' && Number.isFinite(lat) && Number.isFinite(lng)) {
    function dist(a, b) {
      return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2);
    }
    const user = { lat, lng };
    withInfo.sort((a, b) => dist(a, user) - dist(b, user));
  } else {
    withInfo.sort((a, b) => {
      const cityA = (a.city || '').toLowerCase();
      const cityB = (b.city || '').toLowerCase();
      if (cityA !== cityB) return cityA.localeCompare(cityB);
      const neighA = a.neighborhood ?? '\uffff';
      const neighB = b.neighborhood ?? '\uffff';
      if (neighA !== neighB) return neighA.localeCompare(neighB);
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  res.json(withInfo);
});

// POST /api/users/:userId/saved — add saved restaurant (manual or any source)
app.post('/api/users/:userId/saved', (req, res) => {
  const userId = req.params.userId;
  const body = req.body || {};
  const { restaurantId, source, name, photo, cuisine, neighborhood, address, lat, lng, cuisines } = body;
  if (!restaurantId || typeof restaurantId !== 'string') {
    return res.status(400).json({ error: 'restaurantId required' });
  }
  if (process.env.NODE_ENV !== 'production' || process.env.BITERIGHT_DEBUG_SAVED) {
    console.log('[BiteRight][Saved] POST /saved received', {
      userId,
      restaurantId,
      source,
      name: name || null,
      hasPhoto: !!photo,
      cuisine: cuisine || null,
      neighborhood: neighborhood || null,
    });
  }
  let canonicalId = restaurantId;
  const byPlace = String(restaurantId).startsWith('ChIJ') ? findRestaurantByPlaceId(restaurantId) : null;
  if (byPlace) canonicalId = byPlace.restaurantId;

  const existing = savedRestaurants.find(
    (s) => s.userId === userId && (s.restaurantId === restaurantId || s.restaurantId === canonicalId),
  );
  if (existing) {
    if (name && typeof name === 'string') {
      existing.snapshot = {
        ...(existing.snapshot || {}),
        name,
        previewPhotoUrl: photo || existing.snapshot?.previewPhotoUrl,
        neighborhood: neighborhood ?? existing.snapshot?.neighborhood,
        address: address ?? existing.snapshot?.address,
      };
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log('[BiteRight][Saved] POST result alreadySaved', { userId, restaurantId: canonicalId });
    }
    return res.json({ ok: true, saved: false, alreadySaved: true, restaurantId: canonicalId });
  }

  const snap = {
    name: typeof name === 'string' ? name : undefined,
    previewPhotoUrl: typeof photo === 'string' ? photo : null,
    address: typeof address === 'string' ? address : null,
    neighborhood: typeof neighborhood === 'string' ? neighborhood : null,
    lat: typeof lat === 'number' && Number.isFinite(lat) ? lat : null,
    lng: typeof lng === 'number' && Number.isFinite(lng) ? lng : null,
    cuisines: Array.isArray(cuisines) ? cuisines.filter((x) => typeof x === 'string') : undefined,
  };
  const hasSnap = snap.name || snap.previewPhotoUrl || snap.neighborhood || snap.address || snap.cuisines?.length;
  savedRestaurants.push({
    id: 'saved_' + Date.now(),
    userId,
    restaurantId: canonicalId,
    savedAt: new Date().toISOString(),
    source: source === 'swipe' || source === 'manual' ? source : 'manual',
    snapshot: hasSnap ? snap : undefined,
  });
  if (process.env.NODE_ENV !== 'production') {
    console.log('[BiteRight][Saved] POST result saved', { userId, restaurantId: canonicalId });
  }
  res.status(201).json({ ok: true, saved: true, restaurantId: canonicalId });
});

// Negative feedback on recommendations: hide / suggest_less
app.post('/api/users/:userId/negative-feedback', (req, res) => {
  const userId = req.params.userId;
  const { restaurantId, actionType } = req.body || {};
  if (!restaurantId || (actionType !== 'hide' && actionType !== 'suggest_less')) {
    return res.status(400).json({ error: 'restaurantId and valid actionType required' });
  }
  const info = getRestaurantInfo(restaurantId);
  if (!info) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  const id = 'neg_' + Date.now();
  const createdAt = new Date().toISOString();
  negativeFeedback.push({
    id,
    userId,
    restaurantId,
    actionType,
    createdAt,
    relatedFeatures: {
      cuisine: null,
      neighborhood: info.neighborhood || null,
      priceLevel: null,
    },
  });
  res.status(201).json({ ok: true });
});

// DELETE /api/users/:userId/saved/:restaurantId — remove saved restaurant
app.delete('/api/users/:userId/saved/:restaurantId', (req, res) => {
  const userId = req.params.userId;
  const rawId = req.params.restaurantId;
  let canonical = rawId;
  const byPlace = String(rawId).startsWith('ChIJ') ? findRestaurantByPlaceId(rawId) : null;
  if (byPlace) canonical = byPlace.restaurantId;
  const index = savedRestaurants.findIndex(
    (s) => s.userId === userId && (s.restaurantId === rawId || s.restaurantId === canonical),
  );
  if (index === -1) {
    return res.status(404).json({ error: 'Saved restaurant not found' });
  }
  savedRestaurants.splice(index, 1);
  res.json({ ok: true, removed: true });
});

// --- Friends (for social proof badges) ---------------------------------------

// GET /api/users/:userId/friends
app.get('/api/users/:userId/friends', (req, res) => {
  const userId = req.params.userId;
  const list = friends
    .filter((f) => f.userId === userId || f.friendId === userId)
    .map((f) => (f.userId === userId ? f.friendId : f.userId))
    .filter((id, i, arr) => arr.indexOf(id) === i);
  res.json({
    friends: list.map((friendId) => ({ friendId, displayName: userDisplayNames[friendId] || null })),
  });
});

// POST /api/users/:userId/friends — add a friend (idempotent). body: { friendId, displayName? }
app.post('/api/users/:userId/friends', (req, res) => {
  const userId = req.params.userId;
  const { friendId, displayName } = req.body || {};
  if (!friendId || typeof friendId !== 'string') {
    return res.status(400).json({ error: 'friendId required' });
  }
  if (userId === friendId) {
    return res.status(400).json({ error: 'Cannot add self as friend' });
  }
  const exists = friends.some((f) => (f.userId === userId && f.friendId === friendId) || (f.userId === friendId && f.friendId === userId));
  if (!exists) {
    friends.push({ userId, friendId });
  }
  if (typeof displayName === 'string' && displayName.trim()) {
    userDisplayNames[friendId] = displayName.trim();
  }
  res.status(201).json({ ok: true, friendId });
});

// --- Geocoding (backend only; cached by query) -------------------------------

// GET /api/geo/geocode?query=... (single result)
app.get('/api/geo/geocode', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'query required' });
  }
  const result = await geocodeWithLabel(query);
  if (!result) {
    return res.status(404).json({ error: 'Could not geocode location' });
  }
  res.json({ label: result.label, lat: result.lat, lng: result.lng });
});

// GET /api/geo/autocomplete?query=... (multiple results for type-ahead)
app.get('/api/geo/autocomplete', async (req, res) => {
  const query = (req.query.query || '').trim();
  const results = await geocodeAutocomplete(query);
  res.json({ results });
});

// GET /api/tonight/sessions/:code/matches
// Match = liked by ALL participants (strict-all). Optional: threshold mode via query ?threshold=0.7
app.get('/api/tonight/sessions/:code/matches', (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  if (isSessionExpired(session)) {
    return res.status(410).json({ error: 'Session expired' });
  }

  const threshold = Math.min(1, Math.max(0, parseFloat(req.query.threshold) || MATCH_THRESHOLD_DEFAULT));
  const totalParticipants = session.participants.length;
  const likesRequired = Math.ceil(threshold * totalParticipants);

  const likesByRestaurant = {};
  const passByRestaurant = {};
  for (const s of tonightSwipes) {
    if (s.sessionId !== session.id) continue;
    if (s.action === 'LIKE') {
      likesByRestaurant[s.restaurantId] = (likesByRestaurant[s.restaurantId] || 0) + 1;
    } else {
      passByRestaurant[s.restaurantId] = (passByRestaurant[s.restaurantId] || 0) + 1;
    }
  }

  // Strict-all: restaurant must have LIKE from every participant and no PASS from any
  const participantIds = new Set(session.participants.map((p) => p.participantId));
  const matches = [];
  for (const rest of TONIGHT_POOL) {
    const likeCount = likesByRestaurant[rest.restaurantId] || 0;
    const passCount = passByRestaurant[rest.restaurantId] || 0;
    if (passCount > 0) continue;
    if (likeCount >= likesRequired) {
      const percentMatch = totalParticipants > 0 ? (likeCount / totalParticipants) * 100 : 100;
      matches.push({
        restaurantId: rest.restaurantId,
        name: rest.name,
        address: rest.address,
        percentMatch: Math.round(percentMatch),
        previewPhotoUrl: toAbsoluteImageUrl(rest.previewPhotoUrl) || rest.previewPhotoUrl,
      });
    }
  }

  matches.sort((a, b) => (b.percentMatch - a.percentMatch));

  res.json({
    totalParticipants,
    likesRequired,
    matches,
  });
});

// --- Discover (recommendation pipeline + location filter) --------------------

const { getDiscoverRecommendations } = require('./recommendation');

async function attachImageAndPlaceId(rec, userId, ctx) {
  const placeId = findRestaurantById(rec.restaurantId)?.placeId ?? null;
  const derivedCuisines = deriveCuisinesFromPlace(rec.types || [], rec.name, rec.cuisine);
  const mappedCat = mapFoodCategory(rec.types || [], rec.name);
  const displayCuisine =
    (derivedCuisines.length && derivedCuisines[0]) ||
    (rec.cuisine && String(rec.cuisine).trim() && rec.cuisine !== 'Restaurant' ? rec.cuisine : '') ||
    mappedCat ||
    '';
  const rawUrl = await resolveRestaurantCardImage(rec.restaurantId, placeId, undefined);
  const finalImageUrl = toAbsoluteImageUrl(rawUrl || NEUTRAL_PLACEHOLDER_URL);
  const socialProofBadge =
    getSocialProofBadge(rec.restaurantId, userId, {
      savedRestaurants: ctx?.savedRestaurants,
      tonightSwipes: ctx?.tonightSwipes,
      logs: ctx?.logs,
      friends: ctx?.friends,
      groupSessions: ctx?.groupSessions,
      userDisplayNames: ctx?.userDisplayNames,
      similarTasteSignal: rec.similarTasteSignal,
      cuisine: rec.cuisine,
    }) || null;
  return {
    restaurant: {
      id: rec.restaurantId,
      name: rec.name,
      address: rec.address,
      neighborhood: rec.neighborhood ?? (rec.address && rec.address.split(',')[0]) ?? null,
      cuisine: displayCuisine,
      cuisines: derivedCuisines.length ? derivedCuisines : mappedCat ? [mappedCat] : [],
      priceLevel: rec.priceLevel ?? 2,
      placeId,
      // Normalize with Feed's successful field name.
      previewPhotoUrl: finalImageUrl,
      // Keep backward-compatible alias for existing Discover consumers.
      imageUrl: finalImageUrl,
    },
    percentMatch: rec.percentMatch,
    explanations: rec.explanations || ['Recommended for you'],
    socialProofBadge,
  };
}

/**
 * Discover from Google Nearby (optionally biased with cuisine keyword + post-filter).
 * @returns {Promise<{ isColdStart: boolean; discoverMode: string; sections: object; recommendations: any[]; location: object; radiusMiles: number }>}
 */
async function buildGooglePlaceDiscover(lat, lng, radiusMiles, userId, cuisineFilter, meta) {
  const keyword = cuisineFilter ? cuisineChipToNearbyKeyword(cuisineFilter) : '';
  console.log('[BiteRight][Discover] Google Places discover', {
    ...meta,
    cuisineReceived: cuisineFilter || null,
    nearbyKeyword: keyword || null,
  });

  const nearbyRaw = await googlePlacesNearbyRestaurants(
    lat,
    lng,
    radiusMiles * 1609.34,
    keyword || undefined,
  );
  let nearby = nearbyRaw.filter((p) => isFoodPlace(p.types));
  const discoverCtx = { savedRestaurants, tonightSwipes, logs, friends, groupSessions, userDisplayNames };

  let recs = nearby.map((p, idx) => {
    let restaurant = findRestaurantByPlaceId(p.placeId);
    if (!restaurant) {
      const restaurantId = `g_${String(p.placeId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 18) || `${Date.now()}_${idx}`}`;
      restaurant = {
        restaurantId,
        placeId: p.placeId,
        name: p.name,
        address: p.address,
        lat: p.lat ?? lat,
        lng: p.lng ?? lng,
        fallbackPhotoRef: p.photoRef || undefined,
        fallbackPhotoUrl: p.photoRef ? buildPhotoProxyUrl(restaurantId) : undefined,
        bestFoodPhotoRef: p.photoRef || undefined,
        bestFoodPhotoUrl: p.photoRef ? buildPhotoProxyUrl(restaurantId) : undefined,
        createdAt: new Date().toISOString(),
      };
      restaurants.push(restaurant);
    }

    const score = p.rating != null ? Math.min(99, Math.round((p.rating / 5) * 100)) : Math.max(55, 88 - idx);
    return {
      restaurantId: restaurant.restaurantId,
      name: p.name,
      address: p.address,
      neighborhood: p.address ? String(p.address).split(',')[0].trim() : null,
      cuisine: mapFoodCategory(p.types, p.name),
      types: p.types,
      priceLevel: p.priceLevel ?? 2,
      percentMatch: score,
      explanations: ['Recommended nearby'],
      distance: 0,
      inRadius: true,
      similarTasteSignal: false,
    };
  });

  if (cuisineFilter) {
    recs = recs.filter((rec) => {
      const derived = deriveCuisinesFromPlace(rec.types || [], rec.name, rec.cuisine);
      const included = restaurantMatchesCuisineFilter(derived, cuisineFilter);
      console.log('[BiteRight][Discover] inclusion', {
        name: rec.name,
        derivedCuisines: derived,
        selectedCuisine: cuisineFilter,
        included,
        reason: included ? 'cuisine-match' : 'filtered-out',
      });
      return included;
    });
  }

  recs = recs.slice(0, 30);

  const sections = {
    topPicksForYou: recs.slice(0, 8),
    becauseYouLiked: [],
    trendingWithSimilarUsers: recs.slice(8, 16),
    allNearby: recs,
  };

  const topPicksForYou = await Promise.all(
    (sections.topPicksForYou || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)),
  );
  const becauseYouLiked = await Promise.all(
    (sections.becauseYouLiked || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)),
  );
  const trendingWithSimilarUsers = await Promise.all(
    (sections.trendingWithSimilarUsers || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)),
  );
  const allNearby = await Promise.all((sections.allNearby || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)));

  console.log('[BiteRight][Discover] Google response summary', {
    ...meta,
    cuisineFilter: cuisineFilter || null,
    nearbyCountRaw: nearbyRaw.length,
    nearbyCountFood: nearby.length,
    recsAfterFilter: recs.length,
    returnedCount: allNearby.length,
  });

  return {
    isColdStart: true,
    discoverMode: 'trending',
    sections: { topPicksForYou, becauseYouLiked, trendingWithSimilarUsers, allNearby },
    recommendations: allNearby,
    location: { lat, lng },
    radiusMiles,
  };
}

function filterRecommendationSectionsByCuisine(sections, cuisineFilter) {
  if (!cuisineFilter || !sections) return sections;
  function filterRecList(list) {
    return (list || []).filter((rec) => {
      const derived = deriveCuisinesFromPlace(rec.types || [], rec.name, rec.cuisine);
      const included = restaurantMatchesCuisineFilter(derived, cuisineFilter);
      console.log('[BiteRight][Discover] pool inclusion', {
        name: rec.name,
        derivedCuisines: derived,
        selectedCuisine: cuisineFilter,
        included,
        reason: included ? 'cuisine-match' : 'filtered-out',
      });
      return included;
    });
  }
  return {
    topPicksForYou: filterRecList(sections.topPicksForYou),
    becauseYouLiked: filterRecList(sections.becauseYouLiked),
    trendingWithSimilarUsers: filterRecList(sections.trendingWithSimilarUsers),
    allNearby: filterRecList(sections.allNearby),
  };
}

// GET /api/discover?mode=nearby&lat=&lng=&radiusMiles=10&userId=default  OR  mode=location&query=Chicago%20Loop
app.get('/api/discover', async (req, res) => {
  const mode = (req.query.mode || 'nearby').toLowerCase();
  const radiusMiles = Math.min(50, Math.max(0.5, parseFloat(req.query.radiusMiles) || 10));
  const userId = (req.query.userId || 'default').trim() || 'default';
  const cuisineQuery = (req.query.cuisine || '').trim() || null;
  let lat = parseFloat(req.query.lat);
  let lng = parseFloat(req.query.lng);

  if (mode === 'location') {
    const query = (req.query.query || '').trim();
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    // Prefer explicitly provided coords (from the client) to avoid backend geocoding.
    if (!hasCoords) {
      if (!query) {
        return res.status(400).json({ error: 'query required when mode=location (or provide lat/lng)' });
      }
      const geo = await geocodeQuery(query);
      if (!geo) {
        return res.status(400).json({ error: 'Could not geocode location' });
      }
      lat = geo.lat;
      lng = geo.lng;
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng required for mode=nearby, or use mode=location with query' });
  }

  if (mode === 'location') {
    console.log('[BiteRight][Discover] location request params', {
      mode,
      userId,
      query: (req.query.query || '').trim() || null,
      cuisine: cuisineQuery,
      lat,
      lng,
      radiusMiles,
    });
  } else if (cuisineQuery) {
    console.log('[BiteRight][Discover] nearby request params', {
      mode,
      userId,
      cuisine: cuisineQuery,
      lat,
      lng,
      radiusMiles,
    });
  }

  // Location mode: use real nearby places for the selected coordinates.
  // This avoids returning Chicago-only pool entries for non-Chicago cities.
  if (mode === 'location' && GOOGLE_PLACES_API_KEY) {
    try {
      const payload = await buildGooglePlaceDiscover(lat, lng, radiusMiles, userId, cuisineQuery, {
        mode,
        query: (req.query.query || '').trim() || null,
      });
      return res.json(payload);
    } catch (err) {
      console.error('[BiteRight][Discover] location nearby search error', err.message);
      return res.status(502).json({ error: 'Failed to load location-based restaurants' });
    }
  }

  // Nearby + cuisine: use Google keyword search so lists differ by chip (when API key is set).
  if (mode === 'nearby' && cuisineQuery && GOOGLE_PLACES_API_KEY) {
    try {
      const payload = await buildGooglePlaceDiscover(lat, lng, radiusMiles, userId, cuisineQuery, {
        mode: 'nearby',
      });
      return res.json(payload);
    } catch (err) {
      console.error('[BiteRight][Discover] nearby+cuisine search error', err.message);
      return res.status(502).json({ error: 'Failed to load cuisine-filtered restaurants' });
    }
  }

  const result = getDiscoverRecommendations({
    userId,
    lat,
    lng,
    radiusMiles,
    savedRestaurants,
    tonightSwipes,
    groupSessions,
    negativeFeedback,
    pool: TONIGHT_POOL,
    getRestaurantInfo,
    distanceMiles,
  });

  const discoverCtx = { savedRestaurants, tonightSwipes, logs, friends, groupSessions, userDisplayNames };
  let sections = result.sections;

  // Defensive fallback only for nearby mode.
  // In location mode, we should surface empty/error states rather than silently returning Chicago pool items.
  if (
    mode !== 'location' &&
    (
      !sections ||
      (!sections.topPicksForYou?.length &&
        !sections.becauseYouLiked?.length &&
        !sections.trendingWithSimilarUsers?.length &&
        !sections.allNearby?.length)
    )
  ) {
    sections = {
      topPicksForYou: TONIGHT_POOL.slice(0, 8).map((r) => ({
        restaurantId: r.restaurantId,
        name: r.name,
        address: r.address,
        neighborhood: r.neighborhood || (r.address && r.address.split(',')[0]) || null,
        cuisine: r.cuisine || '',
        priceLevel: r.priceLevel ?? 2,
        percentMatch: 80,
        explanations: ['Recommended nearby'],
        distance: 0,
        inRadius: true,
        similarTasteSignal: false,
      })),
      becauseYouLiked: [],
      trendingWithSimilarUsers: [],
      allNearby: TONIGHT_POOL.slice(0, 20).map((r) => ({
        restaurantId: r.restaurantId,
        name: r.name,
        address: r.address,
        neighborhood: r.neighborhood || (r.address && r.address.split(',')[0]) || null,
        cuisine: r.cuisine || '',
        priceLevel: r.priceLevel ?? 2,
        percentMatch: 70,
        explanations: ['Recommended nearby'],
        distance: 0,
        inRadius: true,
        similarTasteSignal: false,
      })),
    };
  }

  if (mode === 'nearby' && cuisineQuery) {
    sections = filterRecommendationSectionsByCuisine(sections, cuisineQuery);
  }

  const topPicksForYou = await Promise.all((sections.topPicksForYou || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)));
  const becauseYouLiked = await Promise.all((sections.becauseYouLiked || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)));
  const trendingWithSimilarUsers = await Promise.all((sections.trendingWithSimilarUsers || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)));
  const allNearby = await Promise.all((sections.allNearby || []).map((rec) => attachImageAndPlaceId(rec, userId, discoverCtx)));

  res.json({
    isColdStart: result.isColdStart,
    discoverMode: result.discoverMode || 'trending',
    sections: {
      topPicksForYou,
      becauseYouLiked,
      trendingWithSimilarUsers,
      allNearby,
    },
    recommendations: allNearby,
    location: { lat, lng },
    radiusMiles,
  });
});

const server = app.listen(PORT, () => {
  console.log(`BiteRight backend listening on http://localhost:${PORT}`);
  if (GOOGLE_PLACES_API_KEY) {
    console.log('  Google key set. If search still shows no results, check: Places API enabled, and key restriction allows server (e.g. "None" or "IP addresses"), not only iOS/HTTP.');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Free it with: kill $(lsof -t -i :${PORT})`);
  } else {
    console.error(err);
  }
});

