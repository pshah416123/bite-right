/**
 * Data access layer for Phase 1 tables: restaurants, logs, saved_restaurants.
 *
 * When Supabase is configured, reads/writes go to the database.
 * Otherwise, falls back to in-memory arrays (dev without credentials).
 */

const { supabase, supabaseConfigured } = require('./supabase');

// ---------------------------------------------------------------------------
// In-memory fallback stores (same arrays the server used before)
// ---------------------------------------------------------------------------
const _mem = {
  restaurants: [],
  logs: [],
  savedRestaurants: [],
};

// ---------------------------------------------------------------------------
// Column mapping: server camelCase ↔ Supabase snake_case
// ---------------------------------------------------------------------------

function restaurantToRow(r) {
  return {
    id: r.restaurantId,
    place_id: r.placeId ?? r.googlePlaceId ?? null,
    name: r.name,
    address: r.address ?? null,
    city: r.city ?? null,
    neighborhood: r.neighborhood ?? null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    website_url: r.websiteUrl ?? null,
    google_maps_url: r.googleMapsUrl ?? null,
    phone: r.phone ?? null,
    reservation_url: r.reservationUrl ?? null,
    display_image_url: r.displayImageUrl ?? null,
    display_image_source_type: r.displayImageSourceType ?? null,
    display_image_last_resolved_at: r.displayImageLastResolvedAt ?? null,
    display_image_photo_reference: r.displayImagePhotoReference ?? null,
    created_at: r.createdAt ?? new Date().toISOString(),
  };
}

function rowToRestaurant(row) {
  return {
    restaurantId: row.id,
    placeId: row.place_id,
    googlePlaceId: row.place_id,
    name: row.name,
    address: row.address,
    city: row.city,
    neighborhood: row.neighborhood,
    lat: row.lat,
    lng: row.lng,
    websiteUrl: row.website_url,
    googleMapsUrl: row.google_maps_url,
    phone: row.phone,
    reservationUrl: row.reservation_url,
    displayImageUrl: row.display_image_url,
    displayImageSourceType: row.display_image_source_type,
    displayImageLastResolvedAt: row.display_image_last_resolved_at,
    displayImagePhotoReference: row.display_image_photo_reference,
    createdAt: row.created_at,
  };
}

function logToRow(l) {
  return {
    id: l.id,
    restaurant_id: l.restaurantId,
    user_id: l.userId ?? 'default',
    user_name: l.userName ?? null,
    rating: l.rating,
    notes: l.notes ?? null,
    photos: l.photos ?? null,
    preview_photo_url: l.previewPhotoUrl ?? null,
    standout_dish: l.standoutDish ?? null,
    dishes: l.dishes ?? null,
    vibe_tags: l.vibeTags ?? null,
    quick_tip: l.quickTip ?? null,
    highlight: l.highlight ?? null,
    created_at: l.createdAt ?? new Date().toISOString(),
  };
}

function rowToLog(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    userId: row.user_id,
    userName: row.user_name ?? null,
    rating: Number(row.rating),
    notes: row.notes,
    photos: row.photos,
    previewPhotoUrl: row.preview_photo_url,
    standoutDish: row.standout_dish ?? null,
    dishes: row.dishes ?? null,
    vibeTags: row.vibe_tags ?? null,
    quickTip: row.quick_tip ?? null,
    highlight: row.highlight ?? null,
    createdAt: row.created_at,
  };
}

function savedToRow(s) {
  return {
    id: s.id,
    user_id: s.userId,
    restaurant_id: s.restaurantId,
    source: s.source ?? 'manual',
    note: s.note ?? null,
    snapshot: s.snapshot ?? null,
    saved_at: s.savedAt ?? new Date().toISOString(),
  };
}

function rowToSaved(row) {
  return {
    id: row.id,
    userId: row.user_id,
    restaurantId: row.restaurant_id,
    source: row.source,
    note: row.note,
    snapshot: row.snapshot,
    savedAt: row.saved_at,
  };
}

