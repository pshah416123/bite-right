const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

dotenv.config({ path: require('path').join(__dirname, '.env') });
const { rankPlaces, rankForSection } = require('./ranking');
const { getCuisineGroups, matchesCuisineGroup } = require('./utils/cuisineNormalization');
const db = require('./utils/db');
const { supabase, supabaseConfigured } = require('./utils/supabase');

// ─── Reservation links ────────────────────────────────────────────────────────
// Stored in restaurant_reservation_links. Returns [] when Supabase isn't
// configured or the table doesn't exist yet (graceful degradation).

const RESERVATION_PROVIDER_PRIORITY = {
  opentable:  1,
  resy:       2,
  sevenrooms: 3,
  tock:       4,
  yelp:       5,
  website:    6,
  phone:      7,
};

// Real booking providers always rank ahead of phone/website, even when a phone
// link is mistakenly flagged is_primary.
function bookingBucket(provider) {
  return (provider === 'opentable' || provider === 'resy'
       || provider === 'sevenrooms' || provider === 'tock'
       || provider === 'yelp') ? 0 : 1;
}

function sortReservationLinks(links) {
  return [...links].sort((a, b) => {
    const ba = bookingBucket(a.provider);
    const bb = bookingBucket(b.provider);
    if (ba !== bb) return ba - bb;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const pa = RESERVATION_PROVIDER_PRIORITY[a.provider] || 99;
    const pb = RESERVATION_PROVIDER_PRIORITY[b.provider] || 99;
    return pa - pb;
  });
}

// Heuristic: if a restaurant's "website" URL is actually a booking provider
// domain (common when restaurants set their OpenTable/Resy page as their
// public site), classify it as a reservation link. No scraping — purely
// pattern-match the URL we already have from Google Places.
function detectReservationProviderFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let host;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith('opentable.com')   || host.endsWith('opentable.co.uk')) return 'opentable';
  if (host.endsWith('resy.com'))                                            return 'resy';
  if (host.endsWith('sevenrooms.com'))                                      return 'sevenrooms';
  if (host.endsWith('exploretock.com') || host.endsWith('tocktix.com'))     return 'tock';
  if (host.endsWith('yelp.com')        || host.endsWith('yelp.to'))         return 'yelp';
  return null;
}

async function getReservationLinksForRestaurant(restaurantId) {
  if (!supabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('restaurant_reservation_links')
      .select('id, restaurant_id, provider, url, phone_number, provider_restaurant_id, is_primary, last_verified_at')
      .eq('restaurant_id', restaurantId);
    if (error) {
      // 42P01 = undefined_table (migration not yet applied). Treat as empty.
      if (error.code !== '42P01') {
        console.warn('[BiteRight] reservation_links fetch error:', error.message);
      }
      return [];
    }
    const links = (data || []).map((row) => ({
      id: row.id,
      restaurantId: row.restaurant_id,
      provider: row.provider,
      url: row.url || null,
      phoneNumber: row.phone_number || null,
      providerRestaurantId: row.provider_restaurant_id || null,
      isPrimary: !!row.is_primary,
      lastVerifiedAt: row.last_verified_at || null,
    }));
    return sortReservationLinks(links);
  } catch (err) {
    console.warn('[BiteRight] reservation_links fetch threw:', err.message);
    return [];
  }
}

const app = express();
const PORT = process.env.PORT || 4000;
const GOOGLE_PLACES_API_KEY = (process.env.GOOGLE_PLACES_API_KEY || '').trim() || undefined;
const YELP_API_KEY = process.env.YELP_API_KEY;
/** Public base URL for absolute image URLs in API responses (no trailing slash). */
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

if (!GOOGLE_PLACES_API_KEY) {
  console.warn(
    '[BiteRight backend] GOOGLE_PLACES_API_KEY is not set. Autocomplete and photo fallback will not work until you add it to server/.env',
  );
}

app.use(cors());
app.use(express.json());

// In‑memory storage (swap with a real DB later)
/** @type {Array<{
 *  restaurantId: string;
 *  placeId?: string | null;
 *  name: string;
 *  address?: string | null;
 *  city?: string | null;
 *  neighborhood?: string | null;
 *  lat?: number | null;
 *  lng?: number | null;
 *  googlePlaceId?: string | null;
 *  displayImageUrl?: string | null;
 *  displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
 *  displayImageLastResolvedAt?: string | null;
 *  displayImagePhotoReference?: string | null;
 *  websiteUrl?: string;
 *  googleMapsUrl?: string;
 *  phone?: string;
 *  reservationUrl?: string;
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
  rest_1: { name: "Lou Malnati's", address: '439 N Wells St, Chicago, IL', city: 'Chicago', neighborhood: 'River North', lat: 41.8902, lng: -87.6369, websiteUrl: 'https://www.loumalnatis.com', phone: '+1-312-828-9800' },
  rest_2: { name: 'Girl & the Goat', address: '809 W Randolph St, Chicago, IL', city: 'Chicago', neighborhood: 'West Loop', lat: 41.8815, lng: -87.6472, websiteUrl: 'https://www.girlandthegoat.com', googleMapsUrl: 'https://maps.google.com/?cid=123' },
  rest_3: { name: "Portillo's", address: '100 W Ontario St, Chicago, IL', city: 'Chicago', neighborhood: 'River North', lat: 41.8934, lng: -87.6314, websiteUrl: 'https://www.portillos.com' },
  rest_4: { name: 'The Purple Pig', address: '500 N Michigan Ave, Chicago, IL', city: 'Chicago', neighborhood: 'Magnificent Mile', lat: 41.8904, lng: -87.6242, websiteUrl: 'https://www.thepurplepigchicago.com' },
  rest_5: { name: 'Au Cheval', address: '800 W Randolph St, Chicago, IL', city: 'Chicago', neighborhood: 'West Loop', lat: 41.8845, lng: -87.6477, websiteUrl: 'https://www.aucheval.com' },
};

function getRestaurantInfoSync(restaurantId) {
  // rest_1..rest_5 are always the static Chicago list (Lou Malnati's, etc.). Prefer static over DB so Reserve/labels stay correct.
  const stat = STATIC_RESTAURANTS[restaurantId];
  if (stat) {
    const dbRow = findRestaurantById(restaurantId);
    return {
      restaurantId,
      ...stat,
      placeId: dbRow?.placeId ?? null,
      googlePlaceId: dbRow?.googlePlaceId ?? dbRow?.placeId ?? null,
      displayImageUrl: dbRow?.displayImageUrl ?? dbRow?.bestFoodPhotoUrl ?? dbRow?.fallbackPhotoUrl ?? null,
      displayImageSourceType: dbRow?.displayImageSourceType ?? 'placeholder',
      displayImageLastResolvedAt: dbRow?.displayImageLastResolvedAt ?? null,
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
    return _buildInfoFromDb(fromDb);
  }
  return null;
}

function _buildInfoFromDb(fromDb) {
  return {
    restaurantId: fromDb.restaurantId,
    placeId: fromDb.placeId || null,
    name: fromDb.name,
    address: fromDb.address || '',
    city: fromDb.city || 'Chicago',
    neighborhood: fromDb.neighborhood || null,
    lat: fromDb.lat ?? 41.88,
    lng: fromDb.lng ?? -87.63,
    googlePlaceId: fromDb.googlePlaceId || fromDb.placeId || null,
    displayImageUrl: fromDb.displayImageUrl || fromDb.bestFoodPhotoUrl || fromDb.fallbackPhotoUrl || null,
    displayImageSourceType: fromDb.displayImageSourceType || 'placeholder',
    displayImageLastResolvedAt: fromDb.displayImageLastResolvedAt || null,
    previewPhotoUrl: fromDb.displayImageUrl || fromDb.bestFoodPhotoUrl || fromDb.fallbackPhotoUrl || null,
    websiteUrl: fromDb.websiteUrl || null,
    googleMapsUrl: fromDb.googleMapsUrl || null,
    phone: fromDb.phone || null,
    reservationUrl: fromDb.reservationUrl || fromDb.websiteUrl || null,
  };
}

async function getRestaurantInfo(restaurantId) {
  // Try sync first (in-memory + static)
  const sync = getRestaurantInfoSync(restaurantId);
  if (sync) return sync;
  // Fall back to async DB lookup
  let fromDb = await db.findRestaurantById(restaurantId);
  if (!fromDb && restaurantId && String(restaurantId).startsWith('ChIJ')) {
    fromDb = await db.findRestaurantByPlaceId(restaurantId);
  }
  if (fromDb) {
    // Cache in memory for subsequent sync lookups
    if (!findRestaurantById(fromDb.restaurantId)) {
      restaurants.push(fromDb);
    }
    return _buildInfoFromDb(fromDb);
  }
  // Google passthrough: for ChIJ-prefixed (or g_-prefixed) ids that aren't in
  // our DB, synthesize an info object from Google Places Details. Lets tap
  // targets like Next-stop spots open a real detail page even before they're
  // enriched into restaurants.
  const candidatePlaceId = String(restaurantId).startsWith('g_')
    ? String(restaurantId).slice(2)
    : String(restaurantId).startsWith('ChIJ')
      ? String(restaurantId)
      : null;
  if (candidatePlaceId && GOOGLE_PLACES_API_KEY) {
    try {
      const details = await googlePlaceDetails(candidatePlaceId);
      if (details) {
        const cuisine = coalesceCuisine({
          types: details.types || [],
          name: details.name || '',
          hint: '',
        });
        return {
          restaurantId,
          placeId: candidatePlaceId,
          googlePlaceId: candidatePlaceId,
          name: details.name || 'Restaurant',
          address: details.formatted_address || '',
          city: null,
          neighborhood: null,
          lat: details.geometry?.location?.lat ?? null,
          lng: details.geometry?.location?.lng ?? null,
          cuisine,
          types: details.types || [],
          websiteUrl: details.website || null,
          googleMapsUrl: details.url || null,
          phone: details.international_phone_number || null,
          reservationUrl: null,
          priceLevel: typeof details.price_level === 'number' ? details.price_level : null,
          displayImageUrl: null,
          displayImageSourceType: null,
          displayImageLastResolvedAt: null,
        };
      }
    } catch (err) {
      console.error('[BiteRight] google passthrough failed', err?.message);
    }
  }
  return null;
}

function findRestaurantByPlaceId(placeId) {
  return restaurants.find((r) => r.placeId === placeId);
}

function findRestaurantById(id) {
  const byId = restaurants.find((r) => r.restaurantId === id);
  if (byId) return byId;
  // Fall back to placeId lookup for Google Place IDs (ChIJ...)
  if (id && String(id).startsWith('ChIJ')) {
    return findRestaurantByPlaceId(id) ?? undefined;
  }
  return undefined;
}

// Async versions that check Supabase first, then fall back to in-memory
async function findRestaurantByPlaceIdAsync(placeId) {
  const fromDb = await db.findRestaurantByPlaceId(placeId);
  if (fromDb) return fromDb;
  return findRestaurantByPlaceId(placeId) ?? null;
}

async function findRestaurantByIdAsync(id) {
  const fromDb = await db.findRestaurantById(id);
  if (fromDb) return fromDb;
  return findRestaurantById(id) ?? null;
}

const fs = require('fs');
const path = require('path');
const {
  googleFindPlaceFromText,
  buildEnrichmentQuery,
  logRestaurantImageResolution,
} = require('./restaurantEnrichment');
const {
  CURATED_RESTAURANT_IMAGE_OVERRIDES,
  clearRestaurantImageResolutionCache,
  normalizeRestaurantName,
  rankPlacePhotoCandidates,
  resolveRestaurantImage,
  selectBestPlacePhotoReference,
} = require('./utils/resolveRestaurantImage');

let loadedRestaurantEnrichment = {};
try {
  loadedRestaurantEnrichment = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'restaurantEnrichment.json'), 'utf8'),
  );
} catch (_e) {
  /* optional file */
}

let seedRestaurantHintsById = {};
try {
  const seedRows = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'seedRestaurantsForEnrichment.json'), 'utf8'),
  );
  seedRestaurantHintsById = Array.isArray(seedRows)
    ? Object.fromEntries(
        seedRows
          .filter((row) => row && typeof row.restaurantId === 'string' && row.restaurantId.trim())
          .map((row) => [row.restaurantId, row]),
      )
    : {};
} catch (_e) {
  /* optional file */
}

async function seedStaticRestaurantsIntoDb() {
  for (const restaurantId of Object.keys(STATIC_RESTAURANTS)) {
    if (findRestaurantById(restaurantId)) continue;
    const stat = STATIC_RESTAURANTS[restaurantId];
    const enc = loadedRestaurantEnrichment[restaurantId] || {};
    const placeId = enc.placeId || enc.googlePlaceId || null;
    const restaurant = {
      restaurantId,
      placeId,
      name: stat.name,
      address: stat.address || '',
      city: stat.city || 'Chicago',
      neighborhood: stat.neighborhood || null,
      lat: stat.lat,
      lng: stat.lng,
      googlePlaceId: placeId,
      displayImageUrl: null,
      displayImageSourceType: 'placeholder',
      displayImageLastResolvedAt: null,
      websiteUrl: stat.websiteUrl,
      googleMapsUrl: stat.googleMapsUrl,
      phone: stat.phone,
      reservationUrl: stat.reservationUrl || stat.websiteUrl,
      createdAt: new Date().toISOString(),
    };
    restaurants.push(restaurant);
    // Fire-and-forget upsert to Supabase (don't block startup)
    db.insertRestaurant(restaurant).catch((err) =>
      console.error('[seed] Failed to persist', restaurantId, err.message),
    );
  }
}

seedStaticRestaurantsIntoDb();

/** Skip repeated Find Place calls for ids that already failed. */
const lazyEnrichFailedIds = new Set();

// --- Google Places helpers ---------------------------------------------------

