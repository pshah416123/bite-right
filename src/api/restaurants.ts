import axios from 'axios';
import { Platform } from 'react-native';
import { apiClient } from './client';
import { RESTAURANTS } from '../data/restaurants';

// Pipeline (formerly port 4100) is now the same backend as the main API in prod.
// In local dev, fall back to localhost:4100 / 10.0.2.2:4100.
const pipelineDevFallback =
  Platform.OS === 'android' ? 'http://10.0.2.2:4100' : 'http://localhost:4100';

const pipelineClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL ?? pipelineDevFallback,
  timeout: 8000,
});

export interface SearchHealth {
  ok: boolean;
  googleConfigured: boolean;
}

/** Call this to show setup hints when real search isn't available. */
export async function getSearchHealth(): Promise<SearchHealth | null> {
  try {
    const { data } = await apiClient.get<SearchHealth>('/api/health', { timeout: 5000 });
    return data;
  } catch {
    return null;
  }
}

export interface AutocompleteSuggestion {
  placeId: string;
  name: string;
  address: string;
}

/** Fallback when Google returns no results so the dropdown still populates */
export function getMockSuggestions(query: string): AutocompleteSuggestion[] {
  if (!query || query.trim().length < 2) return [];
  const q = query.toLowerCase().trim();
  return RESTAURANTS.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.cuisine.toLowerCase().includes(q) ||
      r.neighborhood.toLowerCase().includes(q),
  )
    .slice(0, 6)
    .map((r) => ({
      placeId: `mock_${r.id}`,
      name: r.name,
      address: [r.neighborhood, r.state].filter(Boolean).join(', '),
    }));
}

/** When nothing matches, show these so the dropdown doesn’t disappear */
export function getSampleSuggestions(): AutocompleteSuggestion[] {
  return RESTAURANTS.slice(0, 3).map((r) => ({
    placeId: `mock_${r.id}`,
    name: r.name,
    address: [r.neighborhood, r.state].filter(Boolean).join(', '),
  }));
}

export interface SelectedRestaurant {
  restaurantId: string;
  placeId: string;
  googlePlaceId?: string | null;
  name: string;
  address: string;
  cuisine?: string | null;
  neighborhood?: string | null;
  lat?: number;
  lng?: number;
  displayImageUrl?: string | null;
  displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
  displayImageLastResolvedAt?: string | null;
  fallbackPhotoUrl?: string;
}

export async function fetchAutocomplete(
  query: string,
  coords?: { lat: number; lng: number } | null,
): Promise<AutocompleteSuggestion[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    const params: Record<string, string | number> = { query: query.trim() };
    if (coords) {
      params.lat = coords.lat;
      params.lng = coords.lng;
    }
    const { data } = await apiClient.get<AutocompleteSuggestion[]>(
      '/api/restaurants/autocomplete',
      { params },
    );
    const list = Array.isArray(data) ? data : [];
    const mock = getMockSuggestions(query);
    const sample = getSampleSuggestions();
    const seen = new Set<string>();
    const combined: AutocompleteSuggestion[] = [];

    // Prefer real Google results first, but always merge mock restaurants too
    // so Discover and Log Visit stay consistent.
    for (const item of list) {
      if (!item?.placeId || seen.has(item.placeId)) continue;
      seen.add(item.placeId);
      combined.push(item);
    }
    for (const item of mock) {
      if (!item?.placeId || seen.has(item.placeId)) continue;
      seen.add(item.placeId);
      combined.push(item);
    }
    for (const item of sample) {
      if (!item?.placeId || seen.has(item.placeId)) continue;
      seen.add(item.placeId);
      combined.push(item);
    }

    // If Google returned nothing, we still fall back to mock/sample suggestions.
    if (combined.length > 0) return combined;
    return [];
  } catch {
    const mock = getMockSuggestions(query);
    if (mock.length > 0) return mock;
    return getSampleSuggestions();
  }
}

export async function selectRestaurant(placeId: string): Promise<SelectedRestaurant> {
  const { data } = await apiClient.post<SelectedRestaurant>('/api/restaurants/select', {
    placeId,
  });
  return data;
}

/** Cycle to the next Google photo candidate for a restaurant. */
export async function cycleRestaurantPhoto(
  restaurantId: string,
): Promise<{ ok: boolean; imageUrl: string | null; photoIndex: number; totalCandidates: number }> {
  const { data } = await apiClient.post<{
    ok: boolean;
    imageUrl: string | null;
    photoIndex: number;
    totalCandidates: number;
  }>(`/api/restaurants/${encodeURIComponent(restaurantId)}/next-photo`);
  return data;
}

export type ReservationProvider =
  | 'opentable'
  | 'resy'
  | 'sevenrooms'
  | 'tock'
  | 'yelp'
  | 'website'
  | 'phone';