// ---------------------------------------------------------------------------
// Restaurants
// ---------------------------------------------------------------------------

async function findRestaurantById(id) {
  if (!supabaseConfigured) {
    return _mem.restaurants.find((r) => r.restaurantId === id) ?? null;
  }
  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) { console.error('[db] findRestaurantById error', error.message); return null; }
  return data ? rowToRestaurant(data) : null;
}

async function findRestaurantByPlaceId(placeId) {
  if (!supabaseConfigured) {
    return _mem.restaurants.find((r) => r.placeId === placeId) ?? null;
  }
  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('place_id', placeId)
    .maybeSingle();
  if (error) { console.error('[db] findRestaurantByPlaceId error', error.message); return null; }
  return data ? rowToRestaurant(data) : null;
}

async function insertRestaurant(restaurant) {
  if (!supabaseConfigured) {
    _mem.restaurants.push(restaurant);
    return restaurant;
  }
  const row = restaurantToRow(restaurant);
  const { data, error } = await supabase
    .from('restaurants')
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) {
    console.error('[db] insertRestaurant error', error.message);
    _mem.restaurants.push(restaurant);
    return restaurant;
  }
  return data ? rowToRestaurant(data) : restaurant;
}

async function updateRestaurant(id, updates) {
  if (!supabaseConfigured) {
    const r = _mem.restaurants.find((r) => r.restaurantId === id);
    if (r) Object.assign(r, updates);
    return r ?? null;
  }
  // Convert camelCase updates to snake_case
  const row = {};
  if ('displayImageUrl' in updates) row.display_image_url = updates.displayImageUrl;
  if ('displayImageSourceType' in updates) row.display_image_source_type = updates.displayImageSourceType;
  if ('displayImageLastResolvedAt' in updates) row.display_image_last_resolved_at = updates.displayImageLastResolvedAt;
  if ('displayImagePhotoReference' in updates) row.display_image_photo_reference = updates.displayImagePhotoReference;
  if ('websiteUrl' in updates) row.website_url = updates.websiteUrl;
  if ('googleMapsUrl' in updates) row.google_maps_url = updates.googleMapsUrl;
  if ('phone' in updates) row.phone = updates.phone;
  if ('reservationUrl' in updates) row.reservation_url = updates.reservationUrl;
  if ('placeId' in updates) row.place_id = updates.placeId;
  if ('googlePlaceId' in updates) row.place_id = updates.googlePlaceId;
  if ('name' in updates) row.name = updates.name;
  if ('address' in updates) row.address = updates.address;
  if ('city' in updates) row.city = updates.city;
  if ('neighborhood' in updates) row.neighborhood = updates.neighborhood;
  if ('lat' in updates) row.lat = updates.lat;
  if ('lng' in updates) row.lng = updates.lng;

  if (Object.keys(row).length === 0) return null;

  const { data, error } = await supabase
    .from('restaurants')
    .update(row)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) { console.error('[db] updateRestaurant error', error.message); return null; }
  return data ? rowToRestaurant(data) : null;
}

