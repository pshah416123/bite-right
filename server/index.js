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
/** @type {Array<{ id: string; userId: string; restaurantId: string; savedAt: string; source: string; note?: string }>} */
const savedRestaurants = [];

/** Static restaurant info for rest_1..rest_5 (Chicago). Google-selected places are in `restaurants`. */
const STATIC_RESTAURANTS = {
  rest_1: { name: "Lou Malnati's", address: 'River North, IL', city: 'Chicago', neighborhood: 'River North', lat: 41.8902, lng: -87.6369, previewPhotoUrl: 'https://placehold.co/800x600/e5e7eb/6b7280?text=No+photo', websiteUrl: 'https://www.loumalnatis.com', phone: '+1-312-828-9800' },
  rest_2: { name: 'Girl & the Goat', address: 'West Loop, IL', city: 'Chicago', neighborhood: 'West Loop', lat: 41.8815, lng: -87.6472, previewPhotoUrl: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=800', websiteUrl: 'https://www.girlandthegoat.com', googleMapsUrl: 'https://maps.google.com/?cid=123' },
  rest_3: { name: "Portillo's", address: 'River North, IL', city: 'Chicago', neighborhood: 'River North', lat: 41.8902, lng: -87.6369, previewPhotoUrl: 'https://images.pexels.com/photos/461198/pexels-photo-461198.jpeg?auto=compress&cs=tinysrgb&w=800', websiteUrl: 'https://www.portillos.com' },
  rest_4: { name: 'The Purple Pig', address: 'Magnificent Mile, IL', city: 'Chicago', neighborhood: 'Magnificent Mile', lat: 41.8904, lng: -87.6242, previewPhotoUrl: 'https://images.pexels.com/photos/4194626/pexels-photo-4194626.jpeg?auto=compress&cs=tinysrgb&w=800', websiteUrl: 'https://www.thepurplepigchicago.com' },
  rest_5: { name: 'Au Cheval', address: 'West Loop, IL', city: 'Chicago', neighborhood: 'West Loop', lat: 41.8815, lng: -87.6472, previewPhotoUrl: 'https://images.pexels.com/photos/1639557/pexels-photo-1639557.jpeg?auto=compress&cs=tinysrgb&w=800', websiteUrl: 'https://www.aucheval.com' },
};

function getRestaurantInfo(restaurantId) {
  // rest_1..rest_5 are always the static Chicago list (Lou Malnati's, etc.). Prefer static over DB so Reserve/labels stay correct.
  const stat = STATIC_RESTAURANTS[restaurantId];
  if (stat) {
    return {
      restaurantId,
      ...stat,
      websiteUrl: stat.websiteUrl || null,
      googleMapsUrl: stat.googleMapsUrl || null,
      phone: stat.phone || null,
      reservationUrl: stat.reservationUrl || stat.websiteUrl || null,
    };
  }
  const fromDb = findRestaurantById(restaurantId);
  if (fromDb) {
    return {
      restaurantId: fromDb.restaurantId,
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
const IMAGE_SOURCE = { USER_PHOTO: 'USER_PHOTO', LOG_PHOTO: 'LOG_PHOTO', PLACES: 'PLACES', STATIC: 'STATIC', PLACEHOLDER: 'PLACEHOLDER' };

/**
 * Resolve the image URL for a restaurant card. Used by both Feed and Discover.
 * Priority: 1) logPreviewPhotoUrl 2) first log photo 3) restaurant.bestFoodPhotoUrl
 * 4) fetch Place Details photos → pick best → cache 5) static preview or NEUTRAL_PLACEHOLDER_URL.
 * @returns {Promise<{ url: string; source: string }>} Always returns url; source is for dev logging.
 */
async function resolveRestaurantCardImageWithSource(restaurantId, placeId, logPreviewPhotoUrl) {
  if (logPreviewPhotoUrl && typeof logPreviewPhotoUrl === 'string' && logPreviewPhotoUrl.trim()) {
    return { url: logPreviewPhotoUrl.trim(), source: IMAGE_SOURCE.USER_PHOTO };
  }
  const logForRestaurant = logs.find((l) => l.restaurantId === restaurantId);
  const firstLogPhoto = Array.isArray(logForRestaurant?.photos) && logForRestaurant.photos.length > 0
    ? logForRestaurant.photos[0]
    : undefined;
  if (firstLogPhoto && typeof firstLogPhoto === 'string' && firstLogPhoto.trim()) {
    return { url: firstLogPhoto.trim(), source: IMAGE_SOURCE.LOG_PHOTO };
  }

  const fromDb = findRestaurantById(restaurantId);
  const staticInfo = STATIC_RESTAURANTS[restaurantId];

  if (fromDb?.bestFoodPhotoUrl) {
    return { url: fromDb.bestFoodPhotoUrl, source: IMAGE_SOURCE.PLACES };
  }
  if (staticInfo?.previewPhotoUrl) {
    return { url: staticInfo.previewPhotoUrl, source: IMAGE_SOURCE.STATIC };
  }

  if (placeId && GOOGLE_PLACES_API_KEY) {
    const details = await googlePlaceDetails(placeId);
    const photoRefs = details?.photos?.slice(0, 10)?.map((p) => p.photo_reference).filter(Boolean) || [];
    if (photoRefs.length > 0) {
      const chosenRef = photoRefs[0];
      if (fromDb) {
        fromDb.bestFoodPhotoRef = chosenRef;
        fromDb.bestFoodPhotoUrl = buildPhotoProxyUrl(restaurantId);
        fromDb.bestFoodPhotoUpdatedAt = new Date().toISOString();
      }
      const url = fromDb ? fromDb.bestFoodPhotoUrl : buildPhotoProxyUrl(restaurantId);
      return { url, source: IMAGE_SOURCE.PLACES };
    }
  }

  if (fromDb?.fallbackPhotoUrl) {
    return { url: fromDb.fallbackPhotoUrl, source: IMAGE_SOURCE.PLACES };
  }
  if (fromDb?.fallbackPhotoRef && !fromDb.fallbackPhotoUrl) {
    fromDb.fallbackPhotoUrl = buildPhotoProxyUrl(restaurantId);
    return { url: fromDb.fallbackPhotoUrl, source: IMAGE_SOURCE.PLACES };
  }

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
  const { restaurantId, rating, notes, photos } = req.body || {};

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
  res.json({
    name: info.name,
    address: info.address || '',
    lat: info.lat ?? null,
    lng: info.lng ?? null,
    websiteUrl: info.websiteUrl || null,
    googleMapsUrl: info.googleMapsUrl || null,
    phone: info.phone || null,
    reservationUrl: info.reservationUrl || null,
    imageUrl: toAbsoluteImageUrl(info.previewPhotoUrl) || null,
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

// Static pool for MVP — 5 Chicago restaurants (matches app data). lat/lng for distance filter.
const TONIGHT_POOL = [
  { restaurantId: 'rest_1', name: "Lou Malnati's", address: 'River North, IL', lat: 41.8902, lng: -87.6369, previewPhotoUrl: 'https://placehold.co/800x600/e5e7eb/6b7280?text=No+photo' },
  { restaurantId: 'rest_2', name: 'Girl & the Goat', address: 'West Loop, IL', lat: 41.8815, lng: -87.6472, previewPhotoUrl: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=800' },
  { restaurantId: 'rest_3', name: "Portillo's", address: 'River North, IL', lat: 41.8902, lng: -87.6369, previewPhotoUrl: 'https://images.pexels.com/photos/461198/pexels-photo-461198.jpeg?auto=compress&cs=tinysrgb&w=800' },
  { restaurantId: 'rest_4', name: 'The Purple Pig', address: 'Magnificent Mile, IL', lat: 41.8904, lng: -87.6242, previewPhotoUrl: 'https://images.pexels.com/photos/4194626/pexels-photo-4194626.jpeg?auto=compress&cs=tinysrgb&w=800' },
  { restaurantId: 'rest_5', name: 'Au Cheval', address: 'West Loop, IL', lat: 41.8815, lng: -87.6472, previewPhotoUrl: 'https://images.pexels.com/photos/1639557/pexels-photo-1639557.jpeg?auto=compress&cs=tinysrgb&w=800' },
];

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

// GET /api/tonight/sessions/:code/pool
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
  const start = page * pageSize;
  const slice = TONIGHT_POOL.slice(start, start + pageSize);
  const pool = await Promise.all(
    slice.map(async (r) => {
      const fromDb = findRestaurantById(r.restaurantId);
      const rawUrl = await resolveRestaurantCardImage(r.restaurantId, fromDb?.placeId ?? null, r.previewPhotoUrl);
      return {
        restaurantId: r.restaurantId,
        name: r.name,
        address: r.address,
        placeId: fromDb?.placeId ?? null,
        previewPhotoUrl: toAbsoluteImageUrl(r.previewPhotoUrl),
        imageUrl: toAbsoluteImageUrl(rawUrl),
      };
    }),
  );
  res.json({
    pool,
    total: TONIGHT_POOL.length,
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
      if (!info) return null;
      return {
        restaurantId: s.restaurantId,
        name: info.name,
        address: info.address,
        city: info.city || null,
        neighborhood: info.neighborhood || null,
        lat: info.lat,
        lng: info.lng,
        previewPhotoUrl: toAbsoluteImageUrl(info.previewPhotoUrl) || null,
        savedAt: s.savedAt,
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

// --- Discover (location filter) ---------------------------------------------

// GET /api/discover?mode=nearby&lat=&lng=&radiusMiles=10  OR  mode=location&query=Chicago%20Loop&radiusMiles=10
app.get('/api/discover', async (req, res) => {
  const mode = (req.query.mode || 'nearby').toLowerCase();
  const radiusMiles = Math.min(50, Math.max(0.5, parseFloat(req.query.radiusMiles) || 10));
  let lat = parseFloat(req.query.lat);
  let lng = parseFloat(req.query.lng);

  if (mode === 'location') {
    const query = (req.query.query || '').trim();
    if (!query) {
      return res.status(400).json({ error: 'query required when mode=location' });
    }
    const geo = await geocodeQuery(query);
    if (!geo) {
      return res.status(400).json({ error: 'Could not geocode location' });
    }
    lat = geo.lat;
    lng = geo.lng;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng required for mode=nearby, or use mode=location with query' });
  }

  const withScores = TONIGHT_POOL.map((r) => {
    const dist = distanceMiles(lat, lng, r.lat || 41.88, r.lng || -87.63);
    const inRadius = dist <= radiusMiles;
    const percentMatch = inRadius ? Math.round(100 - Math.min(90, dist * 2)) : 0;
    return {
      restaurantId: r.restaurantId,
      name: r.name,
      address: r.address,
      percentMatch: Math.max(10, percentMatch),
      inRadius,
    };
  })
    .filter((r) => r.percentMatch > 0)
    .sort((a, b) => b.percentMatch - a.percentMatch);

  const recommendations = await Promise.all(
    withScores.map(async (r) => {
      const rawUrl = await resolveRestaurantCardImage(r.restaurantId, null, undefined);
      return {
        restaurant: {
          id: r.restaurantId,
          name: r.name,
          address: r.address,
          neighborhood: r.address?.split(',')[0] || null,
          cuisine: '',
          priceLevel: 2,
          placeId: findRestaurantById(r.restaurantId)?.placeId ?? null,
          imageUrl: toAbsoluteImageUrl(rawUrl),
        },
        percentMatch: r.percentMatch,
        explanations: r.inRadius ? ['Nearby'] : [],
      };
    }),
  );

  res.json({
    recommendations,
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