async function googlePlacesAutocomplete(query, lat, lng) {
  if (!GOOGLE_PLACES_API_KEY) return [];

  const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  const hasCoords = lat != null && lng != null && isFinite(lat) && isFinite(lng);
  const params = {
    input: query,
    key: GOOGLE_PLACES_API_KEY,
    types: 'establishment',
    ...(hasCoords
      ? { location: `${lat},${lng}`, radius: 30000 }
      : { location: '41.8781,-87.6298', radius: 50000 }),
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

  // Filter to food/drink establishments only — exclude shopping, lodging, etc.
  const FOOD_TYPES = new Set([
    'restaurant', 'food', 'meal_delivery', 'meal_takeaway',
    'cafe', 'bakery', 'bar', 'night_club',
  ]);
  const BLOCKED_TYPES = new Set([
    'shopping_mall', 'department_store', 'clothing_store', 'shoe_store',
    'electronics_store', 'furniture_store', 'hardware_store', 'home_goods_store',
    'jewelry_store', 'pet_store', 'book_store', 'convenience_store',
    'supermarket', 'grocery_or_supermarket', 'drugstore', 'pharmacy',
    'hospital', 'doctor', 'dentist', 'veterinary_care',
    'car_dealer', 'car_rental', 'car_repair', 'car_wash', 'gas_station',
    'lodging', 'real_estate_agency', 'insurance_agency', 'bank', 'atm',
    'gym', 'spa', 'beauty_salon', 'hair_care', 'laundry',
    'school', 'university', 'library', 'church', 'mosque', 'synagogue',
    'city_hall', 'courthouse', 'fire_station', 'police', 'post_office',
    'parking', 'transit_station', 'bus_station', 'train_station', 'airport',
    'travel_agency', 'movie_theater', 'amusement_park', 'stadium', 'zoo',
    'storage', 'moving_company', 'plumber', 'electrician', 'painter',
  ]);

  const filtered = predictions.filter((p) => {
    const types = p.types || [];
    // If any type is explicitly food-related, keep it
    if (types.some((t) => FOOD_TYPES.has(t))) return true;
    // If any type is explicitly non-food, drop it
    if (types.some((t) => BLOCKED_TYPES.has(t))) return false;
    // For generic establishments with no specific type, reject —
    // real restaurants almost always have a food type tag
    return false;
  });

  return filtered;
}

// ─── Popular-dishes extraction from Google reviews ──────────────────────────
// Heuristic: anchor against a food-word dictionary, then capture 1-2 lowercase
// words preceding each anchor to form a dish phrase ("spicy tuna roll", "pad
// thai", "lamb biryani"). Counts occurrences across all reviews and returns
// the top 3.
//
// Not perfect — won't catch chef-y names ("the Genovese") or pure proper-noun
// dishes — but works well for the long tail of "I had the X" mentions.
const DISH_ANCHOR_WORDS = new Set([
  'pizza', 'pasta', 'lasagna', 'ravioli', 'gnocchi', 'risotto', 'carbonara',
  'bolognese', 'alfredo', 'parmesan', 'marinara', 'scampi', 'tiramisu',
  'salad', 'soup', 'sandwich', 'burger', 'fries', 'wings', 'nuggets',
  'taco', 'tacos', 'burrito', 'quesadilla', 'enchilada', 'nachos', 'guacamole',
  'sushi', 'roll', 'rolls', 'sashimi', 'nigiri', 'tempura', 'edamame',
  'ramen', 'udon', 'soba', 'pho', 'noodle', 'noodles', 'dumpling', 'dumplings',
  'bao', 'bun', 'pancake', 'pancakes', 'waffle', 'waffles', 'omelette',
  'curry', 'tikka', 'masala', 'biryani', 'naan', 'samosa', 'pakora',
  'falafel', 'hummus', 'gyro', 'shawarma', 'kebab', 'kabob', 'tagine',
  'banh mi', 'pad thai', 'pad', 'larb', 'satay', 'spring roll',
  'bibimbap', 'bulgogi', 'kimchi', 'mandu',
  'chicken', 'beef', 'pork', 'lamb', 'duck', 'tofu',
  'shrimp', 'salmon', 'tuna', 'lobster', 'crab', 'scallop', 'oyster', 'octopus',
  'steak', 'ribs', 'brisket', 'pulled pork',
  'wrap', 'bowl', 'plate', 'platter',
  'cake', 'pie', 'cookie', 'donut', 'cannoli', 'gelato', 'churro',
  'latte', 'cappuccino', 'espresso', 'cortado', 'mocha',
  'cocktail', 'martini', 'margarita', 'sangria', 'mimosa',
]);
const STOP_PREFIX_WORDS = new Set([
  'the', 'a', 'an', 'some', 'this', 'that', 'their', 'his', 'her', 'my',
  'our', 'their', 'and', 'or', 'with', 'in', 'on', 'of', 'for', 'to', 'at',
  'is', 'was', 'were', 'are', 'be', 'so', 'very', 'really', 'so', 'just',
  'one', 'two', 'three', 'few', 'many', 'most', 'some',
  'i', 'we', 'you', 'they', 'he', 'she', 'it',
]);

function extractPopularDishesFromReviews(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return [];
  const counts = new Map();

  for (const r of reviews) {
    const text = typeof r?.text === 'string' ? r.text : '';
    if (!text) continue;
    // Normalize: lowercase, strip punctuation that breaks word boundaries.
    const norm = text.toLowerCase().replace(/[.,!?;:"()\[\]]/g, ' ');
    const tokens = norm.split(/\s+/).filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // Check single-word anchor
      if (!DISH_ANCHOR_WORDS.has(t)) {
        // Also check two-word anchors like "pad thai" / "banh mi"
        const two = tokens[i] + ' ' + (tokens[i + 1] ?? '');
        if (!DISH_ANCHOR_WORDS.has(two)) continue;
      }
      // Build dish phrase: 1-2 preceding non-stop words + anchor
      const phraseWords = [];
      const start = Math.max(0, i - 2);
      for (let j = start; j < i; j++) {
        const w = tokens[j];
        if (!w || STOP_PREFIX_WORDS.has(w) || !/^[a-z][a-z'-]*$/.test(w)) {
          phraseWords.length = 0; // reset: only take contiguous adjectives
          continue;
        }
        phraseWords.push(w);
      }
      phraseWords.push(t);
      const phrase = phraseWords.join(' ').trim();
      if (phrase.length < 3) continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  // Dedup near-duplicates and collapse generic/specific pairs.
  //
  // - Normalize hyphens + extra whitespace so "deep-dish pizza" and
  //   "deep dish pizza" merge.
  // - Group by anchor (last word). Within a group, keep the longest phrase
  //   and sum the counts of all variants — "Pizza" (3) + "Deep Dish Pizza" (3)
  //   becomes "Deep Dish Pizza" (6) rather than three near-duplicate entries.
  const normalize = (s) => s.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

  const byAnchor = new Map(); // anchor -> { name, count }
  for (const [phrase, count] of counts.entries()) {
    const normalized = normalize(phrase);
    const parts = normalized.split(' ');
    const anchor = parts[parts.length - 1];
    const existing = byAnchor.get(anchor);
    if (!existing) {
      byAnchor.set(anchor, { name: normalized, count });
    } else {
      existing.count += count;
      // Prefer the longer phrase (more specific). Tie-break by alphabetic.
      if (
        normalized.length > existing.name.length ||
        (normalized.length === existing.name.length && normalized < existing.name)
      ) {
        existing.name = normalized;
      }
    }
  }

  return Array.from(byAnchor.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(({ name, count }) => ({
      name: titleCase(name),
      mentionCount: count,
    }));
}

// ─── "What people are saying" extraction ────────────────────────────────────
// Pulls descriptor+noun phrases (e.g. "great pizza", "cozy atmosphere",
// "slow service") out of review text, counts occurrences across all reviews,
// and returns the most-mentioned phrases. Surfaces the same kind of recurring
// signal that Google's own UI highlights as keywords.
const SAYING_DESCRIPTORS = new Set([
  'great', 'amazing', 'best', 'incredible', 'wonderful', 'fantastic', 'excellent',
  'perfect', 'delicious', 'awesome', 'phenomenal', 'outstanding', 'stellar',
  'fresh', 'crispy', 'juicy', 'spicy', 'creamy', 'tender', 'flavorful', 'rich',
  'cozy', 'romantic', 'lively', 'friendly', 'welcoming', 'cute', 'charming',
  'authentic', 'casual', 'fancy', 'elegant', 'intimate', 'loud', 'quiet',
  'fast', 'quick', 'slow', 'long', 'short',
  'small', 'big', 'huge', 'large', 'generous', 'tiny',
  'cheap', 'expensive', 'pricey', 'affordable', 'reasonable', 'overpriced',
  'attentive', 'rude', 'helpful', 'knowledgeable', 'professional',
  'cold', 'hot', 'warm', 'bland', 'salty', 'bitter', 'sweet',
  'crowded', 'packed', 'busy', 'empty', 'spacious',
]);
const SAYING_NOUNS = new Set([
  'food', 'meal', 'dish', 'dishes', 'menu', 'experience', 'flavor', 'flavors',
  'service', 'staff', 'waiter', 'waitress', 'server', 'host', 'bartender',
  'atmosphere', 'vibe', 'ambiance', 'ambience', 'space', 'decor', 'patio',
  'view', 'music', 'lighting', 'interior', 'setting',
  'wait', 'line', 'reservation', 'seating', 'table', 'tables',
  'drinks', 'cocktails', 'wine', 'beer', 'coffee', 'desserts', 'dessert',
  'place', 'spot', 'restaurant', 'bar', 'cafe',
  'pizza', 'pasta', 'sushi', 'ramen', 'tacos', 'burger', 'burgers', 'salad',
  'chicken', 'steak', 'fries', 'wings', 'soup', 'noodles', 'rice',
  'portions', 'serving', 'sauce',
]);

function extractWhatPeopleAreSaying(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return [];
  const counts = new Map();

  for (const r of reviews) {
    const text = typeof r?.text === 'string' ? r.text : '';
    if (!text) continue;
    const norm = text.toLowerCase().replace(/[.,!?;:"()\[\]]/g, ' ');
    const tokens = norm.split(/\s+/).filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const noun = tokens[i];
      if (!SAYING_NOUNS.has(noun)) continue;
      // Look back up to 2 words for a descriptor. Pattern is "[descriptor] [noun]"
      // or "[descriptor] [filler] [noun]" (skipping one filler word like "the").
      const prev = tokens[i - 1];
      const prevPrev = tokens[i - 2];
      let descriptor = null;
      if (prev && SAYING_DESCRIPTORS.has(prev)) descriptor = prev;
      else if (prevPrev && SAYING_DESCRIPTORS.has(prevPrev)) descriptor = prevPrev;
      if (!descriptor) continue;
      const phrase = `${descriptor} ${noun}`;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([phrase, count]) => ({ phrase: titleCase(phrase), mentionCount: count }));
}

async function googlePlaceDetails(placeId) {
  if (!GOOGLE_PLACES_API_KEY) return null;

  const url = 'https://maps.googleapis.com/maps/api/place/details/json';
  const params = {
    place_id: placeId,
    key: GOOGLE_PLACES_API_KEY,
    fields: 'name,formatted_address,geometry,photos,website,url,international_phone_number,opening_hours,price_level,rating,user_ratings_total,reviews',
  };

  const { data } = await axios.get(url, { params });
  if (data.status !== 'OK') {
    return null;
  }
  return data.result;
}

function _mapPlaceResult(r) {
  return {
    placeId: r.place_id,
    name: r.name || '',
    address: r.vicinity || r.formatted_address || '',
    lat: r.geometry?.location?.lat ?? null,
    lng: r.geometry?.location?.lng ?? null,
    rating: typeof r.rating === 'number' ? r.rating : null,
    userRatingsTotal: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : null,
    priceLevel: typeof r.price_level === 'number' ? r.price_level : null,
    types: Array.isArray(r.types) ? r.types : [],
    photoRef: r.photos?.[0]?.photo_reference || null,
    isOpenNow: r.opening_hours?.open_now ?? null,
  };
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
  const results = list.map(_mapPlaceResult);

  // Fetch page 2 if available (doubles coverage from 20 → 40 results)
  if (data.next_page_token) {
    try {
      // Google requires a short delay before using next_page_token
      await new Promise((r) => setTimeout(r, 2000));
      const { data: page2 } = await axios.get(url, {
        params: { pagetoken: data.next_page_token, key: GOOGLE_PLACES_API_KEY },
      });
      if (page2.status === 'OK' && Array.isArray(page2.results)) {
        results.push(...page2.results.map(_mapPlaceResult));
      }
    } catch (e) {
      console.warn('[BiteRight] Nearby page 2 failed:', e.message);
    }
  }
  return results;
}

/** Text Search — better for cuisine queries in smaller towns. */
async function googlePlacesTextSearch(query, lat, lng, radiusMeters, opts = {}) {
  if (!GOOGLE_PLACES_API_KEY) return [];
  const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
  const params = {
    query,
    location: `${lat},${lng}`,
    radius: Math.max(500, Math.min(50000, Math.round(radiusMeters))),
    key: GOOGLE_PLACES_API_KEY,
  };
  // Only add type=restaurant when no specific search term — the type constraint
  // can override the keyword and return generic popular restaurants instead.
  if (!opts.skipTypeFilter) {
    params.type = 'restaurant';
  }
  const { data } = await axios.get(url, { params });
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn('[BiteRight] Text search status:', data.status, data.error_message || '');
    return [];
  }
  const list = Array.isArray(data.results) ? data.results : [];
  const results = list.map((r) => ({ ..._mapPlaceResult(r), address: r.formatted_address || r.vicinity || '' }));

  // Fetch page 2 if available
  if (data.next_page_token) {
    try {
      await new Promise((r) => setTimeout(r, 2000));
      const { data: page2 } = await axios.get(url, {
        params: { pagetoken: data.next_page_token, key: GOOGLE_PLACES_API_KEY },
      });
      if (page2.status === 'OK' && Array.isArray(page2.results)) {
        results.push(...page2.results.map((r) => ({ ..._mapPlaceResult(r), address: r.formatted_address || r.vicinity || '' })));
      }
    } catch (e) {
      console.warn('[BiteRight] Text search page 2 failed:', e.message);
    }
  }
  return results;
}

/**
 * Runs a "best [keyword]" text search to surface top-rated/popular places that
 * the standard nearby+text combo might miss. Google ranks differently for
 * "best sushi" vs "sushi restaurants".
 */
async function googlePlacesBestOfSearch(keyword, lat, lng, radiusMeters) {
  if (!GOOGLE_PLACES_API_KEY || !keyword) return [];
  const query = `best ${keyword}`;
  const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
  const params = {
    query,
    location: `${lat},${lng}`,
    radius: Math.max(500, Math.min(50000, Math.round(radiusMeters))),
    key: GOOGLE_PLACES_API_KEY,
  };
  try {
    const { data } = await axios.get(url, { params });
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
    const list = Array.isArray(data.results) ? data.results : [];
    const results = list.map((r) => ({ ..._mapPlaceResult(r), address: r.formatted_address || r.vicinity || '' }));

    // Fetch page 2 if available
    if (data.next_page_token) {
      try {
        await new Promise((r) => setTimeout(r, 2000));
        const { data: page2 } = await axios.get(url, {
          params: { pagetoken: data.next_page_token, key: GOOGLE_PLACES_API_KEY },
        });
        if (page2.status === 'OK' && Array.isArray(page2.results)) {
          results.push(...page2.results.map((r) => ({ ..._mapPlaceResult(r), address: r.formatted_address || r.vicinity || '' })));
        }
      } catch (e) {
        console.warn('[BiteRight] best-of page 2 failed:', e.message);
      }
    }
    return results;
  } catch (e) {
    console.warn('[BiteRight] best-of search failed:', e.message);
    return [];
  }
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
  'dessert_shop',
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

// Comprehensive keyword map — kept in sync with src/utils/cuisineMatch.ts
const CUISINE_NAME_KEYWORDS = [
  { re: /\b(?:italian|pizza|pasta|trattoria|osteria|ristorante|gelato|risotto|calzone|focaccia)\b/i, label: 'Italian' },
  { re: /\b(?:mexican|taco|burrito|cantina|taqueria|enchilada|quesadilla|tamale|elote|churro)\b/i, label: 'Mexican' },
  { re: /\b(?:chinese|dim sum|dumpling|wonton|szechuan|sichuan|cantonese|chow mein|kung pao|peking)\b/i, label: 'Chinese' },
  { re: /\b(?:indian|curry|biryani|tandoor|chai|nihari|desi|punjabi|gujarati|masala|naan|dosa|tikka|samosa)\b/i, label: 'Indian' },
  { re: /\b(?:japanese|sushi|ramen|izakaya|tempura|udon|soba|omakase|teriyaki|yakitori|tonkatsu|matcha)\b/i, label: 'Japanese' },
  { re: /\b(?:thai|pad thai|tom yum|satay|som tum)\b/i, label: 'Thai' },
  { re: /\b(?:korean|kimchi|korean bbq|bibimbap|bulgogi|japchae|tteokbokki|kbbq)\b/i, label: 'Korean' },
  { re: /\b(?:mediterranean|hummus|pita|tahini)\b/i, label: 'Mediterranean' },
  { re: /\b(?:greek|gyro|souvlaki|moussaka|spanakopita|baklava)\b/i, label: 'Greek' },
  { re: /\b(?:french|bistro|brasserie|crepe|patisserie|croissant|boulangerie)\b/i, label: 'French' },
  { re: /\b(?:middle eastern|lebanese|turkish|persian|shawarma|kebab|falafel|hookah|meze)\b/i, label: 'Middle Eastern' },
  { re: /\b(?:american|diner|grill|wings|cornbread)\b/i, label: 'American' },
  { re: /\b(?:asian|pan[- ]?asian|fusion)\b/i, label: 'Asian' },
  { re: /\b(?:steakhouse|steak house|chophouse|prime rib|wagyu)\b/i, label: 'Steakhouse' },
  { re: /\b(?:seafood|oyster|fish|lobster|crab|shrimp|clam|poke)\b/i, label: 'Seafood' },
  { re: /\b(?:sushi|omakase|sashimi|nigiri|maki)\b/i, label: 'Sushi' },
  { re: /\b(?:pizza|pizzeria|deep dish|neapolitan)\b/i, label: 'Pizza' },
  { re: /\b(?:burger|hamburger|smash burger)\b/i, label: 'Burgers' },
  { re: /\b(?:bbq|barbecue|smokehouse|brisket|ribs|pulled pork|smoked)\b/i, label: 'BBQ' },
  { re: /\b(?:dessert|gelato|ice cream|boba|frozen yogurt|cupcake|donut|sweets|cobbler|cookie|milkshake|pastry|cake|pie|candy|fudge|brownie|macaron)\b/i, label: 'Dessert' },
  { re: /\b(?:breakfast|pancake|waffle|omelette|eggs benedict)\b/i, label: 'Breakfast' },
  { re: /\b(?:brunch|mimosa|eggs benedict|benedict)\b/i, label: 'Brunch' },
  { re: /\b(?:vegan|plant[- ]?based)\b/i, label: 'Vegan' },
  { re: /\b(?:vegetarian|veggie)\b/i, label: 'Vegetarian' },
  { re: /\b(?:bakery|boulangerie|bread|pastry|croissant|scone)\b/i, label: 'Bakery' },
  { re: /\b(?:coffee|cafe|espresso|roast|latte|cappuccino|barista)\b/i, label: 'Coffee' },
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

  // Enrich with taxonomy parent groups (e.g. Pizza → Italian, BBQ → American)
  const taxonomyGroups = getCuisineGroups(types, name, cuisineHint);
  for (const g of taxonomyGroups) labels.add(g);

  return Array.from(labels);
}

// Centralized non-empty cuisine label. Use as the final stop on every API
// response that exposes a `cuisine` string — guarantees the client never
// has to render an empty pill. Order:
//   1. derivedCuisines from Google types + name keywords
//   2. the hint string (if it's not the generic "Restaurant")
//   3. mapFoodCategory fallback
//   4. broad type families (bar / cafe / bakery / fast food)
//   5. "Restaurant" as the last-ditch label
function coalesceCuisine({ types, name, hint }) {
  const derived = deriveCuisinesFromPlace(types || [], name || '', hint || '');
  if (derived.length) return derived[0];
  if (typeof hint === 'string' && hint.trim() && hint.trim() !== 'Restaurant') return hint.trim();
  const mapped = mapFoodCategory(types || [], name || '');
  if (mapped && mapped !== 'Restaurant') return mapped;
  const t = new Set(Array.isArray(types) ? types : []);
  if (t.has('bar') || t.has('night_club')) return 'Bar';
  if (t.has('cafe') || t.has('coffee_shop')) return 'Cafe';
  if (t.has('bakery')) return 'Bakery';
  if (t.has('meal_takeaway') || t.has('fast_food_restaurant')) return 'Takeout';
  return 'Restaurant';
}

// ── Recommended dishes by cuisine (popular picks for Tonight cards) ──────────
const CUISINE_DISHES = {
  Japanese: [
    { name: 'Omakase Nigiri', price: null, description: 'Chef\'s choice sushi selection' },
    { name: 'Spicy Tuna Roll', price: null, description: 'Fresh tuna with spicy mayo' },
    { name: 'Wagyu Tataki', price: null, description: 'Seared wagyu with ponzu' },
  ],
  Sushi: [
    { name: 'Omakase Nigiri', price: null, description: 'Chef\'s choice sushi selection' },
    { name: 'Dragon Roll', price: null, description: 'Eel and avocado with unagi sauce' },
    { name: 'Sashimi Platter', price: null, description: 'Assorted fresh-cut fish' },
  ],
  Italian: [
    { name: 'Cacio e Pepe', price: null, description: 'Roman pasta with pecorino & black pepper' },
    { name: 'Burrata', price: null, description: 'Creamy burrata with heirloom tomatoes' },
    { name: 'Osso Buco', price: null, description: 'Braised veal shank with gremolata' },
  ],
  Mexican: [
    { name: 'Al Pastor Tacos', price: null, description: 'Spit-roasted pork with pineapple' },
    { name: 'Guacamole Fresco', price: null, description: 'Tableside-prepared guacamole' },
    { name: 'Birria Quesadilla', price: null, description: 'Braised beef with consommé' },
  ],
  Chinese: [
    { name: 'Xiao Long Bao', price: null, description: 'Soup dumplings with pork filling' },
    { name: 'Mapo Tofu', price: null, description: 'Silken tofu in spicy chili sauce' },
    { name: 'Peking Duck', price: null, description: 'Roasted duck with pancakes & hoisin' },
  ],
  Indian: [
    { name: 'Butter Chicken', price: null, description: 'Tandoori chicken in tomato cream' },
    { name: 'Lamb Biryani', price: null, description: 'Fragrant basmati rice with spiced lamb' },
    { name: 'Garlic Naan', price: null, description: 'Fresh-baked garlic flatbread' },
  ],
  Thai: [
    { name: 'Pad Thai', price: null, description: 'Stir-fried rice noodles with shrimp' },
    { name: 'Green Curry', price: null, description: 'Coconut curry with Thai basil' },
    { name: 'Tom Yum Soup', price: null, description: 'Hot & sour lemongrass broth' },
  ],
  Korean: [
    { name: 'Korean BBQ Platter', price: null, description: 'Bulgogi and galbi with banchan' },
    { name: 'Bibimbap', price: null, description: 'Rice bowl with veggies and gochujang' },
    { name: 'Kimchi Jjigae', price: null, description: 'Spicy fermented cabbage stew' },
  ],
  Mediterranean: [
    { name: 'Lamb Chops', price: null, description: 'Grilled with rosemary and lemon' },
    { name: 'Hummus Platter', price: null, description: 'Classic hummus with warm pita' },
    { name: 'Grilled Octopus', price: null, description: 'Charred tentacles with olive oil' },
  ],
  American: [
    { name: 'Smash Burger', price: null, description: 'Double-stacked with American cheese' },
    { name: 'Mac & Cheese', price: null, description: 'Three-cheese blend, baked golden' },
    { name: 'BBQ Ribs', price: null, description: 'Slow-smoked with house dry rub' },
  ],
  Steakhouse: [
    { name: 'Dry-Aged Ribeye', price: null, description: '28-day aged, bone-in' },
    { name: 'Wedge Salad', price: null, description: 'Iceberg with blue cheese & bacon' },
    { name: 'Creamed Spinach', price: null, description: 'Classic steakhouse side' },
  ],
  Seafood: [
    { name: 'Lobster Roll', price: null, description: 'Butter-poached lobster on brioche' },
    { name: 'Oysters on the Half Shell', price: null, description: 'Fresh selection with mignonette' },
    { name: 'Pan-Seared Salmon', price: null, description: 'Crispy skin with lemon butter' },
  ],
  French: [
    { name: 'Steak Frites', price: null, description: 'Hanger steak with herb butter & fries' },
    { name: 'French Onion Soup', price: null, description: 'Caramelized onion with gruyère' },
    { name: 'Crème Brûlée', price: null, description: 'Classic vanilla custard, torched' },
  ],
  Pizza: [
    { name: 'Margherita', price: null, description: 'San Marzano, fresh mozzarella, basil' },
    { name: 'Pepperoni & Hot Honey', price: null, description: 'Crispy pepperoni with chili honey' },
    { name: 'Burrata Pizza', price: null, description: 'Arugula, prosciutto, burrata' },
  ],
  BBQ: [
    { name: 'Brisket Platter', price: null, description: '14-hour smoked, sliced to order' },
    { name: 'Pulled Pork Sandwich', price: null, description: 'Slow-smoked with slaw & pickles' },
    { name: 'Burnt Ends', price: null, description: 'Caramelized point-cut brisket bites' },
  ],
  Burgers: [
    { name: 'Classic Smash Burger', price: null, description: 'Double patty, cheese, pickles, sauce' },
    { name: 'Truffle Burger', price: null, description: 'Truffle aioli, gruyère, caramelized onion' },
    { name: 'Crispy Chicken Sandwich', price: null, description: 'Buttermilk-fried with slaw' },
  ],
};
/**
 * Recommended dishes for a Tonight swipe card.
 *
 * Priority (per product spec):
 *   1. Friend-logged dishes — most-mentioned standoutDish/dishes from logs
 *      authored by the swiping user OR their friends at this restaurant.
 *      Uses in-memory `logs` + `friends`; no network calls.
 *   2. Review-extracted dishes — currently SKIPPED. popularDishesFromReviews
 *      lives in /api/restaurants/:id detail responses (line 2411-ish) but
 *      isn't persisted server-side, and fetching it per swipe card would
 *      violate the "no extra network calls during pool generation" rule.
 *      A future enhancement is to cache it on the detail call (e.g. add
 *      a review_dishes column on restaurant_menus) and slot it here.
 *   3. Cached menu dishes — first N real entree-shaped items from the
 *      restaurant_menus cache, skipping drink/dessert/sauce/modifier
 *      sections. Caller passes the pre-fetched row (see batchReadCachedMenus).
 *   4. Generic cuisine fallback — the existing getRecommendedDishes map.
 *      Always returns something so cards never appear empty.
 */
function getSwipeRecommendedDishes({ restaurantId, cuisine, name, userId, logs, friends, menuRow }) {
  // 1. Friend / self dishes
  const friendDishes = collectFriendDishes({ logs, friends, userId, restaurantId });
  if (friendDishes.length > 0) return friendDishes.slice(0, 3);

  // 2. (review-extracted) — not cached; intentionally skipped here.

  // 3. Cached menu items
  const menuDishes = pickMenuDishesForSwipe(menuRow);
  if (menuDishes.length > 0) return menuDishes.slice(0, 3);

  // 4. Generic cuisine fallback
  return getRecommendedDishes(cuisine, name);
}

/** Aggregate standoutDish + dishes[] entries from the user's own and their
 *  friends' logs at this restaurant. Returned newest-mentioned-first ordered
 *  by mention count. Dedupe is case-insensitive. */
function collectFriendDishes({ logs, friends, userId, restaurantId }) {
  if (!restaurantId || !Array.isArray(logs) || logs.length === 0) return [];

  // Build the "people whose dishes count" set: self + bidirectional friends.
  // Anonymous swipes (no userId) return [] so the generic fallback wins.
  if (!userId) return [];
  const eligible = new Set([userId]);
  if (Array.isArray(friends)) {
    for (const f of friends) {
      if (!f) continue;
      if (f.userId === userId && f.friendId) eligible.add(f.friendId);
      if (f.friendId === userId && f.userId) eligible.add(f.userId);
    }
  }

  const counts = new Map();
  for (const log of logs) {
    if (!log || log.restaurantId !== restaurantId) continue;
    if (!eligible.has(log.userId)) continue;
    const candidates = [];
    if (log.standoutDish) candidates.push(log.standoutDish);
    if (Array.isArray(log.dishes)) for (const d of log.dishes) candidates.push(d);
    for (const raw of candidates) {
      const trimmed = (raw || '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!counts.has(key)) counts.set(key, { count: 0, name: trimmed });
      counts.get(key).count += 1;
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .map(({ name: dishName }) => ({ name: dishName, price: null, description: null }));
}

/** Pick up to ~3 entree-shaped items from a cached menu row. Skips obvious
 *  non-entree sections (drinks/dessert/sauce/add-ons/extras) and obvious
 *  modifier items (half/extra/side of X). */
const SWIPE_SKIP_SECTION_RE = /\b(drinks?|beverages?|bars?|cocktails?|wines?|beers?|cordials?|spirits?|amaros?|liqueurs?|champagnes?|sakes?|sauces?|condiments?|extras?|add[-\s]?ons?|toppings?|sides?|garnishes?|modifiers?|options?|desserts?|sweets?|happy\s*hour)\b/i;
const SWIPE_SKIP_ITEM_RE = /^(half|extra|add|side of|small|regular|large|no |with )/i;

function pickMenuDishesForSwipe(menuRow) {
  if (!menuRow || menuRow.scrape_status !== 'success') return [];
  const sections = menuRow.structured_data?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const seen = new Set();
  const result = [];
  for (const section of sections) {
    if (!section || !Array.isArray(section.items) || section.items.length === 0) continue;
    if (SWIPE_SKIP_SECTION_RE.test(section.title || '')) continue;
    for (const item of section.items) {
      const name = (item?.name || '').trim();
      if (!name || name.length < 2 || name.length > 80) continue;
      if (SWIPE_SKIP_ITEM_RE.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        name,
        price: item.price || null,
        description: item.description || null,
      });
      if (result.length >= 3) return result;
    }
    if (result.length >= 3) break;
  }
  return result;
}

/** Batch-read restaurant_menus rows for a list of ids in a single Supabase
 *  query. Returns Map<restaurant_id, row>. Missing or non-success rows are
 *  omitted so callers can treat absence as "no cached menu". */
async function batchReadCachedMenus(restaurantIds) {
  const map = new Map();
  if (!supabaseConfigured) return map;
  const ids = Array.from(new Set((restaurantIds || []).filter(Boolean)));
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from('restaurant_menus')
    .select('restaurant_id, structured_data, scrape_status')
    .in('restaurant_id', ids);
  if (error) {
    console.warn('[swipe-dishes] batchReadCachedMenus error', error.message);
    return map;
  }
  for (const row of data || []) {
    if (row.scrape_status === 'success') map.set(row.restaurant_id, row);
  }
  return map;
}

function getRecommendedDishes(cuisine, restaurantName) {
  const c = (cuisine || '').trim();
  // Try exact match first, then partial match on cuisine
  let dishes = CUISINE_DISHES[c];
  if (!dishes) {
    const lower = c.toLowerCase();
    for (const [key, val] of Object.entries(CUISINE_DISHES)) {
      if (key.toLowerCase() === lower || lower.includes(key.toLowerCase())) {
        dishes = val;
        break;
      }
    }
  }
  // Try inferring from restaurant name if no cuisine match
  if (!dishes && restaurantName) {
    const nameLower = restaurantName.toLowerCase();
    const nameHints = [
      [/sushi|omakase/i, 'Sushi'],
      [/pizza|pizzeria/i, 'Pizza'],
      [/burger/i, 'Burgers'],
      [/taco|taqueria|burrito/i, 'Mexican'],
      [/steak/i, 'Steakhouse'],
      [/bbq|barbecue|smokehouse/i, 'BBQ'],
      [/ramen|noodle|udon/i, 'Japanese'],
      [/thai/i, 'Thai'],
      [/pho|vietnamese/i, 'Thai'],
      [/curry|tandoori|masala/i, 'Indian'],
      [/dim sum|dumpling|wok/i, 'Chinese'],
      [/seafood|oyster|lobster|crab|fish/i, 'Seafood'],
      [/pasta|trattoria|ristorante/i, 'Italian'],
      [/bistro|brasserie|crêpe/i, 'French'],
      [/mediterranean|falafel|hummus|kebab/i, 'Mediterranean'],
      [/korean|bulgogi|bibimbap/i, 'Korean'],
    ];
    for (const [regex, key] of nameHints) {
      if (regex.test(nameLower) && CUISINE_DISHES[key]) {
        dishes = CUISINE_DISHES[key];
        break;
      }
    }
  }
  // Return empty array instead of generic placeholders — the client handles this gracefully
  return (dishes || []).slice(0, 3);
}

/** Maps Discover cuisine chip labels to Google Nearby Search keyword hints. */
// When a specific cuisine has no results in the search radius, try the next
// broader cuisine in the family. e.g. Ramen → Japanese → Asian → (any). Order
// matters: most-similar first. Empty array means stop (the chip is already a
// broad category).
const CUISINE_FALLBACK_LADDER = {
  // Japanese family
  Ramen:           ['Japanese', 'Asian'],
  Sushi:           ['Japanese', 'Asian'],
  Japanese:        ['Asian'],
  // Other Asian
  Korean:          ['Asian'],
  Thai:            ['Asian'],
  Vietnamese:      ['Asian'],
  Chinese:         ['Asian'],
  Indian:          ['Asian'],
  Asian:           [],
  // Italian family
  Pizza:           ['Italian'],
  Pasta:           ['Italian'],
  Italian:         [],
  // Mexican family
  Tacos:           ['Mexican'],
  Mexican:         [],
  // American family
  Burgers:         ['American'],
  BBQ:             ['American'],
  Steakhouse:      ['American'],
  American:        [],
  // Mediterranean family
  Greek:           ['Mediterranean'],
  'Middle Eastern':['Mediterranean'],
  Mediterranean:   [],
  // Dessert / café family
  Bakery:          ['Dessert', 'Coffee'],
  Dessert:         [],
  Coffee:          ['Brunch'],
};

function getCuisineFallbackChain(originalChip) {
  return CUISINE_FALLBACK_LADDER[originalChip] || [];
}

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
    Greek: 'greek',
    French: 'french',
    'Middle Eastern': 'middle eastern',
    American: 'american',
    Asian: 'asian',
    Steakhouse: 'steakhouse',
    Pizza: 'pizza',
    Burgers: 'burger',
    Sushi: 'sushi',
    Bakery: 'bakery',
    Dessert: 'dessert',
    Coffee: 'coffee',
    Vegetarian: 'vegetarian',
    Vegan: 'vegan',
    Brunch: 'brunch',
    Breakfast: 'breakfast',
    Seafood: 'seafood',
    BBQ: 'barbecue',
  };
  return table[c] || c.toLowerCase() || '';
}

function restaurantMatchesCuisineFilter(derivedLabels, selectedChip, restaurantName, cuisineHint) {
  if (!selectedChip || !selectedChip.trim()) return true;
  // Delegate to taxonomy-driven matching (handles parent/child rollup + keyword fallback)
  return matchesCuisineGroup(derivedLabels, selectedChip, restaurantName, cuisineHint);
}

/**
 * Pick the best food-like photo from Google Places photos array.
 * Uses aspect ratio as a heuristic: portrait/square photos (ratio ≤ 1.3) are more
 * likely to be food/dish shots; wide landscape (ratio > 1.5) are typically exterior/panorama.
 * Checks up to 5 photos and returns the best photo_reference.
 */
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
  OVERRIDE: 'override',
  USER: 'user',
  GOOGLE: 'google',
  PLACEHOLDER: 'placeholder',
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

function logImageResolve(restaurantId, extra) {
  if (process.env.NODE_ENV === 'production' && !process.env.BITERIGHT_LOG_IMAGES) return;
  const row = findRestaurantById(restaurantId);
  const stat = STATIC_RESTAURANTS[restaurantId];
  logRestaurantImageResolution({
    internalId: restaurantId,
    restaurantName: row?.name || stat?.name || restaurantId,
    googlePlaceId: row?.googlePlaceId || row?.placeId || extra?.effectivePlaceId || null,
    googlePlaceIdFound: !!(row?.googlePlaceId || row?.placeId || extra?.effectivePlaceId),
    ...extra,
  });
}

/**
 * Lazy attach place_id + Places photo ref for seeded / pool rows (no stock food imagery).
 */
async function lazyEnrichPlaceId(restaurantId) {
  if (!GOOGLE_PLACES_API_KEY || lazyEnrichFailedIds.has(restaurantId)) return null;
  const row = findRestaurantById(restaurantId);
  if (!row || row.googlePlaceId || row.placeId) return row?.googlePlaceId || row?.placeId || null;
  const stat = STATIC_RESTAURANTS[restaurantId];
  const hint = seedRestaurantHintsById[restaurantId] || stat || row;
  const query = hint
    ? buildEnrichmentQuery({
        name: hint.name,
        neighborhood: hint.neighborhood,
        city: hint.city,
        state: hint.state,
        address: hint.address,
      })
    : `${row.name || ''} ${row.address || ''}`.trim();
  if (!query) {
    lazyEnrichFailedIds.add(restaurantId);
    return null;
  }
  const pid = await googleFindPlaceFromText(
    axios,
    GOOGLE_PLACES_API_KEY,
    query,
    hint?.lat ?? row.lat,
    hint?.lng ?? row.lng,
  );
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
  row.googlePlaceId = pid;
  return pid;
}

function syncRestaurantDisplayImage(row, resolved) {
  if (!row || !resolved) return;
  row.googlePlaceId = resolved.googlePlaceId || row.googlePlaceId || row.placeId || null;
  row.placeId = row.placeId || row.googlePlaceId || null;
  row.displayImageSourceType = resolved.displayImageSourceType || 'placeholder';
  row.displayImageLastResolvedAt =
    resolved.displayImageLastResolvedAt || new Date().toISOString();
  row.displayImagePhotoReference = resolved.photoReference || null;
  if (resolved.displayImageUrl && resolved.displayImageSourceType === IMAGE_SOURCE.GOOGLE) {
    row.displayImageUrl = buildPhotoProxyUrl(row.restaurantId);
  } else if (resolved.displayImageUrl) {
    row.displayImageUrl = resolved.displayImageUrl;
  } else {
    row.displayImageUrl = null;
  }
}

/**
 * Resolve the image URL for a restaurant card. Used by Feed, Discover, Tonight, and logs.
 * Priority:
 * 1) Curated exact override
 * 2) User-uploaded/logged photo
 * 3) Cached resolved display image
 * 4) Google Places photo via googlePlaceId
 * 5) Placeholder
 * @returns {Promise<{ url: string | null; source: string; resolved: any }>}
 */
async function resolveRestaurantCardImageWithSource(restaurantId, placeId, logPreviewPhotoUrl) {
  const staticInfo = STATIC_RESTAURANTS[restaurantId];
  const fromDb = findRestaurantById(restaurantId);
  let effectivePlaceId = placeId || fromDb?.googlePlaceId || fromDb?.placeId || null;
  if (!effectivePlaceId) {
    effectivePlaceId = await lazyEnrichPlaceId(restaurantId);
  }

  const resolved = await resolveRestaurantImage(
    {
      restaurantId,
      id: restaurantId,
      name: fromDb?.name || staticInfo?.name || restaurantId,
      googlePlaceId: effectivePlaceId,
      displayImageUrl: fromDb?.displayImageUrl || null,
      displayImageSourceType: fromDb?.displayImageSourceType || null,
      displayImageLastResolvedAt: fromDb?.displayImageLastResolvedAt || null,
    },
    {
      axios,
      apiKey: GOOGLE_PLACES_API_KEY,
      cacheKey: restaurantId,
      userUploadedPhotoUrl: logPreviewPhotoUrl,
      buildGooglePhotoUrl: (_photoReference, restaurant) =>
        buildPhotoProxyUrl(restaurant.restaurantId || restaurant.id || restaurantId),
    },
  );

  if (fromDb) {
    syncRestaurantDisplayImage(fromDb, resolved);
  }

  logImageResolve(restaurantId, {
    chosenImageSourceType: resolved.displayImageSourceType,
    finalChosenImageUrl: resolved.displayImageUrl,
    placeholderUsed: resolved.placeholderUsed,
    effectivePlaceId,
    curatedOverrideMatched: !!(
      CURATED_RESTAURANT_IMAGE_OVERRIDES[restaurantId] ||
      CURATED_RESTAURANT_IMAGE_OVERRIDES[
        normalizeRestaurantName(fromDb?.name || staticInfo?.name || restaurantId)
      ]
    ),
    googleBlockedByOverride: !!resolved.blockedGoogleFallback,
  });

  return {
    url: resolved.displayImageUrl || null,
    source: resolved.displayImageSourceType,
    resolved,
  };
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

  const lat = req.query.lat != null ? parseFloat(req.query.lat) : undefined;
  const lng = req.query.lng != null ? parseFloat(req.query.lng) : undefined;

  try {
    const predictions = await googlePlacesAutocomplete(query, lat, lng);
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
    let restaurant = await findRestaurantByPlaceIdAsync(placeId);

    // Re-resolve image if existing restaurant has none (e.g. was created before Google key was set)
    if (restaurant && !restaurant.displayImageUrl && GOOGLE_PLACES_API_KEY) {
      try {
        const details = await googlePlaceDetails(placeId);
        if (details) {
          const photoRef = selectBestPlacePhotoReference(details.photos);
          if (photoRef) {
            const now = new Date().toISOString();
            restaurant.displayImageUrl = buildPhotoProxyUrl(restaurant.restaurantId);
            restaurant.displayImageSourceType = IMAGE_SOURCE.GOOGLE;
            restaurant.displayImageLastResolvedAt = now;
            restaurant.displayImagePhotoReference = photoRef;
            await db.updateRestaurant(restaurant.restaurantId, {
              displayImageUrl: restaurant.displayImageUrl,
              displayImageSourceType: restaurant.displayImageSourceType,
              displayImageLastResolvedAt: now,
              displayImagePhotoReference: photoRef,
            }).catch(() => {});
            // Clear stale caches so subsequent requests see the new image
            clearRestaurantImageResolutionCache(restaurant.restaurantId);
            lazyEnrichFailedIds.delete(restaurant.restaurantId);
            console.log('[BiteRight] Re-resolved image for', restaurant.name);
          }
        }
      } catch (e) {
        console.error('[BiteRight] Re-resolve image failed', e.message);
      }
    }

    if (!restaurant) {
      const details = await googlePlaceDetails(placeId);
      if (!details) {
        return res.status(500).json({ error: 'Failed to fetch place details' });
      }

      // rest_1..rest_5 are reserved for STATIC_RESTAURANTS (Lou Malnati's, etc.). Google-selected places start at rest_6.
      const baseId = `rest_${6 + restaurants.length}`;
      const photoRef = selectBestPlacePhotoReference(details.photos);
      const now = new Date().toISOString();

      const websiteUrl = details.website || undefined;
      restaurant = {
        restaurantId: baseId,
        placeId,
        googlePlaceId: placeId,
        name: details.name,
        address: details.formatted_address,
        lat: details.geometry?.location?.lat ?? 0,
        lng: details.geometry?.location?.lng ?? 0,
        _types: details.types || [],
        websiteUrl,
        googleMapsUrl: details.url || undefined,
        phone: details.international_phone_number || undefined,
        reservationUrl: websiteUrl,
        displayImageUrl: photoRef ? buildPhotoProxyUrl(baseId) : null,
        displayImageSourceType: photoRef ? IMAGE_SOURCE.GOOGLE : IMAGE_SOURCE.PLACEHOLDER,
        displayImageLastResolvedAt: now,
        displayImagePhotoReference: photoRef || null,
        createdAt: now,
      };

      // Persist to Supabase + in-memory
      await db.insertRestaurant(restaurant);
      restaurants.push(restaurant);
    }

    // Derive cuisine from Google types + name
    const types = restaurant._types || [];
    const cuisines = deriveCuisinesFromPlace(types, restaurant.name, '');
    const cuisine = cuisines.length > 0 ? cuisines.join(' · ') : null;

    // Extract neighborhood from address (first component before city/state)
    const addressParts = (restaurant.address || '').split(',').map((s) => s.trim());
    const neighborhood = addressParts.length >= 3 ? addressParts[addressParts.length - 3] : null;

    res.json({
      restaurantId: restaurant.restaurantId,
      placeId: restaurant.placeId,
      googlePlaceId: restaurant.googlePlaceId || restaurant.placeId || null,
      name: restaurant.name,
      address: restaurant.address,
      lat: restaurant.lat,
      lng: restaurant.lng,
      cuisine,
      neighborhood,
      displayImageUrl: restaurant.displayImageUrl || null,
      displayImageSourceType: restaurant.displayImageSourceType || IMAGE_SOURCE.PLACEHOLDER,
      displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt || null,
      fallbackPhotoUrl: restaurant.displayImageUrl || null,
    });
  } catch (err) {
    console.error('Select restaurant error', err.message);
    res.status(500).json({ error: 'Failed to upsert restaurant' });
  }
});

// 3) Logging a restaurant visit
// ─── Social tagging: friendship helpers ────────────────────────────────────
// Canonical pair ordering matches the schema's `check (user_a < user_b)`.

function friendshipKey(a, b) {
  return a < b ? { a, b } : { a: b, b: a };
}

async function areFriends(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  if (!supabaseConfigured || !supabase) return true; // dev: tolerate
  const { a, b } = friendshipKey(userIdA, userIdB);
  const { data, error } = await supabase
    .from('friendships')
    .select('status')
    .eq('user_a', a).eq('user_b', b)
    .maybeSingle();
  if (error || !data) return false;
  return data.status === 'accepted';
}

async function getActiveTagsForLog(logId) {
  if (!logId || !supabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('log_tags')
    .select('tagged_user_id')
    .eq('log_id', logId)
    .eq('status', 'active');
  if (error) {
    if (error.code !== '42P01') console.warn('[BiteRight] log_tags read error:', error.message);
    return [];
  }
  return (data || []).map((r) => ({ userId: r.tagged_user_id }));
}

/** Returns { added: [userIds], rejected: [{userId,reason}] } */
async function addTagsToLog(logId, taggedBy, candidateUserIds) {
  if (!supabaseConfigured || !supabase) return { added: [], rejected: [] };
  const unique = Array.from(new Set((candidateUserIds || [])
    .filter((u) => typeof u === 'string' && u.trim() && u !== taggedBy)));
  const added = [];
  const rejected = [];
  for (const uid of unique) {
    if (!(await areFriends(taggedBy, uid))) {
      rejected.push({ userId: uid, reason: 'not_friends' });
      continue;
    }
    const { error } = await supabase
      .from('log_tags')
      .upsert({ log_id: logId, tagged_user_id: uid, tagged_by: taggedBy, status: 'active' },
              { onConflict: 'log_id,tagged_user_id' });
    if (error) {
      rejected.push({ userId: uid, reason: error.code === '42P01' ? 'table_missing' : 'db_error' });
      continue;
    }
    added.push(uid);
  }
  return { added, rejected };
}

// GET /api/feed?scope=global — returns the most recent logs across all users,
// shaped to match the iOS FeedLog. The "scope" param is accepted for forward
// compatibility (future: scope=following filters to the requester's follow
// graph) but currently always returns the global feed.
app.get('/api/feed', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const myId = getCurrentUserId(req);
    const allLogs = await db.getAllLogs();

    // Build filter context: blocked edges (both directions), accepted
    // friendships, and per-poster visibility. Skipped when Supabase isn't
    // configured (dev mode) — feed degrades to fully open.
    const blockedIds = new Set();
    const friendIds = new Set();
    const visibilityById = new Map();

    if (supabaseConfigured && myId) {
      const [bOut, bIn] = await Promise.all([
        supabase.from('blocked_users').select('blocked_id').eq('blocker_id', myId),
        supabase.from('blocked_users').select('blocker_id').eq('blocked_id', myId),
      ]);
      bOut.data?.forEach((b) => blockedIds.add(b.blocked_id));
      bIn.data?.forEach((b) => blockedIds.add(b.blocker_id));

      const [fA, fB] = await Promise.all([
        supabase.from('friendships').select('user_b').eq('user_a', myId).eq('status', 'accepted'),
        supabase.from('friendships').select('user_a').eq('user_b', myId).eq('status', 'accepted'),
      ]);
      fA.data?.forEach((f) => friendIds.add(f.user_b));
      fB.data?.forEach((f) => friendIds.add(f.user_a));

      const posterIds = Array.from(new Set(allLogs.map((l) => l.userId).filter(Boolean)));
      if (posterIds.length > 0) {
        const { data: rows } = await supabase
          .from('users')
          .select('id, visibility')
          .in('id', posterIds);
        rows?.forEach((r) => visibilityById.set(r.id, r.visibility ?? 'public'));
      }
    }

    const visible = allLogs.filter((l) => {
      if (blockedIds.has(l.userId)) return false;
      const v = visibilityById.get(l.userId) ?? 'public';
      if (v === 'public') return true;
      if (v === 'private') return !!myId && l.userId === myId;
      // 'friends'
      return !!myId && (l.userId === myId || friendIds.has(l.userId));
    });

    const recent = visible.slice(0, limit);

    const items = await Promise.all(recent.map(async (l) => {
      const info = await getRestaurantInfo(l.restaurantId).catch(() => null);
      const standoutDishObj = l.standoutDish
        ? { label: 'Best dish', name: l.standoutDish }
        : undefined;
      return {
        id: l.id,
        userId: l.userId || null,
        userName: l.userName || 'Someone',
        restaurantId: l.restaurantId,
        restaurantName: info?.name || 'Unknown',
        cuisine: coalesceCuisine({ types: info?.types, name: info?.name, hint: info?.cuisine }),
        neighborhood: info?.neighborhood || null,
        city: info?.city || null,
        state: null,
        address: info?.address || '',
        score: l.rating,
        createdAt: l.createdAt,
        note: l.notes || undefined,
        previewPhotoUrl: l.previewPhotoUrl || undefined,
        photo_url: Array.isArray(l.photos) && l.photos.length > 0 ? l.photos[0] : null,
        standoutDish: standoutDishObj,
        standoutDishes: l.standoutDish ? [l.standoutDish] : undefined,
        dishes: l.dishes || undefined,
        vibeTags: l.vibeTags || undefined,
        quickTip: l.quickTip || null,
        highlight: l.highlight || null,
      };
    }));

    res.json(items);
  } catch (e) {
    console.error('[feed] error', e?.message);
    res.status(500).json({ error: 'feed_failed' });
  }
});

// DELETE /api/logs/:logId — author-only delete. Verifies ownership via the
// X-User-Id header rather than trusting the request blindly.
app.delete('/api/logs/:logId', async (req, res) => {
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase not configured' });
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });
  const { logId } = req.params;
  if (!logId) return res.status(400).json({ error: 'logId required' });

  const { data: existing, error: fetchErr } = await supabase
    .from('logs')
    .select('user_id')
    .eq('id', logId)
    .maybeSingle();
  if (fetchErr) {
    console.error('[logs] delete fetch error', fetchErr.message);
    return res.status(500).json({ error: 'Could not delete log' });
  }
  if (!existing) return res.status(404).json({ error: 'Log not found' });
  if (existing.user_id !== myId) {
    return res.status(403).json({ error: 'Not your log' });
  }

  const { error: delErr } = await supabase.from('logs').delete().eq('id', logId);
  if (delErr) {
    console.error('[logs] delete error', delErr.message);
    return res.status(500).json({ error: 'Could not delete log' });
  }
  // Drop from the in-memory shadow too so the next /api/feed call doesn't
  // resurrect it before Supabase reads catch up.
  const idx = logs.findIndex((l) => l.id === logId);
  if (idx !== -1) logs.splice(idx, 1);
  return res.json({ ok: true });
});

app.post('/api/logs', async (req, res) => {
  const {
    restaurantId,
    rating,
    notes,
    photos,
    userId,
    userName,
    standoutDish,
    dishes,
    vibeTags,
    quickTip,
    highlight,
    taggedUserIds,
  } = req.body || {};

  if (!restaurantId || typeof rating !== 'number') {
    return res.status(400).json({ error: 'restaurantId and numeric rating are required' });
  }

  const info = await getRestaurantInfo(restaurantId);
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
  const previewPhotoUrl = resolvedUrl && resolvedUrl.trim() ? resolvedUrl.trim() : null;
  const previewPhotoUrlAbsolute = toAbsoluteImageUrl(previewPhotoUrl);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[BiteRight] addLog image', { restaurantId, previewPhotoUrl: previewPhotoUrlAbsolute, source });
  }

  // Use a UUID-style id so concurrent submissions don't collide and so the id
  // is stable across server restarts (the prior counter restarted at 1).
  const id = `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  const log = {
    id,
    restaurantId,
    userId: typeof userId === 'string' ? userId : 'default',
    userName: typeof userName === 'string' && userName.trim() ? userName.trim() : null,
    rating,
    notes,
    photos,
    previewPhotoUrl: previewPhotoUrlAbsolute || null,
    standoutDish: typeof standoutDish === 'string' && standoutDish.trim() ? standoutDish.trim() : null,
    dishes: Array.isArray(dishes) ? dishes.filter((d) => typeof d === 'string' && d.trim()) : null,
    vibeTags: Array.isArray(vibeTags) ? vibeTags.filter((v) => typeof v === 'string') : null,
    quickTip: typeof quickTip === 'string' && quickTip.trim() ? quickTip.trim() : null,
    highlight: typeof highlight === 'string' ? highlight : null,
    createdAt,
  };

  // Persist to Supabase + in-memory
  await db.insertLog(log);
  logs.push(log);

  // Optional friend tags. Only friends are persisted; rejections are reported
  // back so the client can show a "couldn't tag X (not friends)" hint if it
  // wants. Tagging failures never block the log itself.
  let tagResult = { added: [], rejected: [] };
  if (Array.isArray(taggedUserIds) && taggedUserIds.length > 0) {
    tagResult = await addTagsToLog(id, log.userId, taggedUserIds);
  }

  res.json({
    id,
    restaurantId,
    restaurantName: info.name,
    address: info.address || '',
    lat: info.lat ?? null,
    lng: info.lng ?? null,
    userId: log.userId,
    userName: log.userName,
    rating,
    notes,
    previewPhotoUrl: previewPhotoUrlAbsolute || null,
    standoutDish: log.standoutDish,
    dishes: log.dishes,
    vibeTags: log.vibeTags,
    quickTip: log.quickTip,
    highlight: log.highlight,
    createdAt,
    taggedUserIds: tagResult.added,
    tagsRejected: tagResult.rejected,
  });
});

// ─── Social tagging endpoints ───────────────────────────────────────────────

// Add additional tags after a log was created.
app.post('/api/logs/:logId/tags', async (req, res) => {
  const { logId } = req.params;
  const { taggedUserIds, userId } = req.body || {};
  if (!Array.isArray(taggedUserIds) || taggedUserIds.length === 0) {
    return res.status(400).json({ error: 'taggedUserIds (array) is required' });
  }
  const log = logs.find((l) => l.id === logId);
  if (!log) return res.status(404).json({ error: 'Log not found' });
  if (userId && log.userId !== userId) return res.status(403).json({ error: 'Only the log author can add tags' });
  const result = await addTagsToLog(logId, log.userId, taggedUserIds);
  res.json(result);
});

// Author removes a tag.
app.delete('/api/logs/:logId/tags/:userId', async (req, res) => {
  const { logId, userId } = req.params;
  const log = logs.find((l) => l.id === logId);
  if (!log) return res.status(404).json({ error: 'Log not found' });
  if (!supabaseConfigured || !supabase) return res.json({ ok: true, status: 'in_memory_noop' });
  const { error } = await supabase
    .from('log_tags')
    .update({ status: 'removed_by_author', removed_at: new Date().toISOString() })
    .eq('log_id', logId).eq('tagged_user_id', userId).eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Tagged user removes themselves. Separate status so audit log preserves intent.
app.post('/api/logs/:logId/tags/:userId/remove-self', async (req, res) => {
  const { logId, userId } = req.params;
  if (!supabaseConfigured || !supabase) return res.json({ ok: true, status: 'in_memory_noop' });
  const { error } = await supabase
    .from('log_tags')
    .update({ status: 'removed_by_tagged', removed_at: new Date().toISOString() })
    .eq('log_id', logId).eq('tagged_user_id', userId).eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// "Dining partners" — friends ranked by # of co-visits with the requesting user.
// ─── Users system — Phase 1 of the social graph ────────────────────────────
// Identity comes from the X-User-Id header attached by the iOS client's
// request interceptor (sourced from Supabase auth). Not cryptographically
// verified yet — sufficient for TestFlight, JWT validation can layer in later.

function getCurrentUserId(req) {
  const h = req.headers['x-user-id'];
  return typeof h === 'string' && h.trim() ? h.trim() : null;
}
function getCurrentUserEmail(req) {
  const h = req.headers['x-user-email'];
  return typeof h === 'string' && h.trim() ? h.trim() : null;
}

function deriveUsernameFromEmail(email) {
  if (!email) return null;
  const prefix = email.split('@')[0] || '';
  const cleaned = prefix.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
  return cleaned || null;
}
function deriveDisplayNameFromEmail(email) {
  const u = deriveUsernameFromEmail(email);
  if (!u) return 'Someone';
  return u.charAt(0).toUpperCase() + u.slice(1);
}

/** Look up the user by id; create if missing. Used for auto-onboard on first
 *  authed request so we never have orphaned auth users with no app row. */
async function ensureUserRecord(req) {
  if (!supabaseConfigured) return null;
  const id = getCurrentUserId(req);
  if (!id) return null;
  const email = getCurrentUserEmail(req);

  const { data: existing } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (existing) return existing;

  const base = deriveUsernameFromEmail(email) || `user${id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
  const display = deriveDisplayNameFromEmail(email);
  // Retry with numeric suffix on username collision (max 10 attempts).
  for (let attempt = 0; attempt < 10; attempt++) {
    const username = attempt === 0 ? base : `${base}${attempt}`;
    const { error } = await supabase.from('users').insert({
      id, username, display_name: display, email,
    });
    if (!error) break;
    if (error.code !== '23505') {
      console.error('[users] ensureUserRecord insert error', error.message);
      return null;
    }
  }

  const { data: created } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  return created;
}

/**
 * Best-effort phone normalization to E.164. Used both when storing the
 * caller's own phone and when matching a contact list. We don't pull in
 * libphonenumber for a one-helper need — the heuristic below covers the
 * formats we actually encounter (US numbers in any presentation, plus
 * already-E.164 international numbers).
 *
 * Returns null for input that can't be sensibly normalized.
 */
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  // Already E.164-ish (8-16 chars, starts with +).
  if (cleaned.startsWith('+') && cleaned.length >= 8 && cleaned.length <= 16) {
    return cleaned;
  }
  const digits = cleaned.replace(/^\+/, '');
  // US 10-digit → +1XXXXXXXXXX.
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  // US 11-digit starting with 1 → +1XXXXXXXXXX.
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  // International 5-15 digits → prepend +.
  if (/^\d{5,15}$/.test(digits)) return `+${digits}`;
  return null;
}

function userRowToSummary(row, counts = null) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
    phone: row.phone ?? null,
    visibility: row.visibility ?? 'public',
    bio: row.bio ?? null,
    createdAt: row.created_at ?? null,
    followingCount: counts?.followingCount ?? 0,
    followerCount: counts?.followerCount ?? 0,
  };
}

async function getFollowCounts(userId) {
  if (!supabaseConfigured) return { followingCount: 0, followerCount: 0 };
  // accepted friendships involving this user, in either column
  const [{ data: asA }, { data: asB }] = await Promise.all([
    supabase.from('friendships').select('user_a').eq('user_b', userId).eq('status', 'accepted'),
    supabase.from('friendships').select('user_b').eq('user_a', userId).eq('status', 'accepted'),
  ]);
  const count = (asA?.length ?? 0) + (asB?.length ?? 0);
  // For now treat the graph as symmetric (mutual follows) — return the same
  // number for follower + following. When we add directed follows we'll split.
  return { followingCount: count, followerCount: count };
}

// GET /api/users/me — current user (auto-creates on first call).
app.get('/api/users/me', async (req, res) => {
  const me = await ensureUserRecord(req);
  if (!me) return res.status(401).json({ error: 'Not signed in' });
  const counts = await getFollowCounts(me.id);
  return res.json(userRowToSummary(me, counts));
});

// PATCH /api/users/me — edit display name and/or username. Validates length +
// username character set + case-insensitive uniqueness. Returns the updated
// record so the client can refresh state.
app.patch('/api/users/me', async (req, res) => {
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase not configured' });
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });
  // Ensure the row exists before we patch (covers users who never called /me).
  await ensureUserRecord(req);

  const { displayName, username, phone, visibility, avatarUrl } = req.body || {};
  const patch = {};
  if (typeof displayName === 'string') {
    const trimmed = displayName.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
      return res.status(400).json({ error: 'Display name must be 1–60 characters.' });
    }
    patch.display_name = trimmed;
  }
  if (typeof username === 'string') {
    const trimmed = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(trimmed)) {
      return res.status(400).json({ error: 'Username must be 3–20 chars: letters, numbers, underscores.' });
    }
    // Uniqueness — case-insensitive thanks to the index, but check explicitly
    // so we can return a friendly error rather than a 500 on the conflict.
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .ilike('username', trimmed)
      .neq('id', myId)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    patch.username = trimmed;
  }
  if (phone === null || (typeof phone === 'string' && phone.trim() === '')) {
    patch.phone = null;
  } else if (typeof phone === 'string') {
    // Normalize to E.164 so contact-matching can do exact lookups without
    // worrying about formatting variance ("(312) 555-1212" vs "312-555-1212"
    // vs "+13125551212"). Reject anything we can't normalize.
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({ error: 'That phone number doesn’t look valid.' });
    }
    patch.phone = normalized;
  }
  if (typeof visibility === 'string') {
    if (!['public', 'friends', 'private'].includes(visibility)) {
      return res.status(400).json({ error: 'Visibility must be public, friends, or private.' });
    }
    patch.visibility = visibility;
  }
  if (avatarUrl === null) {
    patch.avatar_url = null;
  } else if (typeof avatarUrl === 'string' && avatarUrl.trim()) {
    patch.avatar_url = avatarUrl.trim();
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', myId)
    .select()
    .single();
  if (error) {
    console.error('[users] patch error', error.message);
    return res.status(500).json({ error: 'Could not update profile.' });
  }
  const counts = await getFollowCounts(myId);
  return res.json(userRowToSummary(data, counts));
});