async function getAllRestaurants() {
  if (!supabaseConfigured) {
    return _mem.restaurants;
  }
  const { data, error } = await supabase.from('restaurants').select('*');
  if (error) { console.error('[db] getAllRestaurants error', error.message); return []; }
  return (data || []).map(rowToRestaurant);
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

async function insertLog(log) {
  if (!supabaseConfigured) {
    _mem.logs.push(log);
    return log;
  }
  const row = logToRow(log);
  const { data, error } = await supabase
    .from('logs')
    .insert(row)
    .select()
    .single();
  if (error) {
    console.error('[db] insertLog error', error.message);
    _mem.logs.push(log);
    return log;
  }
  return rowToLog(data);
}

async function getLogsByUser(userId) {
  if (!supabaseConfigured) {
    return _mem.logs.filter((l) => l.userId === userId);
  }
  const { data, error } = await supabase
    .from('logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.error('[db] getLogsByUser error', error.message); return []; }
  return (data || []).map(rowToLog);
}

async function getAllLogs() {
  if (!supabaseConfigured) {
    return _mem.logs;
  }
  const { data, error } = await supabase
    .from('logs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('[db] getAllLogs error', error.message); return []; }
  return (data || []).map(rowToLog);
}

// ---------------------------------------------------------------------------
// Saved Restaurants
// ---------------------------------------------------------------------------

async function findSavedRestaurant(userId, restaurantId) {
  if (!supabaseConfigured) {
    return _mem.savedRestaurants.find(
      (s) => s.userId === userId && s.restaurantId === restaurantId,
    ) ?? null;
  }
  const { data, error } = await supabase
    .from('saved_restaurants')
    .select('*')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (error) { console.error('[db] findSavedRestaurant error', error.message); return null; }
  return data ? rowToSaved(data) : null;
}

async function getSavedRestaurants(userId) {
  if (!supabaseConfigured) {
    return _mem.savedRestaurants.filter((s) => s.userId === userId);
  }
  const { data, error } = await supabase
    .from('saved_restaurants')
    .select('*')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });
  if (error) { console.error('[db] getSavedRestaurants error', error.message); return []; }
  return (data || []).map(rowToSaved);
}

async function insertSavedRestaurant(saved) {
  if (!supabaseConfigured) {
    _mem.savedRestaurants.push(saved);
    return saved;
  }
  const row = savedToRow(saved);
  const { data, error } = await supabase
    .from('saved_restaurants')
    .upsert(row, { onConflict: 'user_id,restaurant_id' })
    .select()
    .single();
  if (error) {
    console.error('[db] insertSavedRestaurant error', error.message);
    _mem.savedRestaurants.push(saved);
    return saved;
  }
  return rowToSaved(data);
}

async function updateSavedRestaurant(id, updates) {
  if (!supabaseConfigured) {
    const s = _mem.savedRestaurants.find((s) => s.id === id);
    if (s) Object.assign(s, updates);
    return s ?? null;
  }
  const row = {};
  if ('snapshot' in updates) row.snapshot = updates.snapshot;
  if ('source' in updates) row.source = updates.source;
  if ('note' in updates) row.note = updates.note;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from('saved_restaurants')
    .update(row)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) { console.error('[db] updateSavedRestaurant error', error.message); return null; }
  return data ? rowToSaved(data) : null;
}

async function deleteSavedRestaurant(userId, restaurantId) {
  if (!supabaseConfigured) {
    const idx = _mem.savedRestaurants.findIndex(
      (s) => s.userId === userId && s.restaurantId === restaurantId,
    );
    if (idx === -1) return false;
    _mem.savedRestaurants.splice(idx, 1);
    return true;
  }
  const { error, count } = await supabase
    .from('saved_restaurants')
    .delete()
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId);
  if (error) { console.error('[db] deleteSavedRestaurant error', error.message); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// Expose in-memory stores for non-Phase-1 code that still reads them directly
// (tonight pool, discover context, etc.)
// ---------------------------------------------------------------------------

function getMemoryStores() {
  return _mem;
}

module.exports = {
  // Restaurants
  findRestaurantById,
  findRestaurantByPlaceId,
  insertRestaurant,
  updateRestaurant,
  getAllRestaurants,
  // Logs
  insertLog,
  getLogsByUser,
  getAllLogs,
  // Saved
  findSavedRestaurant,
  getSavedRestaurants,
  insertSavedRestaurant,
  updateSavedRestaurant,
  deleteSavedRestaurant,
  // Internal
  getMemoryStores,
  // Column mappers (for code that needs to build rows manually)
  restaurantToRow,
  rowToRestaurant,
};
