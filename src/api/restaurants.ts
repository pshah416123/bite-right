import { apiClient } from './client';
import { RESTAURANTS } from '../data/restaurants';

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
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  fallbackPhotoUrl?: string;
}

export async function fetchAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    const { data } = await apiClient.get<AutocompleteSuggestion[]>(
      '/api/restaurants/autocomplete',
      { params: { query: query.trim() } },
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

export interface RestaurantDetail {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  websiteUrl: string | null;
  googleMapsUrl: string | null;
  phone: string | null;
  reservationUrl: string | null;
  /** Google Places place_id when known (enriched). */
  placeId?: string | null;
  /** Resolved card/feed image (relative proxy path or full URL). Use for feed when user doesn't add photos. */
  imageUrl: string | null;
  /** Present when `?debug=1` on GET /api/restaurants/:id */
  imageSource?: string;
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