// DELETE /api/users/me — delete the user's data (users row + their logs +
// saved restaurants + friendships). The Supabase auth.users row itself is
// untouched (would require a service-role key); a subsequent login would
// auto-create a fresh users row with the same id. For TestFlight purposes
// this gives a "clean slate" experience.
app.delete('/api/users/me', async (req, res) => {
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase not configured' });
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });

  const tasks = [
    supabase.from('logs').delete().eq('user_id', myId),
    supabase.from('saved_restaurants').delete().eq('user_id', myId),
    supabase.from('friendships').delete().or(`user_a.eq.${myId},user_b.eq.${myId}`),
    supabase.from('users').delete().eq('id', myId),
  ];
  const results = await Promise.all(tasks.map((t) => t.catch((err) => ({ error: err }))));
  for (const r of results) {
    if (r?.error) console.error('[users] delete error', r.error?.message ?? r.error);
  }
  return res.json({ ok: true });
});

// GET /api/users/suggested — up to 10 users that aren't the caller.
app.get('/api/users/suggested', async (req, res) => {
  if (!supabaseConfigured) return res.json([]);
  const myId = getCurrentUserId(req);
  let query = supabase.from('users').select('*').limit(10);
  if (myId) query = query.neq('id', myId);
  const { data, error } = await query;
  if (error) {
    console.error('[users] suggested error', error.message);
    return res.json([]);
  }
  return res.json((data || []).map((r) => userRowToSummary(r)));
});

// GET /api/users?query=foo — search by username or display name.
app.get('/api/users', async (req, res) => {
  if (!supabaseConfigured) return res.json([]);
  const q = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  if (!q) return res.json([]);
  const pattern = `%${q.toLowerCase()}%`;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(20);
  if (error) {
    console.error('[users] search error', error.message);
    return res.json([]);
  }
  return res.json((data || []).map((r) => userRowToSummary(r)));
});

// POST /api/users/match-contacts — given a list of raw phone strings from
// the caller's address book, return matching users so the client can offer
// a "follow people you already know" flow. Excludes the caller themselves
// and anyone involved in a block edge (either direction). Caps at 500 input
// phones per call to keep the IN-clause sane.
app.post('/api/users/match-contacts', async (req, res) => {
  if (!supabaseConfigured) return res.json({ matches: [] });
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });
  await ensureUserRecord(req);

  const phonesIn = Array.isArray(req.body?.phones) ? req.body.phones : [];
  const normalized = [
    ...new Set(phonesIn.map((p) => normalizePhone(p)).filter(Boolean)),
  ].slice(0, 500);
  if (normalized.length === 0) return res.json({ matches: [] });

  // Pull both block directions in parallel so a blocked user (or someone
  // who blocked us) never appears in the matched-contacts list.
  const [{ data: blocksOut }, { data: blocksIn }] = await Promise.all([
    supabase.from('blocked_users').select('blocked_id').eq('blocker_id', myId),
    supabase.from('blocked_users').select('blocker_id').eq('blocked_id', myId),
  ]);
  const blocked = new Set([
    ...(blocksOut?.map((b) => b.blocked_id) ?? []),
    ...(blocksIn?.map((b) => b.blocker_id) ?? []),
  ]);

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .in('phone', normalized);
  if (error) {
    console.error('[users] match-contacts error', error.message);
    return res.status(500).json({ matches: [] });
  }

  // Build the visible match list. We don't return phones in the response —
  // the caller already has them locally; sending them back would be wasted
  // bytes and a small privacy footgun.
  const matches = (data || [])
    .filter((u) => u.id !== myId && !blocked.has(u.id))
    .map((u) => {
      const summary = userRowToSummary(u);
      return summary;
    });

  return res.json({ matches });
});

// GET /api/users/:id — look up a single user.
app.get('/api/users/:id', async (req, res) => {
  if (!supabaseConfigured) return res.status(404).json({ error: 'Not found' });
  const id = req.params.id;
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Not found' });
  const counts = await getFollowCounts(id);
  return res.json(userRowToSummary(data, counts));
});

// ─── Blocks ─────────────────────────────────────────────────────────────────
// Edges are directional (blocker → blocked); the feed filter excludes BOTH
// directions so a blocked user can't see your logs either.

// GET /api/users/me/blocked — list users I've blocked, with their summary.
app.get('/api/users/me/blocked', async (req, res) => {
  if (!supabaseConfigured) return res.json([]);
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });
  const { data: edges, error } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocker_id', myId);
  if (error || !edges || edges.length === 0) return res.json([]);
  const ids = edges.map((e) => e.blocked_id);
  const { data: rows } = await supabase.from('users').select('*').in('id', ids);
  return res.json((rows || []).map((r) => userRowToSummary(r)));
});

// POST /api/blocks/:userId — block a user. Idempotent. Also removes any
// existing follow edge so you stop showing up in each other's feeds.
app.post('/api/blocks/:userId', async (req, res) => {
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase not configured' });
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });
  const otherId = req.params.userId;
  if (!otherId || otherId === myId) return res.status(400).json({ error: 'Invalid target' });

  await Promise.all([
    supabase.from('blocked_users').upsert(
      { blocker_id: myId, blocked_id: otherId },
      { onConflict: 'blocker_id,blocked_id' },
    ),
    // Tear down any friendship between them (canonical ordering).
    (async () => {
      const [a, b] = myId < otherId ? [myId, otherId] : [otherId, myId];
      await supabase.from('friendships').delete().eq('user_a', a).eq('user_b', b);
    })(),
  ]);
  return res.json({ ok: true });
});

// DELETE /api/blocks/:userId — unblock.
app.delete('/api/blocks/:userId', async (req, res) => {
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase not configured' });
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });
  const otherId = req.params.userId;
  if (!otherId) return res.status(400).json({ error: 'Invalid target' });
  await supabase.from('blocked_users').delete()
    .eq('blocker_id', myId).eq('blocked_id', otherId);
  return res.json({ ok: true });
});

// GET /api/users/:userId/followers + /following — symmetric friendship graph.
// Returns the UserSummary for every user with an accepted friendship to the
// target. Same list for both endpoints today since edges are bidirectional.
async function getConnectedUsers(userId) {
  if (!supabaseConfigured) return [];
  const [asA, asB] = await Promise.all([
    supabase.from('friendships').select('user_b').eq('user_a', userId).eq('status', 'accepted'),
    supabase.from('friendships').select('user_a').eq('user_b', userId).eq('status', 'accepted'),
  ]);
  const ids = new Set();
  asA.data?.forEach((r) => ids.add(r.user_b));
  asB.data?.forEach((r) => ids.add(r.user_a));
  if (ids.size === 0) return [];
  const { data: rows } = await supabase.from('users').select('*').in('id', Array.from(ids));
  return (rows || []).map((r) => userRowToSummary(r));
}

app.get('/api/users/:userId/followers', async (req, res) => {
  res.json(await getConnectedUsers(req.params.userId));
});
app.get('/api/users/:userId/following', async (req, res) => {
  res.json(await getConnectedUsers(req.params.userId));
});

// GET /api/users/:userId/logs — logs authored by this user, in FeedLog shape.
// Respects the target user's visibility setting:
//   - public:  anyone can read
//   - friends: only accepted friends + the user themselves
//   - private: only the user themselves
app.get('/api/users/:userId/logs', async (req, res) => {
  try {
    const targetId = req.params.userId;
    const myId = getCurrentUserId(req);

    // Visibility check
    let visibility = 'public';
    if (supabaseConfigured) {
      const { data: row } = await supabase
        .from('users')
        .select('visibility')
        .eq('id', targetId)
        .maybeSingle();
      if (row?.visibility) visibility = row.visibility;
    }
    if (visibility === 'private' && myId !== targetId) return res.json([]);
    if (visibility === 'friends' && myId !== targetId) {
      if (!myId) return res.json([]);
      const [a, b] = myId < targetId ? [myId, targetId] : [targetId, myId];
      const { data: f } = await supabase
        .from('friendships')
        .select('status')
        .eq('user_a', a)
        .eq('user_b', b)
        .maybeSingle();
      if (f?.status !== 'accepted') return res.json([]);
    }

    const allLogs = await db.getAllLogs();
    const mine = allLogs.filter((l) => l.userId === targetId);
    const items = await Promise.all(mine.map(async (l) => {
      const info = await getRestaurantInfo(l.restaurantId).catch(() => null);
      return {
        id: l.id,
        userId: l.userId || null,
        userName: l.userName || 'Someone',
        restaurantId: l.restaurantId,
        restaurantName: info?.name || 'Unknown',
        cuisine: coalesceCuisine({ types: info?.types, name: info?.name, hint: info?.cuisine }),
        neighborhood: info?.neighborhood || null,
        city: info?.city || null,
        state: null,
        address: info?.address || '',
        score: l.rating,
        createdAt: l.createdAt,
        note: l.notes || undefined,
        previewPhotoUrl: l.previewPhotoUrl || undefined,
        photo_url: Array.isArray(l.photos) && l.photos.length > 0 ? l.photos[0] : null,
        standoutDish: l.standoutDish ? { label: 'Best dish', name: l.standoutDish } : undefined,
        standoutDishes: l.standoutDish ? [l.standoutDish] : undefined,
        dishes: l.dishes || undefined,
        vibeTags: l.vibeTags || undefined,
        quickTip: l.quickTip || null,
        highlight: l.highlight || null,
      };
    }));
    res.json(items);
  } catch (e) {
    console.error('[user-logs] error', e?.message);
    res.status(500).json({ error: 'user-logs-failed' });
  }
});