export interface ReservationLink {
  id: string;
  restaurantId: string;
  provider: ReservationProvider;
  url: string | null;
  phoneNumber: string | null;
  providerRestaurantId: string | null;
  isPrimary: boolean;
  lastVerifiedAt: string | null;
}

export interface RestaurantDetail {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  websiteUrl: string | null;
  googleMapsUrl: string | null;
  phone: string | null;
  reservationUrl: string | null;
  /** External reservation/booking options. Empty array when none. */
  reservationLinks?: ReservationLink[];
  /** Google Places place_id when known (enriched). */
  placeId?: string | null;
  googlePlaceId?: string | null;
  displayImageUrl?: string | null;
  displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
  displayImageLastResolvedAt?: string | null;
  previewPhotoUrl?: string | null;
  /** Resolved card/feed image (relative proxy path or full URL). Use for feed when user doesn't add photos. */
  imageUrl: string | null;
  /** Opening hours from Google Places (array of strings like "Monday: 11:00 AM – 10:00 PM"). */
  hours?: string[] | null;
  /** Whether the restaurant is currently open. */
  isOpenNow?: boolean | null;
  /** Present when `?debug=1` on GET /api/restaurants/:id */
  imageSource?: string;
}

export interface MenuPhoto {
  url: string;
  width: number;
  height: number;
}

export interface MenuItem {
  name: string;
  description: string | null;
  price: string | null;
  tags: string[] | null;
  photoUrl: string | null;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

export interface RestaurantMenu {
  sections: MenuSection[];
  menuPhotos: MenuPhoto[];
  source: 'scraped' | 'photos' | 'curated' | null;
}

/** Fetch restaurant detail for Reserve and detail view. Returns null on 404 or error. */
export async function getRestaurantDetail(restaurantId: string): Promise<RestaurantDetail | null> {
  try {
    const { data } = await apiClient.get<RestaurantDetail>(
      `/api/restaurants/${encodeURIComponent(restaurantId)}`,
    );
    return data;
  } catch {
    return null;
  }
}

const EMPTY_MENU: RestaurantMenu = { sections: [], menuPhotos: [], source: null };

/** Fetch menu from Supabase pipeline first, fall back to legacy server scraping. */
export async function getRestaurantMenu(restaurantId: string): Promise<RestaurantMenu> {
  // Try pipeline (Supabase-backed menus) first — lookup by place_id
  try {
    const { data } = await pipelineClient.get<RestaurantMenu>(
      `/api/restaurants/by-place/${encodeURIComponent(restaurantId)}/menu`,
    );
    if (data && Array.isArray(data.sections) && data.sections.length > 0) {
      return data;
    }
  } catch {
    // Pipeline unavailable or no match — fall through to legacy server
  }

  // Fall back to existing server/index.js scraping
  try {
    const { data } = await apiClient.get<RestaurantMenu>(
      `/api/restaurants/${encodeURIComponent(restaurantId)}/menu`,
    );
    return data ?? EMPTY_MENU;
  } catch {
    return EMPTY_MENU;
  }
}

/**
 * Search for a restaurant by name using the autocomplete endpoint,
 * then select the best match to get its image URL.
 * Returns resolved image URL or null.
 */
export async function searchRestaurantImageByName(
  name: string,
  coords?: { lat: number; lng: number } | null,
): Promise<{ imageUrl: string | null; placeId: string | null }> {
  try {
    const suggestions = await fetchAutocomplete(name, coords);
    if (!suggestions.length) return { imageUrl: null, placeId: null };

    // Use the first suggestion (best match)
    const best = suggestions[0];
    if (!best.placeId || best.placeId.startsWith('mock_')) {
      return { imageUrl: null, placeId: null };
    }

    // Select to create a server-side record and get image
    const selected = await selectRestaurant(best.placeId);
    const imageUrl =
      selected.displayImageUrl ?? selected.fallbackPhotoUrl ?? null;

    return { imageUrl, placeId: selected.placeId ?? best.placeId };
  } catch {
    return { imageUrl: null, placeId: null };
  }
}

// ── Nearby "after" spots ──────────────────────────────────────────────────

export interface NearbyAfterSpot {
  restaurantId: string;
  name: string;
  distanceMi: number | null;
  vibeTag: string | null;
  category: string | null;
  rating: number | null;
  isOpenNow: boolean | null;
  imageUrl: string | null;
  address: string | null;
}

export async function getNearbyAfterSpots(
  lat: number,
  lng: number,
  radiusMiles?: number,
): Promise<{ spots: NearbyAfterSpot[]; isEvening: boolean }> {
  try {
    const { data } = await apiClient.get<{ spots: NearbyAfterSpot[]; isEvening: boolean }>(
      '/api/nearby-after',
      { params: { lat, lng, radiusMiles: radiusMiles ?? 0.75 } },
    );
    return data;
  } catch {
    return { spots: [], isEvening: false };
  }
}