// POST /api/follows/:userId — follow another user. Symmetric for now: writes
// an accepted row to the friendships table (the existing tag system reads
// from this same table). Idempotent.
app.post('/api/follows/:userId', async (req, res) => {
  if (!supabaseConfigured) return res.status(503).json({ error: 'Supabase not configured' });
  const myId = getCurrentUserId(req);
  if (!myId) return res.status(401).json({ error: 'Not signed in' });
  const otherId = req.params.userId;
  if (!otherId || otherId === myId) return res.status(400).json({ error: 'Invalid target' });

  // Canonical ordering per friendships schema (user_a < user_b lexically).
  const [userA, userB] = myId < otherId ? [myId, otherId] : [otherId, myId];
  const { error } = await supabase
    .from('friendships')
    .upsert({
      user_a: userA,
      user_b: userB,
      status: 'accepted',
      initiated_by: myId,
      accepted_at: new Date().toISOString(),
    }, { onConflict: 'user_a,user_b' });
  if (error) {
    console.error('[follows] upsert error', error.message);
    return res.status(500).json({ error: 'Could not follow' });
  }
  return res.json({ ok: true, following: true });
});

app.get('/api/users/:userId/dining-partners', async (req, res) => {
  const { userId } = req.params;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  if (!supabaseConfigured || !supabase) return res.json({ partners: [] });
  const { data, error } = await supabase
    .from('log_tags')
    .select('tagged_user_id, log_id')
    .eq('tagged_by', userId)
    .eq('status', 'active');
  if (error) {
    if (error.code === '42P01') return res.json({ partners: [] });
    return res.status(500).json({ error: error.message });
  }
  const counts = new Map();
  for (const row of data || []) {
    counts.set(row.tagged_user_id, (counts.get(row.tagged_user_id) || 0) + 1);
  }
  const partners = Array.from(counts.entries())
    .map(([uid, count]) => ({ userId: uid, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  res.json({ partners });
});

// "Restaurants A and B visited together" — used by Profile drill-down.
app.get('/api/users/:userId/co-visits', async (req, res) => {
  const { userId } = req.params;
  const withUser = String(req.query.with || '').trim();
  if (!withUser) return res.status(400).json({ error: 'with query param is required' });
  if (!supabaseConfigured || !supabase) return res.json({ restaurants: [] });
  const { data, error } = await supabase
    .from('log_tags')
    .select('log_id, logs(restaurant_id, created_at)')
    .eq('tagged_by', userId)
    .eq('tagged_user_id', withUser)
    .eq('status', 'active');
  if (error) {
    if (error.code === '42P01') return res.json({ restaurants: [] });
    return res.status(500).json({ error: error.message });
  }
  const byRestaurant = new Map();
  for (const row of data || []) {
    const rid = row.logs?.restaurant_id;
    if (!rid) continue;
    const prev = byRestaurant.get(rid);
    const visitedAt = row.logs?.created_at;
    if (!prev) {
      byRestaurant.set(rid, { restaurantId: rid, count: 1, lastVisitedAt: visitedAt });
    } else {
      prev.count += 1;
      if (visitedAt && (!prev.lastVisitedAt || visitedAt > prev.lastVisitedAt)) {
        prev.lastVisitedAt = visitedAt;
      }
    }
  }
  const restaurants = Array.from(byRestaurant.values())
    .sort((a, b) => (b.lastVisitedAt || '').localeCompare(a.lastVisitedAt || ''));
  res.json({ restaurants });
});

// 4) Restaurant detail (for Reserve and detail view)
app.get('/api/restaurants/:restaurantId', async (req, res) => {
  const restaurantId = req.params.restaurantId;
  const info = await getRestaurantInfo(restaurantId);
  if (!info) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  const fromDb = findRestaurantById(restaurantId);
  const placeId = fromDb?.googlePlaceId ?? fromDb?.placeId ?? info.googlePlaceId ?? info.placeId ?? null;
  const debug = String(req.query.debug || '') === '1';

  // Fetch Google Places details + reservation links in parallel
  let placeDetails = null;
  let reservationLinks = [];
  await Promise.all([
    (async () => {
      if (placeId && GOOGLE_PLACES_API_KEY) {
        try {
          placeDetails = await googlePlaceDetails(placeId);
        } catch (err) {
          console.error('[BiteRight] place details fetch error', err.message);
        }
      }
    })(),
    (async () => {
      reservationLinks = await getReservationLinksForRestaurant(restaurantId);
    })(),
  ]);

  const hours = placeDetails?.opening_hours?.weekday_text || null;
  const isOpenNow = placeDetails?.opening_hours?.open_now ?? null;
  const phoneFromGoogle = placeDetails?.international_phone_number || null;
  const websiteFromGoogle = placeDetails?.website || null;
  const priceLevelFromGoogle = typeof placeDetails?.price_level === 'number' ? placeDetails.price_level : null;
  const googleRating = typeof placeDetails?.rating === 'number' ? placeDetails.rating : null;
  const googleRatingsTotal = typeof placeDetails?.user_ratings_total === 'number' ? placeDetails.user_ratings_total : null;
  // Slim the review payload — Google returns 5 reviews; we keep the 3 most
  // recent with just the fields we render. text is trimmed to 280 chars so
  // the card stays compact.
  const googleReviews = Array.isArray(placeDetails?.reviews)
    ? placeDetails.reviews.slice(0, 3).map((r) => ({
        authorName: r.author_name || 'Google user',
        rating: typeof r.rating === 'number' ? r.rating : null,
        text: typeof r.text === 'string' ? r.text.slice(0, 280) : '',
        relativeTime: r.relative_time_description || null,
      }))
    : null;

  // Popular dishes: try Claude Haiku first for high-quality extraction
  // (handles chef-y names, multi-word dishes, dedupes generic vs specific).
  // Falls back to the regex extractor when no ANTHROPIC_API_KEY is set, the
  // call fails, or the model returns nothing useful. Cached per-restaurant
  // inside menuLlm so this only fires once per review-set change.
  const reviewArrForLlm = Array.isArray(placeDetails?.reviews) ? placeDetails.reviews : [];
  let popularDishesFromReviews = null;
  try {
    popularDishesFromReviews = await extractDishesWithLLM(reviewArrForLlm, restaurantId);
  } catch (e) {
    console.warn('[detail] LLM dish extract threw', e?.message);
  }
  if (!popularDishesFromReviews || popularDishesFromReviews.length === 0) {
    popularDishesFromReviews = extractPopularDishesFromReviews(reviewArrForLlm);
  }
  // Highlight phrases — same "great pizza", "cozy atmosphere" kind of signal
  // Google surfaces in its own UI. Used for the "What people are saying"
  // section on the restaurant detail page.
  const whatPeopleAreSaying = extractWhatPeopleAreSaying(
    Array.isArray(placeDetails?.reviews) ? placeDetails.reviews : [],
  );

  // Heuristic fallback: when no curated links exist, see if the restaurant's
  // website URL is itself a booking-provider page (OpenTable / Resy / etc.).
  if (reservationLinks.length === 0) {
    const candidateUrl =
      info.reservationUrl ||
      info.websiteUrl ||
      websiteFromGoogle ||
      null;
    const detected = detectReservationProviderFromUrl(candidateUrl);
    if (detected && candidateUrl) {
      reservationLinks = [{
        id: `auto-${detected}-${restaurantId}`,
        restaurantId,
        provider: detected,
        url: candidateUrl,
        phoneNumber: null,
        providerRestaurantId: null,
        isPrimary: true,
        lastVerifiedAt: null,
      }];
    }
  }

  resolveRestaurantCardImageWithSource(restaurantId, placeId, undefined)
    .then(({ url, source, resolved }) => {
      let imageUrl = url && url.trim() ? toAbsoluteImageUrl(url.trim()) : null;

      // If resolver still returned placeholder but we have fresh Google photos, use them.
      // For non-seeded restaurants (no fromDb), use /api/place-photo?ref=… which
      // serves Google photos directly without needing a stored record — matching
      // how the Discover list resolves images for arbitrary Google Places hits.
      if (!imageUrl && placeDetails?.photos) {
        const photoRef = selectBestPlacePhotoReference(placeDetails.photos);
        if (photoRef) {
          if (fromDb) {
            fromDb.displayImagePhotoReference = photoRef;
            fromDb.displayImageUrl = buildPhotoProxyUrl(restaurantId);
            fromDb.displayImageSourceType = IMAGE_SOURCE.GOOGLE;
            fromDb.displayImageLastResolvedAt = new Date().toISOString();
            clearRestaurantImageResolutionCache(restaurantId);
            db.updateRestaurant(restaurantId, {
              displayImageUrl: fromDb.displayImageUrl,
              displayImageSourceType: fromDb.displayImageSourceType,
              displayImageLastResolvedAt: fromDb.displayImageLastResolvedAt,
              displayImagePhotoReference: photoRef,
            }).catch(() => {});
            imageUrl = toAbsoluteImageUrl(fromDb.displayImageUrl);
          } else {
            // No stored record — use the ref-keyed photo endpoint directly.
            imageUrl = toAbsoluteImageUrl(`/api/place-photo?ref=${encodeURIComponent(photoRef)}&maxW=800`);
          }
          console.log('[BiteRight] Detail endpoint re-resolved image for', info.name);
        }
      }
      res.json({
        name: info.name,
        address: info.address || placeDetails?.formatted_address || '',
        lat: info.lat ?? placeDetails?.geometry?.location?.lat ?? null,
        lng: info.lng ?? placeDetails?.geometry?.location?.lng ?? null,
        websiteUrl: info.websiteUrl || websiteFromGoogle || null,
        googleMapsUrl: info.googleMapsUrl || placeDetails?.url || null,
        phone: info.phone || phoneFromGoogle || null,
        reservationUrl: info.reservationUrl || null,
        reservationLinks,
        placeId: placeId || null,
        googlePlaceId: resolved?.googlePlaceId || placeId || null,
        displayImageUrl: imageUrl,
        displayImageSourceType: resolved?.displayImageSourceType || source || IMAGE_SOURCE.PLACEHOLDER,
        displayImageLastResolvedAt: resolved?.displayImageLastResolvedAt || null,
        previewPhotoUrl: imageUrl,
        imageUrl,
        priceLevel: info.priceLevel ?? priceLevelFromGoogle,
        neighborhood: info.neighborhood || null,
        hours,
        isOpenNow,
        googleRating,
        googleRatingsTotal,
        googleReviews,
        popularDishesFromReviews,
        whatPeopleAreSaying,
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
        websiteUrl: info.websiteUrl || websiteFromGoogle || null,
        googleMapsUrl: info.googleMapsUrl || null,
        phone: info.phone || phoneFromGoogle || null,
        reservationUrl: info.reservationUrl || null,
        reservationLinks,
        placeId: placeId || null,
        googlePlaceId: placeId || null,
        displayImageUrl: null,
        displayImageSourceType: IMAGE_SOURCE.PLACEHOLDER,
        displayImageLastResolvedAt: null,
        previewPhotoUrl: null,
        imageUrl: null,
        hours,
        isOpenNow,
        googleRating,
        googleRatingsTotal,
        googleReviews,
        popularDishesFromReviews,
        whatPeopleAreSaying,
      });
    });
});

// 5) Photo proxy (frontend can use /api/restaurants/:id/photo as an Image source)
app.get('/api/restaurants/:id/photo', async (req, res) => {
  const restaurantId = req.params.id;
  let restaurant = findRestaurantById(restaurantId);
  if (!restaurant) {
    restaurant = await db.findRestaurantById(restaurantId);
  }
  if (!restaurant && restaurantId.startsWith('ChIJ')) {
    restaurant = findRestaurantByPlaceId(restaurantId) ?? await db.findRestaurantByPlaceId(restaurantId);
  }
  if (!restaurant || !GOOGLE_PLACES_API_KEY) {
    return res.status(404).end();
  }

  // Only resolve a photo if none is stored yet (don't override user-cycled picks)
  let photoRef = restaurant.displayImagePhotoReference;
  if (!photoRef) {
    const placeId = restaurant.googlePlaceId || restaurant.placeId;
    if (placeId) {
      try {
        const details = await googlePlaceDetails(placeId);
        if (details?.photos?.length) {
          const best = selectBestPlacePhotoReference(details.photos);
          if (best) {
            photoRef = best;
            restaurant.displayImagePhotoReference = best;
            if (db) {
              db.updateRestaurant(restaurantId, { displayImagePhotoReference: best }).catch(() => {});
            }
          }
        }
      } catch (_) { /* fall through */ }
    }
  }

  if (!photoRef) {
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

// Track which ranked photo index each restaurant is using (in-memory, survives until restart)
const photoRankIndex = new Map();

// 5b) Skip current photo and cycle to the next candidate
app.post('/api/restaurants/:id/next-photo', async (req, res) => {
  const restaurantId = req.params.id;
  let restaurant = findRestaurantById(restaurantId);
  if (!restaurant) {
    restaurant = await db.findRestaurantById(restaurantId);
  }
  if (!restaurant && restaurantId.startsWith('ChIJ')) {
    restaurant = findRestaurantByPlaceId(restaurantId) ?? await db.findRestaurantByPlaceId(restaurantId);
  }
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

  const placeId = restaurant.googlePlaceId || restaurant.placeId;
  if (!placeId || !GOOGLE_PLACES_API_KEY) {
    return res.status(400).json({ error: 'No Google Place ID available' });
  }

  try {
    const details = await googlePlaceDetails(placeId);
    if (!details?.photos?.length) {
      return res.status(404).json({ error: 'No photos available from Google' });
    }

    const ranked = rankPlacePhotoCandidates(details.photos);

    // Track position via in-memory map (photo refs are ephemeral)
    const currentRankIdx = photoRankIndex.get(restaurantId) ?? 0;
    const nextIdx = (currentRankIdx + 1) % ranked.length;
    const nextRef = ranked[nextIdx]?.reference;

    if (!nextRef) {
      return res.status(404).json({ error: 'No alternative photos available' });
    }

    photoRankIndex.set(restaurantId, nextIdx);

    // Update
    const now = new Date().toISOString();
    const updates = {
      displayImagePhotoReference: nextRef,
      displayImageUrl: buildPhotoProxyUrl(restaurantId),
      displayImageSourceType: IMAGE_SOURCE.GOOGLE,
      displayImageLastResolvedAt: now,
    };
    Object.assign(restaurant, updates);

    // Also update in-memory array entry if present
    const memEntry = findRestaurantById(restaurantId);
    if (memEntry && memEntry !== restaurant) Object.assign(memEntry, updates);

    // Persist to DB
    await db.updateRestaurant(restaurantId, updates).catch(() => {});

    clearRestaurantImageResolutionCache(restaurantId);

    console.log(
      '[BiteRight] Cycled photo for %s: candidate %d/%d',
      restaurant.name || restaurantId,
      nextIdx + 1,
      ranked.length,
    );

    res.json({
      ok: true,
      restaurantId,
      photoIndex: nextIdx + 1,
      totalCandidates: ranked.length,
      imageUrl: toAbsoluteImageUrl(restaurant.displayImageUrl),
    });
  } catch (err) {
    console.error('[BiteRight] next-photo error', err.message);
    res.status(500).json({ error: 'Failed to cycle photo' });
  }
});

// Generic photo reference proxy — serves a Google Places photo by reference string
app.get('/api/place-photo', async (req, res) => {
  const ref = String(req.query.ref || '').trim();
  const maxW = Math.min(1600, Math.max(100, parseInt(req.query.maxW) || 400));
  if (!ref || !GOOGLE_PLACES_API_KEY) return res.status(404).end();
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/place/photo', {
      params: { maxwidth: maxW, photo_reference: ref, key: GOOGLE_PLACES_API_KEY },
      responseType: 'stream',
    });
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  } catch (err) {
    console.error('[BiteRight] place-photo proxy error', err.message);
    res.status(500).end();
  }
});

// ─── Menu scraping helpers ────────────────────────────────────────────────────

/** Try to find a menu link on a restaurant website. */
/**
 * Find a menu page URL from a restaurant homepage.
 * Looks for links whose href or text matches common menu patterns.
 */
function findMenuUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  const menuPatterns = /\b(menu|food|dining|our-food|eat|dishes)\b/i;
  const skipPatterns = /\b(login|signup|account|cart|checkout|contact|career|job|blog|news|press|faq|privacy|terms|instagram|facebook|twitter|yelp|doordash|ubereats|grubhub)\b/i;

  const candidates = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
    if (!href || href === '#' || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (skipPatterns.test(href)) return;

    const hrefLower = href.toLowerCase();
    const isMenuLink = menuPatterns.test(text) || menuPatterns.test(hrefLower);
    if (!isMenuLink) return;

    try {
      const resolved = new URL(href, baseUrl).href;
      // Prefer links with "menu" in the path over generic matches
      const pathScore = hrefLower.includes('/menu') ? 10 : hrefLower.includes('menu') ? 5 : 1;
      const textScore = text.includes('menu') ? 5 : 1;
      candidates.push({ url: resolved, score: pathScore + textScore });
    } catch { /* skip invalid URLs */ }
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
}

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Scrape a web page and extract structured menu items using cheerio.
 * Returns array of {title, items} sections, or null if no menu found.
 */
async function scrapeMenuFromUrl(pageUrl) {
  try {
    const { data: html } = await axios.get(pageUrl, {
      timeout: 10000,
      headers: SCRAPE_HEADERS,
      maxRedirects: 5,
      responseType: 'text',
    });
    if (typeof html !== 'string' || html.length < 100) return null;
    return parseMenuHtml(html);
  } catch (err) {
    console.error('[BiteRight] menu scrape error', pageUrl, err.message);
    return null;
  }
}

// ── Puppeteer: shared browser instance ──
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return _browser;
}

/**
 * Render a page with headless Chrome and extract the fully-rendered HTML.
 * This handles JS-rendered menus (React, Webflow, WordPress plugins, etc.).
 */
async function renderAndScrapeMenu(pageUrl) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Block images/fonts/media to speed up rendering
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 15000 });

    // Wait a bit for any late JS rendering
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => {});

    const html = await page.content();
    if (!html || html.length < 200) return null;

    const sections = parseMenuHtml(html);
    if (sections && sections.length > 0) {
      console.log('[BiteRight] menu: Puppeteer rendered successfully', { pageUrl, sections: sections.length });
    }
    return sections;
  } catch (err) {
    console.error('[BiteRight] Puppeteer scrape error', pageUrl, err.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

const PRICE_RE = /\$\s*(\d{1,4}(?:\.\d{1,2})?)/;
const SKIP_SECTION_RE = /\b(contact|location|hours|about us|reservat|order online|deliver|follow us|subscribe|newsletter|careers?|testimonial|review|gallery|photos?|privacy|terms)\b/i;

/** Detect dietary tags from text. */
/** Cap menu to a reasonable size — drop pure-drink sections and limit total. */
const DRINK_SECTION_RE = /^(cocktails?|beers?|wines?|wine list|ciders?|spirits?|beverages?|drinks?|liqueurs?|liquors?|whiskey|bourbon|vodka|tequila|rum|gin|sake|champagne|sparkling|ros[eé]|red wines?|white wines?|draft|bottled beer|house pour|scotch|brandy|cognac|armagnac|amaro|port|sherry|vermouth|mead|seltzer|sodas?|soft drinks?|non-alcoholic|mocktails?|hot drinks?|cold drinks?|coffee|tea|juice|smoothie|milkshake|happy hour|bar menu|bar bites)/i;

/**
 * Detect non-food items scraped from corporate/careers/about pages.
 * Returns true if the item name looks like junk, not a real menu item.
 */
const JUNK_ITEM_RE = /\b(career|hiring|apply|employment|invest|community|support|flexible|flexibility|pathway|scholarship|leadership|closed on|our mission|our story|our team|our values|our company|wellbeing|well-being|mental health|professional development|team member|diversity|inclusion|franchise|contact us|get in touch|download|subscribe|newsletter|privacy|terms of|follow us|connect with|social media|next stop|learn more|read more|find a location|mobile app|gift card|rewards program|sign up|log in|register|create account|amenit(y|ies)|delivery partner|other location|nearest|proud to be|membership|operator|owner)\b/i;

// Merchandise (apparel, accessories, gift sets, home goods) — restaurants
// with online shops often surface these as "menu" items when their /menu page
// links to the shop. Levain's bakery menu was getting polluted with
// "Tin Gift Set", "Tote Bag", "Mornings at Levain Candle" until this filter.
const MERCH_ITEM_RE = /\b(tin gift|gift set|gift box|gift wrap|gift bag|gift wrap|swag pack|tote bag|tote|t-?shirt|tee|hoodie|sweatshirt|sweater|crewneck|long\s?sleeve|baseball cap|trucker hat|beanie|apron|tote|mug|tumbler|water bottle|pin|sticker|magnet|patch|keychain|coaster|matchbook|candle|fragrance|perfume|cologne|body wash|soap|lotion|book|cookbook|recipe book|merchandise|merch|swag|apparel|tea towel|dish towel|napkin set|napkins set|tableware|glassware|ornament|puzzle|poster|print|art print)\b/i;

const JUNK_SECTION_RE = /\b(investing|careers?|about us|our story|community|values|leadership|team|franchise|press|media|corporate|sustainability|foundation|membership|nearest|proud to be|amenit(y|ies)|shop|store|merch(andise)?|apparel|gifts?|accessor(y|ies))\b/i;

/**
 * Looks like a person's name (e.g., "Josh Faretta") rather than a menu item.
 * Two capitalized words, no food terms. Used as additional junk signal.
 */
const PERSON_NAME_RE = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const PERSON_POSSESSIVE_RE = /^[A-Z][a-z]+'s /;

/**
 * Heuristic: does this text look like a real food item?
 * Food items usually contain food words OR have a price OR have a description.
 */
const FOOD_HINT_RE = /\b(chicken|beef|pork|lamb|fish|salmon|tuna|shrimp|crab|lobster|tofu|veggie|vegetable|salad|soup|noodle|rice|pasta|pizza|burger|sandwich|wrap|taco|burrito|quesadilla|sushi|roll|ramen|pho|curry|stew|bbq|grilled|fried|roasted|steamed|baked|sauce|cheese|bread|fries|wings|nuggets|tenders|bowl|plate|platter|special|combo|appetizer|entree|dessert|cake|pie|ice cream|smoothie|shake|bun|biscuit|waffle|pancake|omelette|egg|bacon|sausage|ham|turkey|duck|cod|tilapia|mushroom|spinach|broccoli|carrot|potato|onion|garlic|tomato|avocado|lemon|lime|herb|spice|pepper|chili|honey|maple|chocolate|vanilla|caramel|strawberry|blueberry|apple|banana|mango|coconut|almond|peanut|sesame|truffle|aioli|pesto|marinara|alfredo|teriyaki|hoisin|sriracha|kimchi|tempura|katsu|udon|soba|gyoza|edamame|miso|wasabi|nori|dim sum|bao|dumpling|wonton|spring roll|pad thai|tom yum|larb|naan|paneer|tikka|masala|biryani|samosa|falafel|hummus|kebab|shawarma|gyro|paella|tapas|risotto|gnocchi|carbonara|bolognese|lasagna|panini|focaccia|bruschetta|antipasti|prosciutto|salami|mozzarella|parmesan|gelato|tiramisu|cannoli|crepe|brioche|croissant|baguette|tart|brûlée|mousse|sorbet)\b/i;

/**
 * Validate menu quality — reject scrapes that are clearly not food menus.
 * Returns null if the menu is junk, otherwise returns the cleaned sections.
 */
function isJunkItem(item) {
  const name = item.name || '';
  const desc = item.description || '';
  if (JUNK_ITEM_RE.test(name) || JUNK_ITEM_RE.test(desc)) return true;
  if (MERCH_ITEM_RE.test(name)) return true;
  if (PERSON_NAME_RE.test(name.trim())) return true;
  if (PERSON_POSSESSIVE_RE.test(name.trim())) return true;
  return false;
}

function looksLikeFood(item) {
  const text = `${item.name || ''} ${item.description || ''}`;
  if (FOOD_HINT_RE.test(text)) return true;
  if (item.price) return true; // priced items are usually food
  return false;
}

function validateMenuQuality(sections) {
  if (!sections || sections.length === 0) return null;

  const rawTotal = sections.reduce((n, s) => n + (s.items?.length || 0), 0);

  // Step 1: always clean first. The old order rejected the whole menu when
  // junk ratio crossed 0.3 — which dumped Big Star's 15 real tacos because
  // its BentoBox scrape also surfaced "Gift Cards" / "Careers" / footer
  // chrome. Strip the junk sections + junk items, then evaluate what's
  // left rather than what we started with.
  const cleaned = sections
    .filter((s) => !JUNK_SECTION_RE.test(s.title || ''))
    .map((s) => ({
      ...s,
      items: (s.items || []).filter((item) => !isJunkItem(item)),
    }))
    .filter((s) => s.items.length > 0);

  if (cleaned.length === 0) {
    console.log('[BiteRight] menu: rejected — every item filtered as junk', { rawTotal });
    return null;
  }

  const totalRemaining = cleaned.reduce((n, s) => n + s.items.length, 0);
  const foodLooking = cleaned.flatMap((s) => s.items).filter(looksLikeFood).length;
  const foodRatio = totalRemaining > 0 ? foodLooking / totalRemaining : 0;

  // Step 2: cleaned-state thresholds. Catches corporate / about pages that
  // would otherwise sneak through with a handful of food-shaped strings.
  if (totalRemaining < 3) {
    console.log('[BiteRight] menu: rejected — too few items after cleaning', {
      rawTotal, totalRemaining,
    });
    return null;
  }
  if (foodRatio < 0.3 && totalRemaining < 8) {
    console.log('[BiteRight] menu: rejected — cleaned items still not food-looking', {
      rawTotal, totalRemaining, foodLooking, foodRatio: foodRatio.toFixed(2),
    });
    return null;
  }

  return cleaned;
}

function capMenuSections(sections) {
  if (!sections || sections.length === 0) return sections;

  // Quality gate — reject corporate/junk content
  const validated = validateMenuQuality(sections);
  if (!validated) return [];

  // Separate food from pure drink sections
  const food = [];
  const drink = [];
  for (const s of validated) {
    if (DRINK_SECTION_RE.test(s.title)) {
      drink.push(s);
    } else {
      food.push(s);
    }
  }
  // Keep all food sections, cap drink sections at 3
  const result = [...food, ...drink.slice(0, 3)];
  // Cap total sections at 20
  return result.slice(0, 20);
}

function detectDietaryTags(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const tags = [];
  if (/\b(vegetarian|veggie)\b/.test(lower)) tags.push('vegetarian');
  if (/\bvegan\b/.test(lower)) tags.push('vegan');
  if (/\b(spicy|hot pepper|chili|jalapeño|habanero)\b/.test(lower)) tags.push('spicy');
  if (/\b(gluten[\s-]?free|gf|celiac)\b/.test(lower)) tags.push('gluten-free');
  return tags.length > 0 ? tags : null;
}

/**
 * Detect and fetch menus from third-party providers embedded on the restaurant site.
 * Currently supports: SinglePlatform, Popmenu, BentoBox.
 */
async function tryThirdPartyMenuProviders(html, baseUrl) {
  const $ = cheerio.load(html);

  // ── SinglePlatform ──
  // Detected by: script src containing "singleplatform" or data-location attribute
  const spScript = $('script[src*="singleplatform"], script[id="singleplatform-menu"]');
  if (spScript.length > 0) {
    // Find the location slug from data-location on any element
    let locationSlug = null;
    $('[data-location]').each((_, el) => {
      locationSlug = $(el).attr('data-location');
    });
    // Also check the script tag itself
    if (!locationSlug) {
      locationSlug = spScript.attr('data-location');
    }

    if (locationSlug) {
      console.log('[BiteRight] menu: detected SinglePlatform embed', { locationSlug });
      try {
        const spUrl = `https://places.singleplatform.com/${encodeURIComponent(locationSlug)}/menu`;
        const { data: spHtml } = await axios.get(spUrl, {
          timeout: 10000,
          headers: SCRAPE_HEADERS,
          maxRedirects: 5,
          responseType: 'text',
        });
        if (typeof spHtml === 'string') {
          const sections = parseMenuHtml(spHtml);
          if (sections && sections.length > 0) return sections;
        }
      } catch (err) {
        console.error('[BiteRight] SinglePlatform fetch failed', err.message);
      }
    }
  }

  // ── Popmenu ──
  // Detected by: script src containing "popmenu" or meta tag
  const popmenuScript = $('script[src*="popmenu"], [data-popmenu]');
  if (popmenuScript.length > 0) {
    // Popmenu typically renders in-page but sometimes has a /menu subpage with data
    // Look for a menu link on the page
    const menuUrl = findMenuUrl(html, baseUrl);
    if (menuUrl) {
      try {
        const sections = await scrapeMenuFromUrl(menuUrl);
        if (sections && sections.length > 0) return sections;
      } catch { /* ignore */ }
    }
  }

  return null;
}

/**
 * Try to find a restaurant on SinglePlatform by name slug.
 * Generates common slug variations and checks if the page exists.
 */
async function trySinglePlatformByName(name) {
  const base = name.toLowerCase()
    .replace(/[''"]/g, '')
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Generate slug variations
  const variations = new Set([
    base,
    base.replace(/-chicago$/, ''),
    base.replace(/-restaurant$/, ''),
    base.replace(/-and-/, '--'),  // Girl & The Goat → girl--the-goat
  ]);

  for (const slug of variations) {
    try {
      const url = `https://places.singleplatform.com/${encodeURIComponent(slug)}/menu`;
      const { data: html } = await axios.get(url, {
        timeout: 6000,
        headers: SCRAPE_HEADERS,
        validateStatus: (s) => s < 500,
        responseType: 'text',
      });
      if (typeof html !== 'string' || !html.includes('ld+json')) continue;
      const sections = parseMenuHtml(html);
      if (sections && sections.length > 0) {
        console.log('[BiteRight] menu: SinglePlatform slug match', { slug });
        return sections;
      }
    } catch { /* continue to next variation */ }
  }

  return null;
}

/**
 * Extract menu from JSON-LD structured data (Schema.org).
 * Looks for @type Restaurant with hasOfferCatalog, or @type Menu.
 */
function extractMenuFromJsonLd($) {
  const sections = [];
  const jsonLdScripts = $('script[type="application/ld+json"]');
  if (jsonLdScripts.length === 0) return null;

  jsonLdScripts.each((_, script) => {
    try {
      const data = JSON.parse($(script).html());
      // Handle both single objects and arrays
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // Restaurant with hasOfferCatalog (most common pattern)
        if (item.hasOfferCatalog) {
          extractFromOfferCatalog(item.hasOfferCatalog, sections);
        }
        // Direct Menu type
        if (item['@type'] === 'Menu' && item.hasMenuSection) {
          const menuSections = Array.isArray(item.hasMenuSection) ? item.hasMenuSection : [item.hasMenuSection];
          for (const ms of menuSections) {
            extractFromMenuSection(ms, sections);
          }
        }
        // @graph array (used by some WordPress/BentoBox sites)
        if (Array.isArray(item['@graph'])) {
          for (const g of item['@graph']) {
            if (g.hasOfferCatalog) extractFromOfferCatalog(g.hasOfferCatalog, sections);
            if (g['@type'] === 'Menu' && g.hasMenuSection) {
              const ms2 = Array.isArray(g.hasMenuSection) ? g.hasMenuSection : [g.hasMenuSection];
              for (const m of ms2) extractFromMenuSection(m, sections);
            }
          }
        }
      }
    } catch { /* ignore invalid JSON-LD */ }
  });

  return sections.length > 0 ? sections : null;
}

/** Recursively extract menu items from a Schema.org OfferCatalog. */
function extractFromOfferCatalog(catalog, sections) {
  if (!catalog) return;
  const catalogs = Array.isArray(catalog) ? catalog : [catalog];

  for (const cat of catalogs) {
    const elements = cat.itemListElement;
    if (!Array.isArray(elements) || elements.length === 0) continue;

    // Check if this level contains menu items (Offers) or subcategories (OfferCatalogs)
    const hasSubCatalogs = elements.some(e => e['@type'] === 'OfferCatalog');
    const hasOffers = elements.some(e => e['@type'] === 'Offer' && e.itemOffered);

    if (hasSubCatalogs) {
      // Recurse into subcategories
      for (const sub of elements) {
        if (sub['@type'] === 'OfferCatalog') {
          extractFromOfferCatalog(sub, sections);
        }
      }
    } else if (hasOffers) {
      const sectionName = cat.name || 'Menu';
      // Skip non-food sections
      if (/surcharge|policy|corkage|disclaimer/i.test(sectionName)) return;
      if (/^(cocktails?|beer|wines?|cider|spirit|beverages?|wines? by the glass)$/i.test(sectionName)) return;

      const items = [];
      for (const offer of elements) {
        if (offer['@type'] !== 'Offer' || !offer.itemOffered) continue;
        const menuItem = offer.itemOffered;
        const name = (menuItem.name || '').trim();
        if (!name || name.length < 2) continue;

        const price = offer.price != null && offer.price !== '' && offer.price !== 0
          ? `$${parseFloat(offer.price).toFixed(2)}`
          : null;
        const description = (menuItem.description || '').trim() || null;

        items.push({
          name: name.substring(0, 80),
          description: description ? description.substring(0, 200) : null,
          price,
          tags: detectDietaryTags(`${name} ${description || ''}`),
          photoUrl: null,
        });
      }

      if (items.length > 0) {
        sections.push({ title: sectionName, items });
      }
    }
  }
}

/** Extract from Schema.org MenuSection. */
function extractFromMenuSection(menuSection, sections) {
  if (!menuSection) return;
  const name = menuSection.name || 'Menu';
  const hasMenuItem = menuSection.hasMenuItem;
  if (!Array.isArray(hasMenuItem) || hasMenuItem.length === 0) return;

  const items = [];
  for (const mi of hasMenuItem) {
    const itemName = (mi.name || '').trim();
    if (!itemName || itemName.length < 2) continue;

    const price = mi.offers?.price != null && mi.offers.price !== ''
      ? `$${parseFloat(mi.offers.price).toFixed(2)}`
      : null;
    const description = (mi.description || '').trim() || null;

    items.push({
      name: itemName.substring(0, 80),
      description: description ? description.substring(0, 200) : null,
      price,
      tags: detectDietaryTags(`${itemName} ${description || ''}`),
      photoUrl: null,
    });
  }

  if (items.length > 0) {
    sections.push({ title: name, items });
  }
}

/**
 * Try to extract menu items using multiple strategies:
 * 0. JSON-LD structured data (Schema.org Menu / OfferCatalog)
 * 1. SinglePlatform / third-party embedded menu widgets
 * 2. Elements with dedicated price classes/attributes
 * 3. Repeated item containers (cards, list items) with name + price
 * 4. Heading-based section walk
 * 5. Tables with item rows
 * 6. Last resort — any elements with prices
 */
function parseMenuHtml(html) {
  const $ = cheerio.load(html);

  // ─── Strategy 0: JSON-LD structured data ───
  // Many restaurant sites (via SinglePlatform, BentoBox, etc.) embed full menu
  // as Schema.org JSON-LD with @type Restaurant / OfferCatalog / MenuItem.
  const jsonLdSections = extractMenuFromJsonLd($);
  if (jsonLdSections && jsonLdSections.length > 0) {
    const totalItems = jsonLdSections.reduce((n, s) => n + s.items.length, 0);
    if (totalItems >= 2) return jsonLdSections;
  }

  // ─── Strategy 0b: SinglePlatform embedded widget ───
  // Detect data-location attribute for SinglePlatform and fetch their hosted page
  // (handled upstream in the endpoint, not here)

  // Remove non-content elements for HTML-based strategies
  $('style, nav, footer, header, iframe, noscript, svg, form').remove();
  $('[class*="site-footer"], [class*="site-header"], [class*="cookie-"], [class*="popup"], [class*="modal"], [id*="cookie"]').remove();

  const sections = [];
  let currentSection = { title: 'Menu', items: [] };

  // ─── Strategy 1: Look for structured menu containers ───
  // Many restaurant sites use repeated containers with a consistent structure.
  // Find elements that look like menu items by checking for price patterns nearby.

  // Gather all text nodes that contain prices, then walk up to find their container
  const priceElements = [];
  $('*').each((_, el) => {
    const $el = $(el);
    // Only look at leaf-ish elements (no children that also have prices)
    const ownText = $el.clone().children().remove().end().text().trim();
    if (PRICE_RE.test(ownText) && ownText.length < 200) {
      priceElements.push($el);
    }
  });

  // If we found price-bearing elements, try to detect menu item containers
  if (priceElements.length >= 2) {
    // Walk up from each price element to find a common container pattern
    // Group by parent to detect repeated structures
    const parentMap = new Map();
    for (const $price of priceElements) {
      // Walk up at most 4 levels to find the item container
      let $container = $price;
      for (let i = 0; i < 4; i++) {
        const $parent = $container.parent();
        if (!$parent.length || $parent.is('body, html, main, article, section')) break;

        // Check if this parent has siblings with similar structure (repeated items)
        const siblingCount = $parent.parent().children().filter((_, sib) => {
          return $(sib).prop('tagName') === $parent.prop('tagName');
        }).length;

        if (siblingCount >= 2) {
          $container = $parent;
          break;
        }
        $container = $parent;
      }

      const parentKey = $container.parent().get(0);
      if (!parentMap.has(parentKey)) parentMap.set(parentKey, []);
      parentMap.get(parentKey).push($container);
    }

    // Process the largest group of siblings (most likely the menu list)
    let bestGroup = [];
    for (const [, containers] of parentMap) {
      if (containers.length > bestGroup.length) bestGroup = containers;
    }

    // If we have a decent group, extract items from it
    if (bestGroup.length >= 2) {
      // Check for section headings above/around items
      const $listParent = bestGroup[0].parent();

      // Process each item container
      for (const $item of bestGroup) {
        const itemText = $item.text().replace(/\s+/g, ' ').trim();
        const priceMatch = itemText.match(PRICE_RE);
        if (!priceMatch) continue;

        const price = `$${parseFloat(priceMatch[1]).toFixed(2)}`;

        // Try to isolate name vs description
        // Look for a heading or bold/strong element as the item name
        const $nameEl = $item.find('h1, h2, h3, h4, h5, h6, strong, b, [class*="name"], [class*="title"], [class*="item-name"], [class*="dish"]').first();
        let name = '';
        let description = '';

        if ($nameEl.length) {
          name = $nameEl.text().replace(/\s+/g, ' ').trim();
          // Description is the remaining text minus name and price
          description = itemText
            .replace(name, '')
            .replace(priceMatch[0], '')
            .replace(/\s+/g, ' ')
            .replace(/^[\s\-–—·|]+/, '')
            .trim();
        } else {
          // Split at price — name is before, description after
          const priceIdx = itemText.indexOf(priceMatch[0]);
          const before = itemText.substring(0, priceIdx).trim();
          const after = itemText.substring(priceIdx + priceMatch[0].length).trim();

          // Name is typically the first meaningful chunk
          const lines = before.split(/[.\n|–—]/);
          name = (lines[0] || '').trim();
          description = (lines.slice(1).join('. ').trim() || after).replace(/^[\s\-–—·|]+/, '').trim();
        }

        // Clean up: remove prices that leaked into name
        name = name.replace(PRICE_RE, '').replace(/\s+/g, ' ').trim();

        if (!name || name.length < 2 || name.length > 120) continue;
        // Skip items that are clearly not food
        if (/^\d+$/.test(name) || /^(page|home|back|next|previous|copyright)/i.test(name)) continue;

        currentSection.items.push({
          name: name.substring(0, 80),
          description: description && description.length > 2 ? description.substring(0, 200) : null,
          price,
          tags: detectDietaryTags(`${name} ${description}`),
          photoUrl: null,
        });
      }
    }
  }

  // ─── Strategy 2: Heading-based section walk ───
  // Walk through headings and collect items with prices under each heading
  if (currentSection.items.length < 3) {
    // Reset — strategy 1 didn't yield enough
    currentSection = { title: 'Menu', items: [] };

    const headings = $('h1, h2, h3, h4');
    headings.each((_, heading) => {
      const $h = $(heading);
      const headingText = $h.text().replace(/\s+/g, ' ').trim();

      if (!headingText || headingText.length > 60 || headingText.length < 2) return;
      if (SKIP_SECTION_RE.test(headingText)) return;
      if (PRICE_RE.test(headingText)) return;

      // Save previous section if it has items
      if (currentSection.items.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { title: headingText, items: [] };

      // Collect siblings after this heading until the next heading
      let $next = $h.next();
      let safety = 0;
      while ($next.length && safety++ < 100) {
        const tagName = ($next.prop('tagName') || '').toLowerCase();
        if (/^h[1-4]$/.test(tagName)) break; // hit next section

        const blockText = $next.text().replace(/\s+/g, ' ').trim();

        // If this block itself contains prices, try to extract items from it
        if (PRICE_RE.test(blockText)) {
          // Check children for individual items
          const $children = $next.find('li, tr, [class*="item"], [class*="dish"], [class*="entry"], p, div');
          let extracted = false;

          if ($children.length >= 2) {
            $children.each((_, child) => {
              const childText = $(child).text().replace(/\s+/g, ' ').trim();
              const pm = childText.match(PRICE_RE);
              if (!pm || childText.length > 300) return;

              const item = extractMenuItem(childText, pm, $(child));
              if (item) {
                currentSection.items.push(item);
                extracted = true;
              }
            });
          }

          // If no children worked, try the block itself
          if (!extracted) {
            // Split by newlines or <br> to find individual items
            const innerHtml = $next.html() || '';
            const lines = innerHtml.split(/<br\s*\/?>/gi);
            for (const line of lines) {
              const lineText = cheerio.load(line).text().replace(/\s+/g, ' ').trim();
              const pm = lineText.match(PRICE_RE);
              if (pm && lineText.length < 300) {
                const item = extractMenuItemFromText(lineText, pm);
                if (item) currentSection.items.push(item);
              }
            }
          }
        }

        $next = $next.next();
      }
    });
  }

  // Push final section
  if (currentSection.items.length > 0) {
    sections.push(currentSection);
  }

  // ─── Strategy 3: Table-based menus ───
  if (sections.length === 0 || sections.reduce((n, s) => n + s.items.length, 0) < 3) {
    const tableSections = [];
    $('table').each((_, table) => {
      const $table = $(table);
      const tableSection = { title: 'Menu', items: [] };

      // Check if a heading precedes this table
      const $prev = $table.prev('h1, h2, h3, h4');
      if ($prev.length) {
        const t = $prev.text().replace(/\s+/g, ' ').trim();
        if (t.length > 1 && t.length < 60 && !SKIP_SECTION_RE.test(t)) {
          tableSection.title = t;
        }
      }

      $table.find('tr').each((_, row) => {
        const rowText = $(row).text().replace(/\s+/g, ' ').trim();
        const pm = rowText.match(PRICE_RE);
        if (!pm || rowText.length > 300) return;

        const cells = $(row).find('td, th');
        if (cells.length >= 2) {
          const name = $(cells[0]).text().replace(/\s+/g, ' ').trim();
          const priceCell = cells.toArray().find(c => PRICE_RE.test($(c).text()));
          const price = priceCell ? $(priceCell).text().match(PRICE_RE) : pm;
          const descCells = cells.toArray().filter(c => c !== cells[0] && c !== priceCell);
          const desc = descCells.map(c => $(c).text().replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').trim();

          if (name && name.length > 1 && name.length < 120 && price) {
            tableSection.items.push({
              name: name.substring(0, 80),
              description: desc && desc.length > 2 && !PRICE_RE.test(desc) ? desc.substring(0, 200) : null,
              price: `$${parseFloat(price[1]).toFixed(2)}`,
              tags: detectDietaryTags(`${name} ${desc}`),
              photoUrl: null,
            });
          }
        }
      });

      if (tableSection.items.length >= 2) tableSections.push(tableSection);
    });

    if (tableSections.length > 0) {
      // Replace previous results if table extraction found more
      const tableTotal = tableSections.reduce((n, s) => n + s.items.length, 0);
      const prevTotal = sections.reduce((n, s) => n + s.items.length, 0);
      if (tableTotal > prevTotal) {
        sections.length = 0;
        sections.push(...tableSections);
      }
    }
  }

  // ─── Strategy 4: Last resort — any elements with prices ───
  if (sections.reduce((n, s) => n + s.items.length, 0) < 3) {
    const fallbackSection = { title: 'Menu', items: [] };
    const seen = new Set();

    // Scan all leaf-level text nodes for price patterns
    $('p, li, div, span, td, dd').each((_, el) => {
      const $el = $(el);
      // Skip if this element contains children that also have prices (avoid dupes)
      if ($el.find('p, li, div, span, td, dd').filter((_, c) => PRICE_RE.test($(c).text())).length > 0) return;

      const text = $el.text().replace(/\s+/g, ' ').trim();
      const pm = text.match(PRICE_RE);
      if (!pm || text.length > 300 || text.length < 4) return;

      const item = extractMenuItemFromText(text, pm);
      if (item && !seen.has(item.name.toLowerCase())) {
        seen.add(item.name.toLowerCase());
        fallbackSection.items.push(item);
      }
    });

    if (fallbackSection.items.length >= 3) {
      const prevTotal = sections.reduce((n, s) => n + s.items.length, 0);
      if (fallbackSection.items.length > prevTotal) {
        sections.length = 0;
        sections.push(fallbackSection);
      }
    }
  }

  // ─── Strategy 5: No-price menu extraction via document-order headings ───
  // For chain restaurants that don't list prices (Lou Malnati's, Portillo's, etc.).
  // Uses heading hierarchy: larger headings (H2/H3) = sections, smaller (H4/H5/H6) = items.
  // Works even when headings are in different DOM branches (Kadence, accordion, etc.).
  if (sections.reduce((n, s) => n + s.items.length, 0) < 3) {
    const noPriceSections = [];

    // Collect all headings in document order with their level
    const allHeadings = [];
    $('h1, h2, h3, h4, h5, h6').each((_, h) => {
      const $h = $(h);
      const level = parseInt(($h.prop('tagName') || 'H6').charAt(1), 10);
      const text = $h.text().replace(/\s+/g, ' ').trim();
      if (text.length >= 2 && text.length <= 100) {
        allHeadings.push({ level, text, $el: $h });
      }
    });

    if (allHeadings.length >= 4) {
      // Determine which levels are sections vs items by counting
      const levelCounts = {};
      for (const h of allHeadings) {
        levelCounts[h.level] = (levelCounts[h.level] || 0) + 1;
      }

      // The section level has fewer entries than the item level
      const sortedLevels = Object.entries(levelCounts)
        .map(([l, c]) => ({ level: parseInt(l), count: c }))
        .filter(x => x.count >= 2)
        .sort((a, b) => a.level - b.level);

      if (sortedLevels.length >= 2) {
        // Section heading = smallest level number with fewer entries
        // Item heading = larger level number with more entries
        let sectionLevel = null;
        let itemLevel = null;

        for (let i = 0; i < sortedLevels.length - 1; i++) {
          for (let j = i + 1; j < sortedLevels.length; j++) {
            if (sortedLevels[j].count > sortedLevels[i].count) {
              sectionLevel = sortedLevels[i].level;
              itemLevel = sortedLevels[j].level;
              break;
            }
          }
          if (sectionLevel !== null) break;
        }

        if (sectionLevel !== null && itemLevel !== null) {
          let currentNpSection = null;

          for (const h of allHeadings) {
            if (SKIP_SECTION_RE.test(h.text)) continue;
            if (/^(menu|order|reservation|gift|about|contact|location|sign|log|join|app|download|follow|our company|our food|support)/i.test(h.text)) continue;

            if (h.level === sectionLevel) {
              // Save previous section
              if (currentNpSection && currentNpSection.items.length >= 2) {
                noPriceSections.push(currentNpSection);
              }
              currentNpSection = { title: h.text, items: [] };
            } else if (h.level === itemLevel && currentNpSection) {
              // This is a menu item — try to get description from nearby elements
              let desc = null;
              // Check for accordion content panel or next sibling
              const $panel = h.$el.closest('[class*="accordion-pane"], [class*="accordion-panel"]');
              if ($panel.length) {
                const panelText = $panel.find('p, [class*="content"], [class*="description"]').first().text().replace(/\s+/g, ' ').trim();
                if (panelText && panelText.length > 3 && panelText !== h.text) {
                  desc = panelText.substring(0, 200);
                }
              }
              if (!desc) {
                // Try next sibling or parent's next sibling text
                const $nextP = h.$el.nextAll('p, div').first();
                if ($nextP.length) {
                  const nextText = $nextP.text().replace(/\s+/g, ' ').trim();
                  if (nextText.length > 3 && nextText.length < 300) desc = nextText.substring(0, 200);
                }
              }

              currentNpSection.items.push({
                name: h.text.substring(0, 80),
                description: desc,
                price: null,
                tags: detectDietaryTags(`${h.text} ${desc || ''}`),
                photoUrl: null,
              });
            }
          }
          // Save last section
          if (currentNpSection && currentNpSection.items.length >= 2) {
            noPriceSections.push(currentNpSection);
          }
        }
      }
    }

    if (noPriceSections.length > 0) {
      const npTotal = noPriceSections.reduce((n, s) => n + s.items.length, 0);
      const prevTotal = sections.reduce((n, s) => n + s.items.length, 0);
      if (npTotal > prevTotal && npTotal >= 4) {
        sections.length = 0;
        sections.push(...noPriceSections);
      }
    }
  }

  // Deduplicate items within each section
  for (const section of sections) {
    const seen = new Set();
    section.items = section.items.filter(item => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Remove empty sections
  const finalSections = sections.filter(s => s.items.length > 0);
  return finalSections.length > 0 ? finalSections : null;
}

/** Extract a menu item from a DOM element + price match. */
function extractMenuItem(text, priceMatch, $el) {
  const price = `$${parseFloat(priceMatch[1]).toFixed(2)}`;

  // Try to find a name element
  const $nameEl = $el.find('h1, h2, h3, h4, h5, h6, strong, b, [class*="name"], [class*="title"]').first();
  let name = '';
  let description = '';

  if ($nameEl.length) {
    name = $nameEl.text().replace(/\s+/g, ' ').trim();
    description = text.replace(name, '').replace(priceMatch[0], '').replace(/\s+/g, ' ').replace(/^[\s\-–—·|]+/, '').trim();
  } else {
    return extractMenuItemFromText(text, priceMatch);
  }

  name = name.replace(PRICE_RE, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2 || name.length > 120) return null;
  if (/^\d+$/.test(name) || /^(page|home|back|next|copyright)/i.test(name)) return null;

  return {
    name: name.substring(0, 80),
    description: description && description.length > 2 ? description.substring(0, 200) : null,
    price,
    tags: detectDietaryTags(`${name} ${description}`),
    photoUrl: null,
  };
}

/** Extract a menu item from plain text + price match. */
function extractMenuItemFromText(text, priceMatch) {
  const price = `$${parseFloat(priceMatch[1]).toFixed(2)}`;
  const priceIdx = text.indexOf(priceMatch[0]);
  const before = text.substring(0, priceIdx).trim();
  const after = text.substring(priceIdx + priceMatch[0].length).trim();

  // Name is the first meaningful chunk before the price
  const parts = before.split(/[.\n|–—]/);
  let name = (parts[0] || '').trim();
  let description = (parts.slice(1).join('. ').trim() || after).replace(/^[\s\-–—·|]+/, '').trim();

  // If name is very short and we have after-price text, the name might be after the price
  if (name.length < 3 && after.length > 3) {
    const afterParts = after.split(/[.\n|–—]/);
    name = (afterParts[0] || '').trim();
    description = afterParts.slice(1).join('. ').trim();
  }

  name = name.replace(PRICE_RE, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2 || name.length > 120) return null;
  if (/^\d+$/.test(name) || /^(page|home|back|next|copyright)/i.test(name)) return null;

  return {
    name: name.substring(0, 80),
    description: description && description.length > 2 ? description.substring(0, 200) : null,
    price,
    tags: detectDietaryTags(`${name} ${description}`),
    photoUrl: null,
  };
}

// ─── Curated chain menus ──────────────────────────────────────────────────
// For chains whose websites don't list menus in scrape-friendly form, we
// return a curated short menu of their most popular items.
const CHAIN_MENUS = {
  'chick-fil-a': {
    sections: [
      {
        title: 'Chicken',
        items: [
          { name: 'Chick-fil-A Chicken Sandwich', description: 'Boneless breast of chicken, hand-breaded, pressure-cooked, on a toasted buttered bun with pickles', price: null, tags: null, photoUrl: null },
          { name: 'Spicy Chicken Sandwich', description: 'Same classic, with a peppery blend of seasonings for a spicy kick', price: null, tags: ['spicy'], photoUrl: null },
          { name: 'Deluxe Chicken Sandwich', description: 'Add lettuce, tomato, and American cheese', price: null, tags: null, photoUrl: null },
          { name: 'Grilled Chicken Sandwich', description: 'Lemon-herb marinated chicken on a toasted multigrain bun', price: null, tags: null, photoUrl: null },
          { name: 'Chick-fil-A Nuggets', description: 'Bite-sized pieces of boneless chicken breast, hand-breaded', price: null, tags: null, photoUrl: null },
          { name: 'Chick-n-Strips', description: 'Hand-breaded chicken tenderloins', price: null, tags: null, photoUrl: null },
        ],
      },
      {
        title: 'Sides',
        items: [
          { name: 'Waffle Potato Fries', description: 'Crispy waffle-cut fries with sea salt', price: null, tags: null, photoUrl: null },
          { name: 'Mac & Cheese', description: 'Creamy blend of cheeses baked in-restaurant', price: null, tags: ['vegetarian'], photoUrl: null },
          { name: 'Side Salad', description: 'Fresh mixed greens with grape tomatoes', price: null, tags: ['vegetarian'], photoUrl: null },
          { name: 'Fruit Cup', description: 'Mandarin oranges, apples, strawberries, and blueberries', price: null, tags: ['vegan'], photoUrl: null },
        ],
      },
      {
        title: 'Beverages & Desserts',
        items: [
          { name: 'Chick-fil-A Lemonade', description: 'Freshly-squeezed lemonade', price: null, tags: null, photoUrl: null },
          { name: 'Frosted Lemonade', description: 'Lemonade with vanilla soft-serve', price: null, tags: null, photoUrl: null },
          { name: 'Sweet Tea', description: 'Brewed fresh daily', price: null, tags: null, photoUrl: null },
          { name: 'Cookies & Cream Milkshake', description: 'Hand-spun with Oreo cookie pieces', price: null, tags: null, photoUrl: null },
          { name: 'Chocolate Chunk Cookie', description: 'Baked fresh in restaurant', price: null, tags: null, photoUrl: null },
        ],
      },
    ],
  },
  // Add more chains here as needed: mcdonalds, taco-bell, panera, etc.
};

const CHAIN_PATTERNS = [
  { re: /chick[\s-]?fil[\s-]?a/i, key: 'chick-fil-a' },
];

function getChainMenu(restaurantName) {
  if (!restaurantName) return null;
  for (const { re, key } of CHAIN_PATTERNS) {
    if (re.test(restaurantName) && CHAIN_MENUS[key]) {
      return CHAIN_MENUS[key];
    }
  }
  return null;
}

// 6) Menu endpoint — returns structured menu data, photos, or empty state
// ─── Menu cache + quality helpers ───────────────────────────────────────────
const { extractMenuFromUrl, scoreMenu, assignMenuGroups } = require('./menuExtractors');
const { extractDishesWithLLM, extractMenuFromReviewsWithLLM } = require('./menuLlm');

const MENU_QUALITY_THRESHOLD = 50;
const MENU_TTL_SUCCESS_DAYS = 30;
const MENU_TTL_LOW_QUALITY_DAYS = 7;
const MENU_TTL_FAILED_DAYS = 14;

async function readCachedMenu(restaurantId) {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase
    .from('restaurant_menus')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (error || !data) return null;
  // Note: stale rows are still returned. Callers can check
  // `next_refresh_at <= now` and decide to serve stale + refresh in
  // background (stale-while-revalidate).
  return data;
}

function isCacheFresh(row) {
  if (!row) return false;
  return new Date(row.next_refresh_at).getTime() > Date.now();
}

async function writeCachedMenu({ restaurantId, sections, sourceType, sourceUrl, pdfUrl, rawData, qualityScore, status }) {
  if (!supabaseConfigured) return;
  const ttlDays = status === 'success'
    ? MENU_TTL_SUCCESS_DAYS
    : status === 'low_quality' ? MENU_TTL_LOW_QUALITY_DAYS
    : MENU_TTL_FAILED_DAYS;
  const next = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  // supabase-js's query builder is thenable but NOT a Promise — it has no
  // .catch(). Use try/await + result.error so a write failure (e.g. FK
  // violation for ChIJ-prefixed ids not yet in the restaurants table)
  // logs and is swallowed instead of crashing the process.
  try {
    const { error } = await supabase
      .from('restaurant_menus')
      .upsert(
        {
          restaurant_id: restaurantId,
          source_type: sourceType,
          source_url: sourceUrl ?? null,
          pdf_url: pdfUrl ?? null,
          raw_data: rawData ?? null,
          structured_data: { sections: sections || [] },
          quality_score: qualityScore,
          scrape_status: status,
          scrape_attempts: 1,
          last_scraped_at: new Date().toISOString(),
          next_refresh_at: next,
        },
        { onConflict: 'restaurant_id' },
      );
    if (error) console.error('[menu-cache] write error', error.message);
  } catch (e) {
    console.error('[menu-cache] write threw', e?.message);
  }
}

app.get('/api/restaurants/:restaurantId/menu', async (req, res) => {
  const restaurantId = req.params.restaurantId;

  // ── Cache lookup (stale-while-revalidate) ──
  // Fresh, high-quality row -> serve and return.
  // Stale, high-quality row -> serve immediately AND fire background refresh.
  // Low-quality row -> serve "unavailable" without re-running on every read
  //   (TTL still gates a future re-attempt; user gets the popular-dishes
  //   fallback in the meantime).
  const cached = await readCachedMenu(restaurantId);
  if (cached && cached.scrape_status === 'success' && cached.quality_score >= MENU_QUALITY_THRESHOLD) {
    if (!isCacheFresh(cached)) {
      // Fire-and-forget background refresh; never block the response on it.
      refreshOneMenu(restaurantId).catch((e) =>
        console.error('[menu-cache] background refresh failed', restaurantId, e?.message),
      );
    }
    // Tag cached sections with menu groups on read. Legacy rows were
    // written before assignMenuGroups existed; classifying here means we
    // don't need a backfill migration — the next write picks up the group
    // field naturally.
    return res.json({
      sections: assignMenuGroups(cached.structured_data?.sections ?? []),
      menuPhotos: [],
      source: cached.source_type,
      qualityScore: cached.quality_score,
      available: true,
      lastScrapedAt: cached.last_scraped_at,
    });
  }
  if (cached && cached.scrape_status === 'low_quality' && isCacheFresh(cached)) {
    return res.json({
      sections: [], menuPhotos: [], source: null,
      qualityScore: cached.quality_score, available: false,
      lastScrapedAt: cached.last_scraped_at,
    });
  }

  const fromDb = findRestaurantById(restaurantId) || (restaurantId.startsWith('ChIJ') ? findRestaurantByPlaceId(restaurantId) : null);
  const info = await getRestaurantInfo(restaurantId);
  // If the restaurantId itself is a Google placeId (starts with ChIJ), use it directly
  const placeId = fromDb?.googlePlaceId ?? fromDb?.placeId ?? info?.googlePlaceId ?? info?.placeId
    ?? (restaurantId.startsWith('ChIJ') ? restaurantId : null);

  const result = {
    sections: [],
    menuPhotos: [],
    source: null, // 'scraped' | 'photos' | null
  };

  // Score + cache helper called by every exit path so even legacy code persists
  // and quality-gates consistently. Returns the response object.
  const finalize = async (sourceType, sourceUrl = null, rawData = null, pdfUrl = null) => {
    // Tag sections with menu groups before scoring + caching so every source
    // path (curated, providers, scrape, PDF, photo OCR, review LLM) produces
    // the same shape and the client can render group tabs uniformly.
    const sections = assignMenuGroups(result.sections || []);
    const { score } = scoreMenu(sections);
    const status =
      sections.length === 0 ? 'failed'
      : score >= MENU_QUALITY_THRESHOLD ? 'success'
      : 'low_quality';
    await writeCachedMenu({
      restaurantId,
      sections: status === 'success' ? sections : [],
      sourceType: sourceType || 'generic_scrape',
      sourceUrl,
      pdfUrl,
      rawData,
      qualityScore: score,
      status,
    });
    return {
      sections: status === 'success' ? sections : [],
      menuPhotos: result.menuPhotos ?? [],
      source: status === 'success' ? (sourceType || 'generic_scrape') : null,
      qualityScore: score,
      available: status === 'success',
      lastScrapedAt: new Date().toISOString(),
    };
  };

  // Resolve website URL and restaurant name from multiple sources
  let websiteUrl = info?.websiteUrl || fromDb?.websiteUrl || null;
  let restaurantName = info?.name || fromDb?.name || null;
  let homepageHtml = null;

  // If we have a Google placeId and API key, enrich from Google Places
  if (placeId && GOOGLE_PLACES_API_KEY) {
    try {
      const url = 'https://maps.googleapis.com/maps/api/place/details/json';
      const { data } = await axios.get(url, {
        params: {
          place_id: placeId,
          key: GOOGLE_PLACES_API_KEY,
          fields: 'name,website,url,photos',
        },
      });
      if (data.status === 'OK' && data.result) {
        const place = data.result;
        if (place.website) websiteUrl = place.website;
        if (place.name) restaurantName = place.name;
      }
    } catch (err) {
      console.log('[BiteRight] menu: Google Places lookup failed, continuing with static data', err.message);
    }
  }

  if (!websiteUrl && !restaurantName) {
    return res.json(await finalize(null));
  }

  // ── Priority 0: Curated chain menu ──
  // Many fast-food chains don't list menus on their corporate sites in
  // scrape-friendly form. For known chains, return a curated short menu.
  const chainMenu = getChainMenu(restaurantName);
  if (chainMenu) {
    result.sections = chainMenu.sections;
    result.source = 'chain_curated';
    console.log('[BiteRight] menu: using curated chain menu', { restaurantId, restaurantName });
    return res.json(await finalize('chain_curated', websiteUrl));
  }

  // ── Priority 0.5: Provider-aware extractors (Toast / Popmenu / JSON-LD / PDF) ──
  // Try the new structured-data extractors before falling through to the
  // generic scrape pipeline. Each provider parser returns the full structured
  // menu directly from the page's embedded JSON, which is dramatically more
  // reliable than DOM heuristics. The PDF pipeline is the last fallback
  // inside extractMenuFromUrl — finds linked menu PDFs and parses them.
  if (websiteUrl) {
    try {
      const extracted = await extractMenuFromUrl(websiteUrl);
      if (extracted && extracted.sections && extracted.sections.length > 0) {
        result.sections = extracted.sections;
        result.source = extracted.source;
        console.log('[BiteRight] menu: provider extractor hit', {
          restaurantId, source: extracted.source, sections: extracted.sections.length,
          pdfUrl: extracted.pdfUrl || null,
        });
        return res.json(await finalize(extracted.source, websiteUrl, extracted.rawData, extracted.pdfUrl ?? null));
      }
    } catch (e) {
      console.log('[BiteRight] menu: provider extractor failed', e?.message);
    }
  }

  try {

    // ── Priority 1: Scrape the restaurant website for structured menu ──
    if (websiteUrl) {
      console.log('[BiteRight] menu: attempting website scrape', { restaurantId, websiteUrl });
      let menuSections = null;

      // 1a. Fetch the homepage/website once — use it for JSON-LD, link finding, and provider detection
      try {
        const resp = await axios.get(websiteUrl, {
          timeout: 10000,
          headers: SCRAPE_HEADERS,
          maxRedirects: 5,
          responseType: 'text',
        });
        if (typeof resp.data === 'string') homepageHtml = resp.data;
      } catch { /* ignore */ }

      // 1b. Follow menu links found on homepage FIRST (dedicated menu page is better than homepage)
      if (homepageHtml) {
        const menuPageUrl = findMenuUrl(homepageHtml, websiteUrl);
        if (menuPageUrl && menuPageUrl !== websiteUrl) {
          console.log('[BiteRight] menu: following menu link', { menuPageUrl });
          menuSections = await scrapeMenuFromUrl(menuPageUrl);

          // If the menu link page didn't have menu items, check if it links deeper
          if (!menuSections) {
            try {
              const { data: subHtml } = await axios.get(menuPageUrl, {
                timeout: 8000,
                headers: SCRAPE_HEADERS,
                maxRedirects: 5,
                responseType: 'text',
              });
              if (typeof subHtml === 'string') {
                // Check for SinglePlatform embed on the menu page
                menuSections = await tryThirdPartyMenuProviders(subHtml, menuPageUrl);
                // Follow deeper menu links
                if (!menuSections) {
                  const deeperUrl = findMenuUrl(subHtml, menuPageUrl);
                  if (deeperUrl && deeperUrl !== menuPageUrl && deeperUrl !== websiteUrl) {
                    console.log('[BiteRight] menu: following deeper menu link', { deeperUrl });
                    menuSections = await scrapeMenuFromUrl(deeperUrl);
                  }
                }
              }
            } catch { /* ignore */ }
          }
        }
      }

      // 1c. Try common menu URL paths
      if (!menuSections) {
        const commonMenuPaths = ['/menu', '/food', '/our-menu', '/food-menu', '/dining', '/eat'];
        try {
          const origin = new URL(websiteUrl).origin;
          for (const path of commonMenuPaths) {
            const directUrl = origin + path;
            menuSections = await scrapeMenuFromUrl(directUrl);
            if (menuSections && menuSections.length > 0) {
              console.log('[BiteRight] menu: found via direct path', { directUrl });
              break;
            }
          }
        } catch { /* ignore URL parse errors */ }
      }

      // 1d. Detect third-party menu providers (SinglePlatform, Popmenu, etc.)
      if (!menuSections && homepageHtml) {
        menuSections = await tryThirdPartyMenuProviders(homepageHtml, websiteUrl);
      }

      // 1e. Try parsing the homepage itself as last resort (may have JSON-LD or inline menu)
      if (!menuSections && homepageHtml) {
        menuSections = parseMenuHtml(homepageHtml);
      }

      if (menuSections && menuSections.length > 0) {
        menuSections = capMenuSections(menuSections);
        const totalItems = menuSections.reduce((n, s) => n + s.items.length, 0);
        if (totalItems >= 2) {
          result.sections = menuSections;
          result.source = 'generic_scrape';
          console.log('[BiteRight] menu: scraped successfully', {
            restaurantId,
            sectionCount: menuSections.length,
            totalItems,
          });
          return res.json(await finalize('generic_scrape', websiteUrl));
        }
        console.log('[BiteRight] menu: scrape found too few items', { restaurantId, totalItems });
      }
    }

    // ── Priority 2: Try SinglePlatform by name as last resort ──
    // Some restaurants have data on SinglePlatform but don't embed the widget on their site.
    if (restaurantName) {
      let spSections = await trySinglePlatformByName(restaurantName);
      if (spSections && spSections.length > 0) {
        spSections = capMenuSections(spSections);
        const totalItems = spSections.reduce((n, s) => n + s.items.length, 0);
        if (totalItems >= 2) {
          result.sections = spSections;
          result.source = 'generic_scrape';
          console.log('[BiteRight] menu: found via SinglePlatform name lookup', { restaurantId, restaurantName, totalItems });
          return res.json(await finalize('generic_scrape', websiteUrl));
        }
      }
    }

    // ── Priority 3: Puppeteer (headless Chrome) for JS-rendered menus ──
    if (websiteUrl) {
      console.log('[BiteRight] menu: trying Puppeteer render', { restaurantId });

      // Try the website itself, then common menu paths
      const urlsToTry = [websiteUrl];
      try {
        const origin = new URL(websiteUrl).origin;
        urlsToTry.push(origin + '/menu', origin + '/our-menu');
        // Also add any menu link we found earlier
        if (homepageHtml) {
          const menuLink = findMenuUrl(homepageHtml, websiteUrl);
          if (menuLink && !urlsToTry.includes(menuLink)) urlsToTry.push(menuLink);
        }
      } catch { /* ignore */ }

      for (const tryUrl of urlsToTry) {
        let puppeteerSections = await renderAndScrapeMenu(tryUrl);
        if (puppeteerSections && puppeteerSections.length > 0) {
          puppeteerSections = capMenuSections(puppeteerSections);
          const totalItems = puppeteerSections.reduce((n, s) => n + s.items.length, 0);
          if (totalItems >= 2) {
            result.sections = puppeteerSections;
            result.source = 'generic_scrape';
            console.log('[BiteRight] menu: Puppeteer found menu', { restaurantId, url: tryUrl, totalItems });
            return res.json(await finalize('generic_scrape', tryUrl));
          }
        }
      }
    }

    // ── Priority 3.5: OCR menu photos from Google Places via Claude Vision ──
    // Many restaurants whose websites resist scraping (Squarespace + Webflow
    // sites, image-only menus à la Au Cheval) still have clear photos of
    // their printed menu on Google Maps. Try to OCR those before falling
    // through to the "show photos as visual backup" stage or the review-LLM
    // last resort. menuPlacePhotos caps photos per request internally to
    // keep vision-API spend bounded.
    const placePhotosModule = require('./menuPlacePhotos');
    const ocrConfigured = placePhotosModule.isConfigured();
    console.log('[BiteRight] menu: OCR stage check', {
      restaurantId,
      hasPlaceId: !!placeId,
      ocrConfigured,
    });
    if (placeId && ocrConfigured) {
      try {
        const ocrResult = await placePhotosModule.extractMenuFromPlacePhotos(placeId);
        if (ocrResult && ocrResult.sections.length > 0) {
          result.sections = ocrResult.sections;
          result.source = 'google_photo_ocr';
          console.log('[BiteRight] menu: extracted via Google photo OCR', {
            restaurantId,
            sections: ocrResult.sections.length,
            items: ocrResult.sections.reduce((n, s) => n + s.items.length, 0),
          });
          return res.json(await finalize('google_photo_ocr'));
        }
        console.log('[BiteRight] menu: OCR ran but returned no menu', { restaurantId });
      } catch (err) {
        console.log('[BiteRight] menu: google_photo_ocr failed', err.message);
      }
    }

    // ── Priority 4: Google Places menu photos as visual backup ──
    // When no structured menu is found, try to get menu-type photos from Google.
    if (placeId && GOOGLE_PLACES_API_KEY) {
      try {
        const url = 'https://maps.googleapis.com/maps/api/place/details/json';
        const { data } = await axios.get(url, {
          params: {
            place_id: placeId,
            key: GOOGLE_PLACES_API_KEY,
            fields: 'photos',
          },
        });
        if (data.status === 'OK' && data.result?.photos?.length) {
          // Google doesn't tag photos as "menu" vs "food", but we can include
          // up to 3 photos as a visual fallback the user can zoom into
          const photos = data.result.photos.slice(0, 3).map((p) => ({
            url: `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${p.photo_reference}&key=${GOOGLE_PLACES_API_KEY}`,
            width: p.width || 800,
            height: p.height || 600,
          }));
          if (photos.length > 0) {
            // Photos-only result: don't run quality scoring (no items to score),
            // but still write a row to cache so we don't refetch every request.
            result.menuPhotos = photos;
            result.source = 'photos';
            console.log('[BiteRight] menu: using Google Places photos as backup', { restaurantId, photoCount: photos.length });
            return res.json({
              sections: [], menuPhotos: photos, source: 'photos',
              qualityScore: 0, available: false,
              lastScrapedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.log('[BiteRight] menu: Google photos fallback failed', err.message);
      }
    }

    // ── Priority 5: LLM-inferred menu from review text (last resort) ──
    // When every real-source extractor has failed, ask Claude Haiku to infer
    // a conservative menu from Google review text. Marked source 'llm' so
    // the cache row records its provenance. Only runs when ANTHROPIC_API_KEY
    // is configured; otherwise we skip straight to the no-menu state.
    if (placeId && GOOGLE_PLACES_API_KEY && process.env.ANTHROPIC_API_KEY) {
      try {
        // Need to fetch reviews; the earlier Google Places call asked only
        // for name/website/url/photos. One extra call to get reviews + types.
        const url = 'https://maps.googleapis.com/maps/api/place/details/json';
        const { data } = await axios.get(url, {
          params: {
            place_id: placeId,
            key: GOOGLE_PLACES_API_KEY,
            fields: 'name,reviews,types',
          },
        });
        if (data.status === 'OK' && Array.isArray(data.result?.reviews) && data.result.reviews.length > 0) {
          const cuisineHint = coalesceCuisine({
            types: data.result.types || [],
            name: data.result.name || restaurantName || '',
            hint: '',
          });
          const inferred = await extractMenuFromReviewsWithLLM(
            data.result.reviews,
            cuisineHint,
            restaurantId,
          );
          if (inferred && inferred.length > 0) {
            const totalItems = inferred.reduce((n, s) => n + s.items.length, 0);
            if (totalItems >= 3) {
              result.sections = inferred;
              result.source = 'llm';
              console.log('[BiteRight] menu: LLM inferred from reviews', {
                restaurantId, sections: inferred.length, totalItems,
              });
              return res.json(await finalize('llm', null));
            }
          }
        }
      } catch (err) {
        console.warn('[BiteRight] menu: LLM inference fallback failed', err.message);
      }
    }

    console.log('[BiteRight] menu: no structured menu found', { restaurantId });
    res.json(await finalize(null));
  } catch (err) {
    console.error('[BiteRight] menu fetch error', err.message);
    res.json(await finalize(null));
  }
});

// 7) Admin: re-harvest food photos for all known restaurants (clears cached bad photos)
app.post('/api/admin/reharvest-photos', async (req, res) => {
  const results = [];
  for (const restaurant of restaurants) {
    // Clear cached photos to force re-resolution
    const oldUrl = restaurant.displayImageUrl || null;
    restaurant.displayImageUrl = null;
    restaurant.displayImageSourceType = IMAGE_SOURCE.PLACEHOLDER;
    restaurant.displayImageLastResolvedAt = null;
    restaurant.displayImagePhotoReference = null;
    clearRestaurantImageResolutionCache(restaurant.restaurantId);

    let newUrl = null;
    let source = 'ERROR';
    try {
      const { url, source: s } = await resolveRestaurantCardImageWithSource(
        restaurant.restaurantId,
        restaurant.placeId,
        undefined,
      );
      newUrl = url || null;
      source = s;
      // Persist updated photo reference to Supabase
      if (db && restaurant.restaurantId) {
        await db.updateRestaurant(restaurant.restaurantId, {
          displayImageUrl: restaurant.displayImageUrl,
          displayImageSourceType: restaurant.displayImageSourceType,
          displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt,
          displayImagePhotoReference: restaurant.displayImagePhotoReference,
        }).catch(() => {});
      }
    } catch (err) {
      console.error('[Reharvest] Error for %s: %s', restaurant.restaurantId, err.message);
    }
    results.push({
      restaurantId: restaurant.restaurantId,
      name: restaurant.name,
      oldUrl,
      newUrl,
      source,
      improved: !oldUrl && !!newUrl,
    });
  }
  console.log('[Reharvest] Done. Processed %d restaurants.', results.length);
  res.json({ ok: true, count: results.length, results });
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
    // Try Places Autocomplete first — better at resolving streets and neighborhoods
    const placesUrl = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
    const placesResp = await axios.get(placesUrl, {
      params: {
        input: query.trim(),
        key: GOOGLE_PLACES_API_KEY,
        types: 'geocode',
        // Bias toward Chicago area
        location: '41.8781,-87.6298',
        radius: 50000,
      },
    });
    const predictions = placesResp.data?.predictions || [];
    if (predictions.length > 0) {
      // Resolve coords for top predictions via Place Details
      const results = [];
      for (const pred of predictions.slice(0, 5)) {
        try {
          const details = await googlePlaceDetails(pred.place_id);
          if (details?.geometry?.location) {
            const loc = details.geometry.location;
            const label = pred.description || details.formatted_address || query.trim();
            results.push({ label, lat: loc.lat, lng: loc.lng });
          }
        } catch {
          // skip this prediction
        }
      }
      if (results.length > 0) {
        console.log('[BiteRight] Geocode autocomplete resolved via Places API', {
          query: query.trim(),
          resultCount: results.length,
          topResult: { label: results[0].label, lat: results[0].lat, lng: results[0].lng },
        });
        geocodeAutocompleteCache[key] = results;
        return results;
      }
    }

    // Fallback: standard Geocoding API
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
    console.log('[BiteRight] Geocode autocomplete resolved via Geocoding API fallback', {
      query: query.trim(),
      resultCount: results.length,
      topResult: results[0] ? { label: results[0].label, lat: results[0].lat, lng: results[0].lng } : null,
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

/** Clamp a radius value to [1, 30]; fall back to 3 when not a number. */
function clampRadius(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(30, Math.round(n)));
}

// POST /api/tonight/sessions
app.post('/api/tonight/sessions', (req, res) => {
  const { sessionName, locationBias, settings } = req.body || {};
  let code;
  do {
    code = generateSessionCode();
  } while (groupSessions.some((s) => s.code === code));

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);
  const ts = Date.now();
  const hostUserId = 'user_' + ts;
  const sessionId = 'sess_' + ts;

  const session = {
    id: sessionId,
    code,
    hostUserId,
    sessionName: sessionName || null,
    locationBias: locationBias || null,
    status: 'ACTIVE',
    started: false,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    hostParticipantId: 'p_' + ts,
    participants: [{ participantId: 'p_' + ts, userId: hostUserId, displayName: 'Host', doneSwiping: false }],
    settings: {
      location: settings?.location || null,
      locationLat: settings?.locationLat ?? null,
      locationLng: settings?.locationLng ?? null,
      // Radius is a 1-30 mi slider client-side; accept any integer in that
      // range. The old [1,3,5,10] chip whitelist silently normalized any
      // off-list value to 3, which broke the new slider.
      searchRadius: clampRadius(settings?.searchRadius),
      priceRange: Array.isArray(settings?.priceRange) ? settings.priceRange : [],
      cuisines: Array.isArray(settings?.cuisines) ? settings.cuisines : [],
      deckSize: [10, 15, 20].includes(settings?.deckSize) ? settings.deckSize : 15,
      deadline: settings?.deadline || null,
      nominatedRestaurants: [],
    },
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
    hostUserId,
    settings: session.settings,
  });
});

// PUT /api/tonight/sessions/:code/settings — host updates session settings
app.put('/api/tonight/sessions/:code/settings', (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (isSessionExpired(session)) return res.status(410).json({ error: 'Session expired' });
  if (session.started) return res.status(409).json({ error: 'Session already started' });

  const { location, locationLat, locationLng, searchRadius, priceRange, cuisines, deckSize, deadline } = req.body || {};
  if (location !== undefined) session.settings.location = location;
  if (locationLat !== undefined) session.settings.locationLat = locationLat;
  if (locationLng !== undefined) session.settings.locationLng = locationLng;
  if (searchRadius != null) session.settings.searchRadius = clampRadius(searchRadius);
  if (Array.isArray(priceRange)) session.settings.priceRange = priceRange;
  if (Array.isArray(cuisines)) session.settings.cuisines = cuisines;
  if ([10, 15, 20].includes(deckSize)) session.settings.deckSize = deckSize;
  if (deadline !== undefined) session.settings.deadline = deadline;

  res.json({ ok: true, settings: session.settings });
});

// POST /api/tonight/sessions/:code/nominate — any member adds a restaurant
app.post('/api/tonight/sessions/:code/nominate', (req, res) => {
  console.log('[BiteRight] Nominate request code=%s body=%j', req.params.code, req.body);
  const session = findSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (isSessionExpired(session)) return res.status(410).json({ error: 'Session expired' });
  if (session.started) return res.status(409).json({ error: 'Session already started' });

  const { restaurantId, name, address, participantId } = req.body || {};
  if (!restaurantId || !name) return res.status(400).json({ error: 'restaurantId and name required' });

  const already = session.settings.nominatedRestaurants.find((n) => n.restaurantId === restaurantId);
  if (already) return res.json({ ok: true, alreadyNominated: true, nominated: session.settings.nominatedRestaurants });

  session.settings.nominatedRestaurants.push({ restaurantId, name, address: address || '', nominatedBy: participantId || null });
  res.json({ ok: true, nominated: session.settings.nominatedRestaurants });
});

// DELETE /api/tonight/sessions/:code/nominate/:restaurantId — remove a nominated restaurant
app.delete('/api/tonight/sessions/:code/nominate/:restaurantId', (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (session.started) return res.status(409).json({ error: 'Session already started' });

  session.settings.nominatedRestaurants = session.settings.nominatedRestaurants.filter(
    (n) => n.restaurantId !== req.params.restaurantId,
  );
  res.json({ ok: true, nominated: session.settings.nominatedRestaurants });
});

// POST /api/tonight/sessions/:code/start — host locks settings and starts swiping
app.post('/api/tonight/sessions/:code/start', (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (isSessionExpired(session)) return res.status(410).json({ error: 'Session expired' });
  if (session.started) return res.json({ ok: true, alreadyStarted: true });

  session.started = true;
  res.json({ ok: true, started: true, settings: session.settings });
});

// GET /api/tonight/sessions/:code/state — get full session state for setup screen
app.get('/api/tonight/sessions/:code/state', (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (isSessionExpired(session)) return res.status(410).json({ error: 'Session expired' });

  // Count swipe progress per participant
  const participantProgress = session.participants.map((p) => {
    const swipeCount = tonightSwipes.filter((s) => s.sessionId === session.id && s.participantId === p.participantId).length;
    return { participantId: p.participantId, displayName: p.displayName || 'Member', doneSwiping: p.doneSwiping || false, swipeCount };
  });

  res.json({
    sessionId: session.id,
    code: session.code,
    hostUserId: session.hostUserId,
    hostParticipantId: session.hostParticipantId,
    started: session.started || false,
    participantCount: session.participants.length,
    participants: participantProgress,
    settings: session.settings,
  });
});

// POST /api/tonight/sessions/:code/done — participant marks themselves done swiping
app.post('/api/tonight/sessions/:code/done', (req, res) => {
  const session = findSessionByCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const { participantId } = req.body || {};
  const participant = session.participants.find((p) => p.participantId === participantId);
  if (!participant) return res.status(403).json({ error: 'Not a participant' });

  participant.doneSwiping = true;
  const doneCount = session.participants.filter((p) => p.doneSwiping).length;
  const allDone = doneCount === session.participants.length;

  res.json({ ok: true, doneCount, totalParticipants: session.participants.length, allDone });
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

  // Dedup join requests. Previously every POST to /join pushed a new
  // participant, so a single user refreshing the link / app retry / etc.
  // inflated the participant count ("3 members" when 1 friend joined).
  //
  // Resolution order for "is this an existing participant?":
  //   1. participantId echoed back by the client from a prior join.
  //   2. userId match (when the joiner is signed in).
  //   3. (no match) → create a new participant.
  const { userId, participantId: existingPid } = req.body || {};
  const existing =
    (existingPid && session.participants.find((p) => p.participantId === existingPid)) ||
    (userId && session.participants.find((p) => p.userId && p.userId === userId)) ||
    null;
  const participantId = existing
    ? existing.participantId
    : 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  if (!existing) {
    session.participants.push({ participantId, userId: userId || null });
  }

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

/** Generate a personalized one-liner for the swipe card based on user history. Returns null if no data. */
function generateWhyLine(restaurant, userId, ctx) {
  const { savedRestaurants, logs } = ctx;
  const cuisine = (restaurant.cuisine || '').split('·')[0].trim().toLowerCase();

  // Check if user has saved restaurants of the same cuisine
  if (cuisine && Array.isArray(savedRestaurants)) {
    const savedSameCuisine = savedRestaurants.filter(
      (s) => s.userId === userId && (s.cuisine || '').toLowerCase().includes(cuisine),
    );
    if (savedSameCuisine.length >= 2) return `You've saved ${savedSameCuisine.length} ${cuisine} spots`;
    if (savedSameCuisine.length === 1) return `You saved a ${cuisine} spot before`;
  }

  // Check visit history for similar cuisine
  if (cuisine && Array.isArray(logs)) {
    const visitedSameCuisine = logs.filter(
      (l) => l.userId === userId && (l.cuisine || '').toLowerCase().includes(cuisine),
    );
    if (visitedSameCuisine.length >= 2) return `You've visited ${visitedSameCuisine.length} ${cuisine} places`;
    if (visitedSameCuisine.length === 1) return `You've been to a ${cuisine} spot`;
  }

  // Price match
  const pl = restaurant.priceLevel;
  if (pl && Array.isArray(savedRestaurants)) {
    const savedSamePrice = savedRestaurants.filter(
      (s) => s.userId === userId && s.priceLevel === pl,
    );
    const priceLabel = '$'.repeat(pl);
    if (savedSamePrice.length >= 3) return `Matches your ${priceLabel} preference`;
  }

  return null;
}

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
  const lat = session.settings.locationLat ?? 41.88;
  const lng = session.settings.locationLng ?? -87.63;
  const radiusMiles = session.settings.searchRadius || 3;
  // ── Build pool from Google Places when available, else fall back to demo data ──
  let poolSource = TONIGHT_POOL;
  let filtersRelaxed = false;
  let relaxedCuisine = null;
  let relaxedFrom = null;
  let relaxedTo = null;
  const sessionCuisines = session.settings.cuisines || [];
  if (GOOGLE_PLACES_API_KEY) {
    try {
      const radiusMeters = radiusMiles * 1609.34;
      const keyword = sessionCuisines.length > 0
        ? cuisineChipToNearbyKeyword(sessionCuisines[0])
        : '';
      const fetchMerged = async (kw) => {
        const tq = kw ? `${kw} restaurants` : 'restaurants';
        const [nearbyRaw, textRaw] = await Promise.all([
          googlePlacesNearbyRestaurants(lat, lng, radiusMeters, kw || undefined),
          googlePlacesTextSearch(tq, lat, lng, radiusMeters),
        ]);
        const mergedMap = new Map();
        for (const p of nearbyRaw) { if (p.placeId) mergedMap.set(p.placeId, p); }
        for (const p of textRaw) {
          if (!p.placeId) continue;
          const existing = mergedMap.get(p.placeId);
          if (!existing) { mergedMap.set(p.placeId, p); }
          else {
            const richness = (e) =>
              (e.rating != null ? 1 : 0) + (e.userRatingsTotal != null ? 1 : 0) +
              (e.priceLevel != null ? 1 : 0) + (e.photoRef ? 1 : 0);
            if (richness(p) > richness(existing)) mergedMap.set(p.placeId, p);
          }
        }
        return Array.from(mergedMap.values()).filter((p) => isFoodPlace(p.types));
      };
      let merged = await fetchMerged(keyword);
      // Auto-relax: walk the similarity ladder so the user gets the *closest*
      // alternative cuisine, not just "anything". e.g. Ramen → Japanese → Asian.
      // Only after every similar tier comes up empty do we drop the filter
      // entirely. Banner copy uses relaxedFrom + relaxedTo to explain the choice.
      if (merged.length === 0 && keyword) {
        const original = sessionCuisines[0];
        const ladder = getCuisineFallbackChain(original);
        for (const fallback of ladder) {
          const altKeyword = cuisineChipToNearbyKeyword(fallback);
          const altMerged = await fetchMerged(altKeyword);
          if (altMerged.length > 0) {
            merged = altMerged;
            filtersRelaxed = true;
            relaxedCuisine = original;
            relaxedFrom = original;
            relaxedTo = fallback;
            console.log('[BiteRight][Tonight pool] relaxed', original, '→', fallback, ': found', altMerged.length, 'places');
            break;
          }
        }
        // Last resort: drop the cuisine entirely.
        if (merged.length === 0) {
          const anyMerged = await fetchMerged('');
          if (anyMerged.length > 0) {
            merged = anyMerged;
            filtersRelaxed = true;
            relaxedCuisine = original;
            relaxedFrom = original;
            relaxedTo = null; // means "no cuisine at all"
            console.log('[BiteRight][Tonight pool] relaxed', original, '→ ANY: found', anyMerged.length, 'places');
          }
        }
      }
      if (merged.length > 0) {
        // Convert Google Places results to pool items
        poolSource = merged.map((p, idx) => {
          let restaurant = findRestaurantByPlaceId(p.placeId);
          if (!restaurant) {
            const restaurantId = `g_${String(p.placeId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 18) || `${Date.now()}_${idx}`}`;
            restaurant = {
              restaurantId,
              placeId: p.placeId,
              googlePlaceId: p.placeId,
              name: p.name,
              address: p.address,
              lat: p.lat ?? lat,
              lng: p.lng ?? lng,
              displayImageUrl: null,
              displayImageSourceType: IMAGE_SOURCE.PLACEHOLDER,
              displayImageLastResolvedAt: null,
              createdAt: new Date().toISOString(),
            };
            restaurants.push(restaurant);
          }
          const allCuisines = [...deriveCuisinesFromPlace(p.types, p.name, '')];
          return {
            restaurantId: restaurant.restaurantId,
            name: p.name,
            address: p.address,
            lat: p.lat ?? lat,
            lng: p.lng ?? lng,
            rating: p.rating ?? 4,
            cuisine: mapFoodCategory(p.types, p.name),
            cuisines: allCuisines,
            neighborhood: (p.address || '').split(',')[0] || '',
            priceLevel: p.priceLevel ?? null,
            isOpenNow: p.isOpenNow ?? null,
          };
        });
      }
    } catch (err) {
      console.warn('[BiteRight] Tonight pool Google Places fetch failed, using demo pool:', err.message);
    }
  }

  // When relaxed, swap the ranker's cuisine input to the fallback so it stays
  // family-scoped (e.g. ranker keeps "Japanese" when original "Ramen" failed).
  // If relaxedTo is null we walked all the way to "any" — pass [] then.
  const cuisinesForRanker = filtersRelaxed
    ? (relaxedTo ? [relaxedTo] : [])
    : sessionCuisines;
  const ranked = getTonightPoolRanked({
    pool: poolSource,
    lat,
    lng,
    radiusMiles,
    participantId,
    sessionId: session.id,
    tonightSwipes,
    savedRestaurants,
    groupSessions,
    negativeFeedback,
    distanceMiles,
    cuisines: cuisinesForRanker,
    priceRange: session.settings.priceRange || [],
    deckSize: session.settings.deckSize || 0,
  });
  if (filtersRelaxed) {
    console.log('[BiteRight][Tonight pool] post-rank result count:', ranked.length);
  }
  // Prepend nominated restaurants so they always appear in the swipe pool
  const nominatedItems = (session.settings.nominatedRestaurants || []).map((n) => ({
    restaurantId: n.restaurantId,
    name: n.name,
    address: n.address || '',
    lat,
    lng,
    nominated: true,
  }));
  const nominatedIds = new Set(nominatedItems.map((n) => n.restaurantId));
  const combined = [...nominatedItems, ...ranked.filter((r) => !nominatedIds.has(r.restaurantId))];

  const start = page * pageSize;
  const slice = combined.slice(start, start + pageSize);
  const tonightCtx = { savedRestaurants, tonightSwipes, logs, friends, groupSessions, userDisplayNames };

  // Batch-fetch cached menus for every restaurant in this page in a single
  // Supabase round-trip. getSwipeRecommendedDishes uses this to fall through
  // from friend logs → cached menu → generic cuisine fallback, without doing
  // any per-card network work.
  const menuRowsByRestaurant = await batchReadCachedMenus(slice.map((r) => r.restaurantId));
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
          googlePlaceId: null,
          name: r.name,
          address: r.address || '',
          lat: r.lat,
          lng: r.lng,
          displayImageUrl: null,
          displayImageSourceType: IMAGE_SOURCE.PLACEHOLDER,
          displayImageLastResolvedAt: null,
          createdAt: new Date().toISOString(),
        });
        fromDb = findRestaurantById(r.restaurantId);
      }
      const rawUrl = await resolveRestaurantCardImage(r.restaurantId, fromDb?.placeId ?? null, null);
      const abs = rawUrl ? toAbsoluteImageUrl(rawUrl) : null;
      const socialProofBadge =
        getSocialProofBadge(r.restaurantId, userId, {
          ...tonightCtx,
          similarTasteSignal: r.similarTasteSignal,
          cuisine: r.cuisine,
        }) || null;
      // When the cuisine was relaxed, attach a per-card note so the swipe UI
      // can make it obvious why this restaurant is showing up.
      const fallbackNote = filtersRelaxed
        ? (relaxedTo
            ? `No ${(relaxedFrom || '').toLowerCase()} nearby — this is a ${relaxedTo.toLowerCase()} pick`
            : `No ${(relaxedFrom || '').toLowerCase()} nearby — broadened to top picks`)
        : null;
      return {
        restaurantId: r.restaurantId,
        name: r.name,
        address: r.address,
        cuisine: r.cuisine || null,
        neighborhood: r.neighborhood || null,
        priceLevel: r.priceLevel ?? null,
        placeId: fromDb?.placeId ?? null,
        googlePlaceId: fromDb?.googlePlaceId ?? fromDb?.placeId ?? null,
        displayImageUrl: abs,
        displayImageSourceType: fromDb?.displayImageSourceType ?? IMAGE_SOURCE.PLACEHOLDER,
        displayImageLastResolvedAt: fromDb?.displayImageLastResolvedAt ?? null,
        previewPhotoUrl: abs,
        imageUrl: abs,
        socialProofBadge,
        groupSignal,
        distanceMi: (r.lat != null && r.lng != null) ? Math.round(distanceMiles(lat, lng, r.lat, r.lng) * 10) / 10 : null,
        whyLine: generateWhyLine(r, userId, tonightCtx),
        recommendedDishes: getSwipeRecommendedDishes({
          restaurantId: r.restaurantId,
          cuisine: r.cuisine,
          name: r.name,
          userId,
          logs,
          friends,
          menuRow: menuRowsByRestaurant.get(r.restaurantId) || null,
        }),
        isOpenNow: r.isOpenNow ?? null,
        rating: r.rating ?? null,
        fallbackNote,
      };
    }),
  );
  res.json({
    pool,
    total: combined.length,
    page,
    pageSize,
    filtersRelaxed,
    relaxedCuisine,
    relaxedFrom,
    relaxedTo,
  });
});

// POST /api/tonight/sessions/:code/swipe (idempotent upsert per participantId + restaurantId).
// If action===LIKE and userId provided, upsert SavedRestaurant. Guests (participantId only): no save; MVP does not persist saves for guests.
app.post('/api/tonight/sessions/:code/swipe', async (req, res) => {
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
    const existingSaved = await db.findSavedRestaurant(userId, restaurantId)
      || savedRestaurants.find((s) => s.userId === userId && s.restaurantId === restaurantId);
    if (!existingSaved) {
      const savedEntry = {
        id: 'saved_' + Date.now(),
        userId,
        restaurantId,
        savedAt: new Date().toISOString(),
        source: 'TONIGHT',
      };
      await db.insertSavedRestaurant(savedEntry);
      savedRestaurants.push(savedEntry);
      saved = true;
    }
  }

  res.json({ ok: true, saved });
});

// --- Saved restaurants (Profile) --------------------------------------------

// GET /api/users/:userId/saved?sort=location|distance&lat=&lng=
app.get('/api/users/:userId/saved', async (req, res) => {
  const userId = req.params.userId;
  const sort = (req.query.sort || 'location').toLowerCase();
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  // Load from Supabase, fall back to in-memory
  const saved = await db.getSavedRestaurants(userId);
  const withInfo = (await Promise.all(saved
    .map(async (s) => {
      const info = await getRestaurantInfo(s.restaurantId);
      const snap = s.snapshot || null;
      if (!info && !snap) return null;
      const name = info?.name || snap?.name || 'Saved place';
      const address = info?.address ?? snap?.address ?? null;
      const city = info?.city ?? snap?.city ?? null;
      const neighborhood = info?.neighborhood ?? snap?.neighborhood ?? null;
      const lat = info?.lat ?? snap?.lat ?? null;
      const lng = info?.lng ?? snap?.lng ?? null;
      const canonicalId = info?.restaurantId || s.restaurantId;
      const placeId = info?.placeId || (String(s.restaurantId).startsWith('ChIJ') ? s.restaurantId : null);

      // Match Discover's photo resolution path: prefer stored URLs, then
      // fall back to the full Google-Places resolver. Without this fallback,
      // saved cards for unenriched Google places ship with null
      // displayImageUrl while the exact same restaurant on Discover renders
      // a photo — same data, different surface, inconsistent UX.
      let resolvedDisplayImageUrl =
        toAbsoluteImageUrl(
          info?.displayImageUrl || info?.previewPhotoUrl || snap?.previewPhotoUrl || null,
        ) || null;
      if (!resolvedDisplayImageUrl && placeId) {
        try {
          const resolved = await resolveRestaurantCardImage(canonicalId, placeId, undefined);
          if (resolved) resolvedDisplayImageUrl = toAbsoluteImageUrl(resolved) || null;
        } catch (e) {
          console.warn('[saved] image resolver failed', canonicalId, e?.message);
        }
      }
      return {
        restaurantId: canonicalId,
        place_id: placeId || canonicalId,
        name,
        cuisine: coalesceCuisine({ types: info?.types, name: info?.name || name, hint: info?.cuisine || snap?.cuisine }),
        address,
        city,
        neighborhood,
        lat,
        lng,
        googlePlaceId: info?.googlePlaceId || placeId || null,
        displayImageUrl: resolvedDisplayImageUrl,
        displayImageSourceType: info?.displayImageSourceType || IMAGE_SOURCE.PLACEHOLDER,
        displayImageLastResolvedAt: info?.displayImageLastResolvedAt || null,
        previewPhotoUrl: resolvedDisplayImageUrl,
        savedAt: s.savedAt,
        source: (s.source === 'swipe' || s.source === 'TONIGHT') ? 'swipe' : 'manual',
      };
    }))).filter(Boolean);

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
app.post('/api/users/:userId/saved', async (req, res) => {
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
  const byPlace = String(restaurantId).startsWith('ChIJ') ? await findRestaurantByPlaceIdAsync(restaurantId) : null;
  if (byPlace) canonicalId = byPlace.restaurantId;

  // Check Supabase first, then in-memory
  const existing = await db.findSavedRestaurant(userId, canonicalId)
    || (canonicalId !== restaurantId ? await db.findSavedRestaurant(userId, restaurantId) : null)
    || savedRestaurants.find(
      (s) => s.userId === userId && (s.restaurantId === restaurantId || s.restaurantId === canonicalId),
    );
  if (existing) {
    if (name && typeof name === 'string') {
      const updatedSnapshot = {
        ...(existing.snapshot || {}),
        name,
        previewPhotoUrl: photo || existing.snapshot?.previewPhotoUrl,
        neighborhood: neighborhood ?? existing.snapshot?.neighborhood,
        address: address ?? existing.snapshot?.address,
      };
      existing.snapshot = updatedSnapshot;
      await db.updateSavedRestaurant(existing.id, { snapshot: updatedSnapshot });
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
  const savedEntry = {
    id: 'saved_' + Date.now(),
    userId,
    restaurantId: canonicalId,
    savedAt: new Date().toISOString(),
    source: source === 'swipe' || source === 'manual' ? source : 'manual',
    snapshot: hasSnap ? snap : undefined,
  };
  // Persist to Supabase + in-memory
  await db.insertSavedRestaurant(savedEntry);
  savedRestaurants.push(savedEntry);
  if (process.env.NODE_ENV !== 'production') {
    console.log('[BiteRight][Saved] POST result saved', { userId, restaurantId: canonicalId });
  }
  res.status(201).json({ ok: true, saved: true, restaurantId: canonicalId });
});

// Negative feedback on recommendations: hide / suggest_less
app.post('/api/users/:userId/negative-feedback', async (req, res) => {
  const userId = req.params.userId;
  const { restaurantId, actionType } = req.body || {};
  const validActions = ['hide', 'suggest_less', 'suggest_less_cuisine', 'suggest_less_price', 'suggest_less_location'];
  if (!restaurantId || !validActions.includes(actionType)) {
    return res.status(400).json({ error: 'restaurantId and valid actionType required' });
  }
  const info = await getRestaurantInfo(restaurantId);
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
app.delete('/api/users/:userId/saved/:restaurantId', async (req, res) => {
  const userId = req.params.userId;
  const rawId = req.params.restaurantId;
  let canonical = rawId;
  const byPlace = String(rawId).startsWith('ChIJ') ? await findRestaurantByPlaceIdAsync(rawId) : null;
  if (byPlace) canonical = byPlace.restaurantId;

  // Delete from Supabase
  const deleted = await db.deleteSavedRestaurant(userId, canonical)
    || (canonical !== rawId ? await db.deleteSavedRestaurant(userId, rawId) : false);

  // Also remove from in-memory
  const index = savedRestaurants.findIndex(
    (s) => s.userId === userId && (s.restaurantId === rawId || s.restaurantId === canonical),
  );
  if (index !== -1) savedRestaurants.splice(index, 1);

  if (!deleted && index === -1) {
    return res.status(404).json({ error: 'Saved restaurant not found' });
  }
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
app.get('/api/tonight/sessions/:code/matches', async (req, res) => {
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
      const placeId = findRestaurantById(rest.restaurantId)?.googlePlaceId ?? findRestaurantById(rest.restaurantId)?.placeId ?? null;
      const resolvedUrl = await resolveRestaurantCardImage(rest.restaurantId, placeId, undefined);
      matches.push({
        restaurantId: rest.restaurantId,
        name: rest.name,
        address: rest.address,
        percentMatch: Math.round(percentMatch),
        displayImageUrl: resolvedUrl ? toAbsoluteImageUrl(resolvedUrl) : null,
        previewPhotoUrl: resolvedUrl ? toAbsoluteImageUrl(resolvedUrl) : null,
      });
    }
  }

  matches.sort((a, b) => (b.percentMatch - a.percentMatch));

  // Count how many participants have signaled "done swiping" so the client
  // can distinguish "still in progress" from "everyone done, no agreement".
  const participantsDone = (session.participants || [])
    .filter((p) => p.doneSwiping).length;

  res.json({
    totalParticipants,
    likesRequired,
    matches,
    participantsDone,
  });
});

// --- Discover (recommendation pipeline + location filter) --------------------

const { getDiscoverRecommendations } = require('./recommendation');

async function attachImageAndPlaceId(rec, userId, ctx) {
  // Try to derive a placeId from any signal we have. The g_ prefix wraps a
  // raw Google place_id; rec may also carry it directly.
  const placeIdFromRow = findRestaurantById(rec.restaurantId)?.placeId ?? null;
  const placeIdFromRec = rec.placeId || rec.place_id || rec.googlePlaceId || null;
  const placeIdFromIdPrefix = String(rec.restaurantId || '').startsWith('g_')
    ? String(rec.restaurantId).slice(2)
    : null;
  const placeId = placeIdFromRow || placeIdFromRec || placeIdFromIdPrefix || null;
  const derivedCuisines = deriveCuisinesFromPlace(rec.types || [], rec.name, rec.cuisine);
  // Kept alongside displayCuisine because the `cuisines` array fallback
  // below still references it. Removing this caused a ReferenceError that
  // crash-looped every Discover call on Render.
  const mappedCat = mapFoodCategory(rec.types || [], rec.name);
  // Always non-empty — coalesceCuisine has a final "Restaurant" fallback so
  // no Discover card ever ships without a cuisine label.
  const displayCuisine = coalesceCuisine({ types: rec.types, name: rec.name, hint: rec.cuisine });
  const rawUrl = await resolveRestaurantCardImage(rec.restaurantId, placeId, undefined);
  let finalImageUrl = rawUrl ? toAbsoluteImageUrl(rawUrl) : null;

  // Same fallback the detail endpoint uses: when the resolver returns null
  // (non-seeded restaurant, no stored ref), pull fresh Google photos and
  // serve via /api/place-photo?ref=… — no DB record needed.
  if (!finalImageUrl && placeId && GOOGLE_PLACES_API_KEY) {
    try {
      const details = await googlePlaceDetails(placeId);
      const photoRef = selectBestPlacePhotoReference(details?.photos || []);
      if (photoRef) {
        finalImageUrl = toAbsoluteImageUrl(`/api/place-photo?ref=${encodeURIComponent(photoRef)}&maxW=800`);
      }
    } catch (err) {
      // Don't break discover for one bad photo lookup.
      if (rec?.name) console.warn('[BiteRight][Discover] place-photo fallback failed for', rec.name, err?.message);
    }
  }
  const restaurantRow = findRestaurantById(rec.restaurantId);
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
  const staticInfo = STATIC_RESTAURANTS[rec.restaurantId];
  return {
    restaurant: {
      id: rec.restaurantId,
      name: rec.name,
      address: rec.address,
      neighborhood: rec.neighborhood ?? (rec.address && rec.address.split(',')[0]) ?? null,
      cuisine: displayCuisine,
      cuisines: derivedCuisines.length ? derivedCuisines : mappedCat ? [mappedCat] : [],
      priceLevel: rec.priceLevel ?? 2,
      lat: restaurantRow?.lat ?? staticInfo?.lat ?? null,
      lng: restaurantRow?.lng ?? staticInfo?.lng ?? null,
      placeId,
      googlePlaceId: restaurantRow?.googlePlaceId ?? placeId ?? null,
      displayImageUrl: finalImageUrl,
      displayImageSourceType: restaurantRow?.displayImageSourceType ?? IMAGE_SOURCE.PLACEHOLDER,
      displayImageLastResolvedAt: restaurantRow?.displayImageLastResolvedAt ?? null,
      // Normalize with Feed's successful field name.
      previewPhotoUrl: finalImageUrl,
      // Keep backward-compatible alias for existing Discover consumers.
      imageUrl: finalImageUrl,
      // Must-try chips — same source as the Tonight pool so both surfaces
      // show the same dishes for the same restaurant.
      recommendedDishes: getRecommendedDishes(displayCuisine, rec.name),
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
// DEBUG: helper to trace a specific restaurant through the pipeline
function _debugNormalizeName(name = '') {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function _debugTarget(targetName, restaurants, stage) {
  const norm = _debugNormalizeName(targetName);
  const target = restaurants.find((r) =>
    _debugNormalizeName(r.name).includes(norm)
  );
  if (!target) {
    console.log(`[DEBUG:${stage}] ${targetName} NOT FOUND (${restaurants.length} candidates)`);
    return;
  }
  console.log(`[DEBUG:${stage}] ${targetName} FOUND`, {
    name: target.name,
    cuisine: target.cuisine,
    subcategories: target.subcategories,
    address: target.address,
    distanceMeters: target.distanceMeters,
    rating: target.rating,
    reviewCount: target.userRatingsTotal,
  });
}

async function buildGooglePlaceDiscover(lat, lng, radiusMiles, userId, cuisineFilter, meta) {
  const keyword = cuisineFilter ? cuisineChipToNearbyKeyword(cuisineFilter) : '';
  const searchTerm = (meta?.search || '').trim();
  console.log('[BiteRight][Discover] Google Places discover', {
    ...meta,
    cuisineReceived: cuisineFilter || null,
    nearbyKeyword: keyword || null,
    searchTerm: searchTerm || null,
  });

  // ── Hybrid candidate fetch: Nearby Search + Text Search in parallel ──
  const radiusMeters = radiusMiles * 1609.34;

  // When the search term matches a known cuisine alias, use it as a Nearby
  // Search keyword so we get the same broad results as the old cuisine chips.
  const SEARCH_TO_NEARBY_KEYWORD = {
    ramen: 'ramen', sushi: 'sushi', tacos: 'mexican', pizza: 'pizza',
    'bubble tea': 'boba tea', boba: 'boba tea', brunch: 'brunch',
    pho: 'pho', wings: 'wings', burger: 'burger', burgers: 'burger', curry: 'curry',
    'dim sum': 'dim sum', bbq: 'barbecue', steak: 'steakhouse',
    seafood: 'seafood', korean: 'korean', thai: 'thai', chinese: 'chinese',
    indian: 'indian', mediterranean: 'mediterranean', japanese: 'japanese',
    italian: 'italian', mexican: 'mexican', french: 'french', greek: 'greek',
    dessert: 'dessert', desserts: 'dessert', 'ice cream': 'ice cream',
    coffee: 'coffee', cafe: 'coffee', bakery: 'bakery',
  };
  const searchNearbyKeyword = searchTerm
    ? (SEARCH_TO_NEARBY_KEYWORD[searchTerm.toLowerCase()] || '')
    : '';

  // ── Occasion → search keyword mapping ─────────────────────────────────
  const OCCASION_SEARCH_KEYWORD = {
    brunch: 'brunch', lunch: 'lunch', dinner: 'dinner restaurant',
    bars: 'bar cocktail', dessert: 'dessert', coffee: 'coffee cafe',
    late_night: 'late night food',
  };
  const occasionKeyword = meta?.occasion ? (OCCASION_SEARCH_KEYWORD[meta.occasion] || '') : '';
  const occasionNearbyKeyword = occasionKeyword ? occasionKeyword.split(' ')[0] : '';

  const nearbyKeyword = keyword || searchNearbyKeyword || occasionNearbyKeyword;

  // Combine free-text search term with cuisine keyword + occasion for the Text Search query.
  const combinedKeyword = [searchTerm, keyword, occasionKeyword].filter(Boolean).join(' ');
  const textQuery = combinedKeyword
    ? (meta?.query ? `${combinedKeyword} restaurants near ${meta.query}` : `${combinedKeyword} restaurants`)
    : (meta?.query ? `restaurants near ${meta.query}` : 'restaurants');

  // Run Nearby Search when we have a keyword for it (cuisine filter OR recognized search term OR occasion).
  const runNearby = !searchTerm || !!searchNearbyKeyword || !!occasionKeyword;
  // "best of" query surfaces top-rated places that standard queries miss.
  const bestOfKeyword = nearbyKeyword || searchTerm || occasionNearbyKeyword || '';
  // When radius is large (>2mi), also run a focused nearby search at 2mi to
  // capture dense local results that Google might skip in the wider search.
  const FOCUSED_RADIUS_METERS = 2 * 1609.34; // 2 miles
  const needsFocusedSearch = radiusMeters > FOCUSED_RADIUS_METERS * 1.2;

  const [nearbyRaw, textRaw, bestOfRaw, nearbyFocusedRaw] = await Promise.all([
    runNearby ? googlePlacesNearbyRestaurants(lat, lng, radiusMeters, nearbyKeyword || undefined) : Promise.resolve([]),
    googlePlacesTextSearch(textQuery, lat, lng, radiusMeters, { skipTypeFilter: !!searchTerm }),
    bestOfKeyword ? googlePlacesBestOfSearch(bestOfKeyword, lat, lng, radiusMeters) : Promise.resolve([]),
    needsFocusedSearch && runNearby ? googlePlacesNearbyRestaurants(lat, lng, FOCUSED_RADIUS_METERS, nearbyKeyword || undefined) : Promise.resolve([]),
  ]);

  // DEBUG: tracing La Luna through pipeline — raw fetch
  _debugTarget('La Luna', nearbyRaw, 'RAW_FETCH_NEARBY');
  _debugTarget('La Luna', textRaw, 'RAW_FETCH_TEXT');

  console.log('[BiteRight][Discover] hybrid fetch counts', {
    nearbyRaw: nearbyRaw.length,
    textRaw: textRaw.length,
    bestOfRaw: bestOfRaw.length,
    nearbyFocusedRaw: nearbyFocusedRaw.length,
  });

  // Merge + dedupe all sources: prefer the entry with richer metadata.
  // Tag results from text/best-of search so we can trust Google's relevance later.
  const textPlaceIds = new Set(textRaw.map((p) => p.placeId).filter(Boolean));
  const bestOfPlaceIds = new Set(bestOfRaw.map((p) => p.placeId).filter(Boolean));

  const mergedMap = new Map();
  const richness = (e) =>
    (e.rating != null ? 1 : 0) +
    (e.userRatingsTotal != null ? 1 : 0) +
    (e.priceLevel != null ? 1 : 0) +
    (e.photoRef ? 1 : 0) +
    (e.types?.length || 0);
  for (const source of [nearbyRaw, textRaw, bestOfRaw, nearbyFocusedRaw]) {
    for (const p of source) {
      if (!p.placeId) continue;
      const existing = mergedMap.get(p.placeId);
      if (!existing) {
        mergedMap.set(p.placeId, { ...p, _fromSearchQuery: textPlaceIds.has(p.placeId) || bestOfPlaceIds.has(p.placeId) });
      } else if (richness(p) > richness(existing)) {
        mergedMap.set(p.placeId, { ...p, _fromSearchQuery: existing._fromSearchQuery || textPlaceIds.has(p.placeId) || bestOfPlaceIds.has(p.placeId) });
      }
    }
  }
  const mergedRaw = Array.from(mergedMap.values());

  // When search term is active, trust Google's text search results more broadly.
  let nearby = searchTerm
    ? mergedRaw.filter((p) => !p.types?.some((t) => ['lodging', 'hospital', 'school', 'bank', 'gym'].includes(t)))
    : mergedRaw.filter((p) => isFoodPlace(p.types));

  // DEBUG: tracing La Luna through pipeline — after isFoodPlace filter
  _debugTarget('La Luna', nearby, 'AFTER_FOOD_FILTER');
  const discoverCtx = { savedRestaurants, tonightSwipes, logs, friends, groupSessions, userDisplayNames };

  // ── Ensure each Google Place has a local restaurant record ────────
  const placeInputs = nearby.map((p, idx) => {
    let restaurant = findRestaurantByPlaceId(p.placeId);
    if (!restaurant) {
      const restaurantId = `g_${String(p.placeId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 18) || `${Date.now()}_${idx}`}`;
      restaurant = {
        restaurantId,
        placeId: p.placeId,
        googlePlaceId: p.placeId,
        name: p.name,
        address: p.address,
        lat: p.lat ?? lat,
        lng: p.lng ?? lng,
        displayImageUrl: null,
        displayImageSourceType: IMAGE_SOURCE.PLACEHOLDER,
        displayImageLastResolvedAt: null,
        createdAt: new Date().toISOString(),
      };
      restaurants.push(restaurant);
    }
    return {
      ...p,
      restaurantId: restaurant.restaurantId,
      cuisine: mapFoodCategory(p.types, p.name),
      photos: p.photoRef ? [p.photoRef] : [],
    };
  });

  // DEBUG: tracing La Luna through pipeline — before ranking
  _debugTarget('La Luna', placeInputs, 'BEFORE_RANKING');

  // ── Run ranking pipeline (score → curate → diversify → reasons) ──
  const ranked = rankPlaces(placeInputs, { lat, lng }, {
    locationQuery: meta?.query || null,
    radiusMiles,
  });

  // DEBUG: tracing La Luna through pipeline — after ranking
  _debugTarget('La Luna', ranked, 'AFTER_RANKING');

  // Attach restaurantId back from placeInputs and pass through new fields
  function mapRankedToRec(r, idx) {
    const input = placeInputs.find((p) => p.name === r.name && p.address === r.address) || placeInputs[idx];
    return {
      restaurantId: input?.restaurantId || `g_ranked_${idx}`,
      name: r.name,
      address: r.address,
      neighborhood: r.neighborhood,
      cuisine: r.cuisine,
      types: r.types || [],
      priceLevel: r.priceLevel,
      percentMatch: r.percentMatch,
      explanations: r.explanations,
      heroLabel: r.heroLabel || null,
      cardTags: r.cardTags || [],
      distance: r.distance,
      inRadius: r.inRadius,
      similarTasteSignal: r.similarTasteSignal,
      // Preserve _scoring for section re-ranking
      _scoring: r._scoring,
      _baseScore: r._baseScore,
      _finalScore: r._finalScore,
      // Carry through search origin tag for relevance filter
      _fromSearchQuery: input?._fromSearchQuery || false,
    };
  }

  let recs = ranked.map(mapRankedToRec);

  // ── Cuisine post-filter (preserves existing logic) ──────────────
  if (cuisineFilter) {
    const GENERIC_LABELS = new Set(['Restaurant', 'Takeout', '']);
    // Google place `types[]` that disqualify a result from a given cuisine
    // chip even when the derive-cuisine pass came back generic. Without this,
    // an ice cream shop returned for keyword "pizza" sneaks through the
    // trust-Google fallback below because it has no specific cuisine label.
    const DISQUALIFYING_TYPES_FOR_FILTER = {
      Pizza:      ['ice_cream_shop', 'bakery'],
      Burgers:    ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Sushi:      ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Ramen:      ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Tacos:      ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Steakhouse: ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      BBQ:        ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Italian:    ['ice_cream_shop'],
      Mexican:    ['ice_cream_shop', 'bakery'],
      Japanese:   ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Chinese:    ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Korean:     ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Thai:       ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Indian:     ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Vietnamese: ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      Seafood:    ['ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'],
      // Bakery / Dessert / Coffee are themselves these categories — no disqualifiers.
    };
    const disqualifyingTypes = DISQUALIFYING_TYPES_FOR_FILTER[cuisineFilter] || [];

    // Strict mode: only include a place when we have POSITIVE evidence it
    // serves the requested cuisine — either the cuisine-normalizer matched, or
    // the restaurant name contains the cuisine keyword. Anything else (generic
    // labels, unclear types, "Google sort-of returned this for our keyword")
    // is excluded so the user never sees false recommendations.
    const nameRegex = keyword
      ? new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      : null;

    recs = recs.filter((rec) => {
      const derived = deriveCuisinesFromPlace(rec.types || [], rec.name, rec.cuisine);
      const matchesFilter = restaurantMatchesCuisineFilter(derived, cuisineFilter, rec.name, rec.cuisine);
      const types = rec.types || [];
      const hasDisqualifyingType = types.some((t) => disqualifyingTypes.includes(t));
      const nameMentionsCuisine = nameRegex ? nameRegex.test(rec.name || '') : false;

      // Hard rejection first.
      if (hasDisqualifyingType) {
        console.log('[BiteRight][Discover] inclusion', {
          name: rec.name, derivedCuisines: derived, selectedCuisine: cuisineFilter,
          included: false, reason: 'disqualifying-google-type', types,
        });
        return false;
      }
      // Positive match via derived cuisine taxonomy.
      if (matchesFilter) return true;
      // Positive match via name (e.g. "Tony's Pizza Napoletana" for Pizza).
      if (nameMentionsCuisine) {
        console.log('[BiteRight][Discover] inclusion', {
          name: rec.name, derivedCuisines: derived, selectedCuisine: cuisineFilter,
          included: true, reason: 'name-contains-cuisine',
        });
        return true;
      }
      // No positive evidence — exclude.
      console.log('[BiteRight][Discover] inclusion', {
        name: rec.name, derivedCuisines: derived, selectedCuisine: cuisineFilter,
        included: false, reason: 'no-positive-match (strict mode)',
      });
      return false;
    });
  }

  // ── Search relevance post-filter ─────────────────────────────────
  // When a free-text search term is active, drop results that clearly
  // don't match the search intent.
  if (searchTerm) {
    // Expand search term to related cuisine/type aliases so "ramen" matches
    // restaurants tagged as "japanese" by Google, etc.
    const SEARCH_ALIASES = {
      ramen: ['ramen', 'japanese', 'noodle', 'udon', 'soba'],
      sushi: ['sushi', 'japanese', 'omakase', 'sashimi', 'nigiri'],
      tacos: ['taco', 'mexican', 'taqueria', 'burrito'],
      pizza: ['pizza', 'pizzeria', 'neapolitan', 'deep dish'],
      pho: ['pho', 'vietnamese', 'noodle'],
      burger: ['burger', 'hamburger', 'american', 'diner'],
      'bubble tea': ['bubble tea', 'boba', 'tea', 'taiwanese'],
      boba: ['boba', 'bubble tea', 'tea', 'taiwanese'],
      brunch: ['brunch', 'breakfast', 'cafe', 'pancake', 'waffle', 'eggs'],
      wings: ['wings', 'chicken', 'american', 'sports bar'],
      curry: ['curry', 'indian', 'thai', 'japanese'],
      'dim sum': ['dim sum', 'chinese', 'dumpling', 'cantonese'],
      bbq: ['bbq', 'barbecue', 'smokehouse', 'brisket'],
      steak: ['steak', 'steakhouse', 'chophouse', 'prime'],
      seafood: ['seafood', 'fish', 'oyster', 'lobster', 'crab'],
      korean: ['korean', 'kbbq', 'bibimbap', 'bulgogi'],
      thai: ['thai', 'pad thai', 'curry', 'tom yum'],
      chinese: ['chinese', 'dim sum', 'szechuan', 'cantonese', 'dumpling'],
      indian: ['indian', 'curry', 'tandoor', 'biryani', 'masala'],
      mediterranean: ['mediterranean', 'hummus', 'kebab', 'shawarma', 'falafel', 'greek'],
      dessert: ['dessert', 'dessert_shop', 'ice cream', 'bakery', 'gelato', 'cobbler', 'cupcake', 'donut', 'sweets', 'frozen yogurt', 'cake', 'pie', 'pastry', 'cookie', 'milkshake', 'fudge', 'brownie', 'macaron'],
      desserts: ['dessert', 'dessert_shop', 'ice cream', 'bakery', 'gelato', 'cobbler', 'cupcake', 'donut', 'sweets', 'frozen yogurt', 'cake', 'pie', 'pastry', 'cookie', 'milkshake', 'fudge', 'brownie', 'macaron'],
      'ice cream': ['ice cream', 'ice_cream_shop', 'gelato', 'frozen yogurt', 'dessert', 'dessert_shop'],
    };
    const searchLower = searchTerm.toLowerCase();
    const expanded = SEARCH_ALIASES[searchLower] || [searchLower];

    const beforeCount = recs.length;
    recs = recs.filter((rec) => {
      // If Google returned this result specifically for our search query
      // (text search or best-of search), trust Google's relevance ranking.
      // This catches places like Au Cheval (famous burger spot) whose name
      // and types don't contain "burger" but Google knows it's relevant.
      if (rec._fromSearchQuery) return true;

      const haystack = [
        rec.name,
        rec.cuisine,
        ...(rec.types || []),
        ...deriveCuisinesFromPlace(rec.types || [], rec.name, rec.cuisine),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      // Result matches if ANY expanded alias appears in its metadata
      return expanded.some((alias) => haystack.includes(alias));
    });
    console.log('[BiteRight][Discover] search relevance filter', {
      searchTerm,
      expandedAliases: expanded,
      before: beforeCount,
      after: recs.length,
    });
  }

  // DEBUG: tracing La Luna through pipeline — after cuisine post-filter
  _debugTarget('La Luna', recs, 'AFTER_CUISINE_FILTER');

  // ── Occasion filter ─────────────────────────────────────────────────
  // Maps occasion labels to Google Place types, cuisine labels, and name keywords
  // so we can filter and boost relevant results.
  const occasionParam = meta?.occasion;
  if (occasionParam) {
    const OCCASION_TYPE_MAP = {
      brunch:     { types: ['breakfast_restaurant', 'brunch_restaurant', 'cafe'], keywords: /\b(brunch|breakfast|pancake|waffle|eggs|benedict|mimosa|cafe)\b/i },
      lunch:      { types: ['restaurant', 'cafe', 'meal_takeaway'], keywords: /\b(lunch|sandwich|salad|soup|deli|cafe|bistro)\b/i },
      dinner:     { types: ['restaurant', 'fine_dining_restaurant', 'steak_house'], keywords: /\b(dinner|fine dining|steakhouse|bistro|trattoria|supper)\b/i },
      bars:       { types: ['bar', 'night_club', 'wine_bar'], keywords: /\b(bar|cocktail|lounge|pub|taproom|brewery|wine bar|speakeasy|tavern)\b/i },
      dessert:    { types: ['dessert_shop', 'ice_cream_shop', 'bakery'], keywords: /\b(dessert|ice cream|gelato|bakery|cake|pie|cupcake|donut|pastry|cookie|cobbler|sweets)\b/i },
      coffee:     { types: ['cafe', 'coffee_shop'], keywords: /\b(coffee|cafe|espresso|latte|tea|matcha)\b/i },
      late_night: { types: ['bar', 'night_club', 'meal_takeaway'], keywords: /\b(late night|24.hour|after hours|bar|lounge|diner|taco|pizza|wings)\b/i },
    };
    const occasionConfig = OCCASION_TYPE_MAP[occasionParam];
    if (occasionConfig) {
      const typeSet = new Set(occasionConfig.types);
      const beforeOccasion = recs.length;

      // Score each result: higher = better occasion match
      const scored = recs.map((rec) => {
        const types = rec.types || [];
        const haystack = [rec.name, rec.cuisine, ...(rec.cuisines || [])].filter(Boolean).join(' ');
        let score = 0;
        if (types.some((t) => typeSet.has(t))) score += 2;
        if (occasionConfig.keywords.test(haystack)) score += 2;
        // Partial match: restaurant type is food-related
        if (types.some((t) => t.includes('restaurant'))) score += 0.5;
        return { rec, score };
      });

      // Keep results with any occasion signal, then fill with generics
      const matched = scored.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score).map((s) => s.rec);
      const fallback = scored.filter((s) => s.score > 0 && s.score < 2).sort((a, b) => b.score - a.score).map((s) => s.rec);
      recs = matched.length >= 3 ? matched : [...matched, ...fallback];

      console.log('[BiteRight][Discover] occasion filter', {
        occasion: occasionParam,
        before: beforeOccasion,
        matched: matched.length,
        after: recs.length,
      });
    }
  }

  // ── Sort mode: override ranking order ─────────────────────────────
  if (meta?.sortMode === 'nearest') {
    recs.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  } else if (meta?.sortMode === 'rating') {
    recs.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }

  recs = recs.slice(0, 50);

  // Build differentiated sections using different weight profiles.
  // "Top Picks" leans on quality+curation, "Trending" leans on popularity.
  const topRated = rankForSection(recs, 'top_rated');
  const trending = rankForSection(recs, 'trending');

  // Deduplicate: remove trending items that already appear in top picks
  const topPickIds = new Set(topRated.slice(0, 8).map(r => r.restaurantId));
  const trendingFiltered = trending.filter(r => !topPickIds.has(r.restaurantId));

  const sections = {
    topPicksForYou: topRated.slice(0, 8),
    becauseYouLiked: [],
    trendingWithSimilarUsers: trendingFiltered.slice(0, 8),
    allNearby: recs,
  };

  // Attach images with concurrency limit to avoid flooding Google API
  const CONCURRENCY_T = 6;
  async function mapConcurrentT(items, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
      while (idx < items.length) {
        const i = idx++;
        results[i] = await fn(items[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY_T, items.length) }, () => worker()));
    return results;
  }

  const attachT = (rec) => attachImageAndPlaceId(rec, userId, discoverCtx);
  const [topPicksForYou, becauseYouLiked, trendingWithSimilarUsers, allNearby] = await Promise.all([
    mapConcurrentT(sections.topPicksForYou || [], attachT),
    mapConcurrentT(sections.becauseYouLiked || [], attachT),
    mapConcurrentT(sections.trendingWithSimilarUsers || [], attachT),
    mapConcurrentT(sections.allNearby || [], attachT),
  ]);

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
      const included = restaurantMatchesCuisineFilter(derived, cuisineFilter, rec.name, rec.cuisine);
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
  const searchQuery = (req.query.search || '').trim() || null;
  const sortMode = (req.query.sortMode || 'best').toLowerCase();
  const occasion = (req.query.occasion || '').trim().toLowerCase() || null;
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
    console.log('[BiteRight][Discover] location request — resolved coordinates', {
      mode,
      userId,
      query: (req.query.query || '').trim() || null,
      cuisine: cuisineQuery,
      resolvedLat: lat,
      resolvedLng: lng,
      radiusMiles,
      coordSource: Number.isFinite(parseFloat(req.query.lat)) ? 'client' : 'server-geocoded',
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
        search: searchQuery,
        sortMode,
        occasion,
      });
      return res.json(payload);
    } catch (err) {
      console.error('[BiteRight][Discover] location nearby search error', err.message, err.stack);
      return res.status(502).json({ error: 'Failed to load location-based restaurants' });
    }
  }

  // Nearby mode with Google API key: use hybrid fetch (Nearby + Text Search).
  // Handles both cuisine-filtered and unfiltered requests.
  if (mode === 'nearby' && GOOGLE_PLACES_API_KEY) {
    try {
      const payload = await buildGooglePlaceDiscover(lat, lng, radiusMiles, userId, cuisineQuery, {
        mode: 'nearby',
        search: searchQuery,
        sortMode,
        occasion,
      });
      return res.json(payload);
    } catch (err) {
      console.error('[BiteRight][Discover] nearby search error', err.message, err.stack);
      // Fall through to local pool recommendations below
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
    getRestaurantInfo: getRestaurantInfoSync,
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

  // Attach images with concurrency limit to avoid flooding Google API
  const CONCURRENCY = 6;
  async function mapWithConcurrency(items, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
      while (idx < items.length) {
        const i = idx++;
        results[i] = await fn(items[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
    return results;
  }

  const attach = (rec) => attachImageAndPlaceId(rec, userId, discoverCtx);
  const [topPicksForYou, becauseYouLiked, trendingWithSimilarUsers, allNearby] = await Promise.all([
    mapWithConcurrency(sections.topPicksForYou || [], attach),
    mapWithConcurrency(sections.becauseYouLiked || [], attach),
    mapWithConcurrency(sections.trendingWithSimilarUsers || [], attach),
    mapWithConcurrency(sections.allNearby || [], attach),
  ]);

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

// ── GET /api/nearby-after — "Next stop" smart recommendations near a restaurant ───
app.get('/api/nearby-after', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  const radiusMiles = Math.min(2, Math.max(0.3, parseFloat(req.query.radiusMiles) || 0.75));
  const radiusMeters = radiusMiles * 1609.34;
  const limit = Math.min(8, Math.max(1, parseInt(req.query.limit) || 6));

  const hour = new Date().getHours();
  const isEvening = hour >= 17 || hour < 4;

  // ── V1 Scoring: time-of-day category preferences ──
  // Categories: drinks (bars/cocktails/wine), coffee, dessert
  // Weights shift by time of day so results always contain a mix
  const TIME_CATEGORY_WEIGHTS = {
    drinks:  hour >= 21 || hour < 4 ? 1.0 : hour >= 17 ? 0.8 : hour >= 14 ? 0.3 : 0.1,
    coffee:  hour >= 6 && hour < 11 ? 1.0 : hour >= 11 && hour < 14 ? 0.7 : hour >= 14 && hour < 17 ? 0.5 : 0.15,
    dessert: hour >= 19 || hour < 2 ? 0.7 : hour >= 14 ? 0.6 : 0.3,
  };

  try {
    console.log('[BiteRight] next-stop request', { lat, lng, radiusMiles, hour, isEvening, weights: TIME_CATEGORY_WEIGHTS });

    // Always fetch ALL categories in parallel for a diverse mix
    const [drinksNearby, drinksText, coffeeNearby, coffeeText, dessertNearby, dessertText] = await Promise.all([
      googlePlacesNearbyRestaurants(lat, lng, radiusMeters, 'bar cocktail lounge wine'),
      googlePlacesTextSearch('bars cocktail lounges wine bars', lat, lng, radiusMeters, { skipTypeFilter: true }),
      googlePlacesNearbyRestaurants(lat, lng, radiusMeters, 'coffee cafe espresso'),
      googlePlacesTextSearch('coffee shops cafes', lat, lng, radiusMeters, { skipTypeFilter: true }),
      googlePlacesNearbyRestaurants(lat, lng, radiusMeters, 'dessert ice cream bakery'),
      googlePlacesTextSearch('dessert ice cream bakery', lat, lng, radiusMeters, { skipTypeFilter: true }),
    ]);

    console.log('[BiteRight] next-stop raw counts', {
      drinks: drinksNearby.length + drinksText.length,
      coffee: coffeeNearby.length + coffeeText.length,
      dessert: dessertNearby.length + dessertText.length,
    });

    // Tag each result with its source category before merging
    const tagCategory = (arr, cat) => arr.map((p) => ({ ...p, _srcCategory: cat }));
    const allRaw = [
      ...tagCategory(drinksNearby, 'drinks'), ...tagCategory(drinksText, 'drinks'),
      ...tagCategory(coffeeNearby, 'coffee'), ...tagCategory(coffeeText, 'coffee'),
      ...tagCategory(dessertNearby, 'dessert'), ...tagCategory(dessertText, 'dessert'),
    ];

    // Merge and dedupe — keep first occurrence's category
    const seen = new Set();
    const merged = [];
    for (const p of allRaw) {
      const key = p.placeId || p.name;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }

    // ── Fallback: use in-memory restaurants if Google returned nothing ──
    if (merged.length === 0) {
      const R = 3958.8;
      const toRad = (d) => (d * Math.PI) / 180;

      const fallbackSpots = restaurants
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => {
          const dLat = toRad(r.lat - lat);
          const dLng = toRad(r.lng - lng);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(r.lat)) * Math.sin(dLng / 2) ** 2;
          const distMi = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const category = classifyCategory(r.types || [], r.name || '');
          return { ...r, _distMi: distMi, _cat: category };
        })
        .filter((r) => r._distMi <= radiusMiles && r._cat !== 'exclude')
        .sort((a, b) => a._distMi - b._distMi)
        .slice(0, limit)
        .map((r) => ({
          restaurantId: r.restaurantId || r.placeId,
          name: r.name,
          distanceMi: Math.round(r._distMi * 10) / 10,
          vibeTag: categoryLabel(r._cat),
          category: r._cat,
          rating: r.rating || null,
          isOpenNow: null,
          imageUrl: null,
          address: r.address || null,
        }));

      console.log('[BiteRight] next-stop using in-memory fallback', { count: fallbackSpots.length });
      return res.json({ spots: fallbackSpots, isEvening });
    }

    // ── Strict category filter BEFORE ranking ──
    // Only drinks / coffee / dessert survive. Everything else is excluded.
    const filtered = [];
    for (const p of merged) {
      const types = p.types || [];
      // Use the search-source tag first, then fall back to type/name classification
      const cat = classifyCategory(types, p.name || '');
      // If the source tag is one of the allowed categories, trust it;
      // otherwise use the classifier result. Either way, exclude if not valid.
      const category = (p._srcCategory && p._srcCategory !== 'exclude')
        ? p._srcCategory
        : cat;
      if (category === 'exclude') continue;
      filtered.push({ ...p, _resolvedCategory: category });
    }

    // Compute distance and V1 score for each spot
    const R = 3958.8;
    const toRad = (d) => (d * Math.PI) / 180;

    const scored = filtered.map((p) => {
      const pLat = p.lat;
      const pLng = p.lng;
      let distMi = null;
      if (pLat != null && pLng != null) {
        const dLat = toRad(pLat - lat);
        const dLng = toRad(pLng - lng);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(pLat)) * Math.sin(dLng / 2) ** 2;
        distMi = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      const category = p._resolvedCategory;
      const isOpenNow = p.openNow ?? null;

      // ── V1 Score ──
      const categoryWeight = TIME_CATEGORY_WEIGHTS[category] || 0.3;
      const distScore = distMi != null ? Math.max(0, 1 - distMi / radiusMiles) : 0.5;
      const openScore = isOpenNow === true ? 1.0 : isOpenNow === false ? 0.0 : 0.5;
      const ratingScore = p.rating ? Math.min(1, (p.rating - 3.0) / 2.0) : 0.4;
      const score = categoryWeight * 0.4 + distScore * 0.3 + openScore * 0.15 + ratingScore * 0.15;

      // Prefer stored image (consistent with restaurant detail) over Nearby Search photo
      const known = p.placeId ? findRestaurantByPlaceId(p.placeId) : null;
      let imageUrl = null;
      if (known?.displayImageUrl) {
        imageUrl = toAbsoluteImageUrl(known.displayImageUrl);
      } else if (p.photoRef) {
        imageUrl = toAbsoluteImageUrl(`/api/place-photo?ref=${encodeURIComponent(p.photoRef)}&maxW=400`);
      }

      return {
        restaurantId: p.placeId || `after_${p.name}`,
        name: p.name || 'Unknown',
        distanceMi: distMi != null ? Math.round(distMi * 10) / 10 : null,
        vibeTag: categoryLabel(category),
        category,
        rating: p.rating || null,
        isOpenNow,
        imageUrl,
        address: p.address || null,
        _score: score,
        _category: category,
      };
    }).filter((s) => s.distanceMi == null || s.distanceMi <= radiusMiles);

    // Sort by score descending
    scored.sort((a, b) => b._score - a._score);

    // ── Category diversity: ensure at least 1 from each available category ──
    const catBuckets = { drinks: [], coffee: [], dessert: [] };
    for (const s of scored) {
      if (catBuckets[s._category]) catBuckets[s._category].push(s);
    }
    const finalSpots = [];
    const usedIds = new Set();

    // First pass: guarantee 1 from each non-empty category
    for (const cat of ['drinks', 'coffee', 'dessert']) {
      if (catBuckets[cat].length > 0 && finalSpots.length < limit) {
        const pick = catBuckets[cat][0];
        finalSpots.push(pick);
        usedIds.add(pick.restaurantId);
      }
    }

    // Fill remaining slots by score
    for (const s of scored) {
      if (finalSpots.length >= limit) break;
      if (usedIds.has(s.restaurantId)) continue;
      finalSpots.push(s);
      usedIds.add(s.restaurantId);
    }

    // Clean internal fields
    const spots = finalSpots.map(({ _score, _category, ...rest }) => rest);

    console.log('[BiteRight] next-stop result', { merged: merged.length, filtered: filtered.length, scored: scored.length, spots: spots.length });
    return res.json({ spots, isEvening });
  } catch (err) {
    console.error('[BiteRight] next-stop error:', err.message);
    return res.status(502).json({ error: 'Failed to load nearby spots' });
  }
});

// ── Strict category classification for Next stop ──
// Returns 'drinks' | 'coffee' | 'dessert' | 'exclude'.
// Anything that isn't confidently one of the three allowed buckets gets excluded.
const DRINKS_TYPES = new Set(['bar', 'night_club', 'wine_bar']);
const DRINKS_NAME_RE = /\b(bar|cocktail|lounge|speakeasy|wine|pub|brewery|taproom|tavern|beer hall|beer garden)\b/i;

const COFFEE_TYPES = new Set(['coffee_shop', 'cafe']);
const COFFEE_NAME_RE = /\b(coffee|cafe|café|espresso|tea house|tea room)\b/i;

const DESSERT_TYPES = new Set(['dessert_shop', 'ice_cream_shop', 'bakery']);
const DESSERT_NAME_RE = /\b(dessert|ice cream|gelato|bakery|patisserie|pâtisserie|pastry|donut|doughnut|cupcake|frozen yogurt|froyo|crêpe|crepe)\b/i;

// Types that signal "this is a regular restaurant, not a next-stop place"
const RESTAURANT_TYPES = new Set(['restaurant', 'meal_takeaway', 'meal_delivery', 'food']);

function classifyCategory(types, name) {
  const nameLower = (name || '').toLowerCase();
  const typeSet = new Set(types || []);

  // Check coffee first — cafes that also serve food are "coffee" for Next stop
  if ([...COFFEE_TYPES].some((t) => typeSet.has(t)) || COFFEE_NAME_RE.test(nameLower)) return 'coffee';

  // Check dessert
  if ([...DESSERT_TYPES].some((t) => typeSet.has(t)) || DESSERT_NAME_RE.test(nameLower)) return 'dessert';

  // Check drinks
  if ([...DRINKS_TYPES].some((t) => typeSet.has(t)) || DRINKS_NAME_RE.test(nameLower)) return 'drinks';

  // Everything else is excluded — generic restaurants, food spots, etc.
  return 'exclude';
}

// User-facing label for the card. Only the three allowed categories.
const CATEGORY_LABELS = {
  drinks: 'Drinks \u{1F378}',
  coffee: 'Coffee \u2615',
  dessert: 'Dessert \u{1F370}',
};

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || null;
}

// ─── Menu refresh worker ────────────────────────────────────────────────────
// Periodically re-runs extraction on stale cache rows so users hit fresh
// data on their next view. Lightweight: max 25 entries per run, 6h interval,
// runs in-process. On Render free tier the server sleeps when idle so the
// interval pauses too — that's fine, refreshes resume when traffic resumes.

const MENU_REFRESH_BATCH = 25;
const MENU_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const MENU_REFRESH_STARTUP_DELAY_MS = 60 * 1000;     // 1 min after boot

async function refreshOneMenu(restaurantId) {
  try {
    const info = await getRestaurantInfo(restaurantId);
    const websiteUrl = info?.websiteUrl || null;
    if (!websiteUrl) {
      // No URL = nothing to re-extract. Push the refresh deadline out so we
      // don't churn on this row every cycle.
      await writeCachedMenu({
        restaurantId, sections: [], sourceType: 'generic_scrape',
        sourceUrl: null, qualityScore: 0, status: 'failed',
      });
      return;
    }
    const extracted = await extractMenuFromUrl(websiteUrl);
    if (extracted && extracted.sections && extracted.sections.length > 0) {
      const { score } = scoreMenu(extracted.sections);
      const status =
        score >= MENU_QUALITY_THRESHOLD ? 'success' : 'low_quality';
      await writeCachedMenu({
        restaurantId,
        sections: status === 'success' ? extracted.sections : [],
        sourceType: extracted.source,
        sourceUrl: websiteUrl,
        pdfUrl: extracted.pdfUrl ?? null,
        rawData: extracted.rawData,
        qualityScore: score,
        status,
      });
      return;
    }
    await writeCachedMenu({
      restaurantId, sections: [], sourceType: 'generic_scrape',
      sourceUrl: websiteUrl, qualityScore: 0, status: 'failed',
    });
  } catch (e) {
    console.error('[menu-refresh] entry error', restaurantId, e?.message);
  }
}

async function refreshStaleMenus() {
  if (!supabaseConfigured) return;
  try {
    const { data: stale, error } = await supabase
      .from('restaurant_menus')
      .select('restaurant_id')
      .lt('next_refresh_at', new Date().toISOString())
      .neq('scrape_status', 'blocked')
      .order('next_refresh_at', { ascending: true })
      .limit(MENU_REFRESH_BATCH);
    if (error) {
      console.error('[menu-refresh] select error', error.message);
      return;
    }
    if (!stale || stale.length === 0) return;
    console.log(`[menu-refresh] processing ${stale.length} stale entries`);
    // Sequential to avoid hammering the same host; PDFs + Puppeteer are heavy.
    for (const row of stale) {
      await refreshOneMenu(row.restaurant_id);
    }
    console.log('[menu-refresh] batch complete');
  } catch (e) {
    console.error('[menu-refresh] worker error', e?.message);
  }
}

setTimeout(() => {
  refreshStaleMenus();
  setInterval(refreshStaleMenus, MENU_REFRESH_INTERVAL_MS);
}, MENU_REFRESH_STARTUP_DELAY_MS);

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
