import { apiClient } from './client';

/** Single saved restaurant entry (API and app model). Use place_id as unique id. */
export interface SavedRestaurantItem {
  restaurantId: string;
  place_id: string;
  name: string;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  previewPhotoUrl: string | null;
  savedAt: string;
  source: 'swipe' | 'manual';
  rating?: number | null;
  price_level?: number | null;
}

/** Payload to save a restaurant (from swipe card, restaurant page, etc.). */
export interface SaveRestaurantPayload {
  place_id: string;
  name: string;
  photo?: string | null;
  cuisine?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  cuisines?: string[];
  rating?: number | null;
  price_level?: number | null;
}

export async function getSavedRestaurants(
  userId: string,
  opts: { sort?: 'location' | 'distance' | 'recent'; lat?: number; lng?: number } = {},
): Promise<SavedRestaurantItem[]> {
  const params: Record<string, string> = {
    sort: opts.sort === 'distance' ? 'distance' : opts.sort === 'recent' ? 'location' : 'location',
  };
  if (opts.sort === 'distance' && opts.lat != null && opts.lng != null) {
    params.lat = String(opts.lat);
    params.lng = String(opts.lng);
  }
  const { data } = await apiClient.get<SavedRestaurantItem[]>(
    `/api/users/${encodeURIComponent(userId)}/saved`,
    { params },
  );
  const list = Array.isArray(data) ? data : [];
  // Normalize place_id for older responses
  const normalized = list.map((item) => ({
    ...item,
    place_id: item.place_id ?? item.restaurantId,
    source: item.source === 'swipe' ? 'swipe' : 'manual',
  }));
  if (opts.sort === 'recent') {
    normalized.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }
  return normalized;
}

export async function addSavedRestaurant(
  userId: string,
  payload: SaveRestaurantPayload,
  source: 'swipe' | 'manual',
): Promise<{ saved: boolean; alreadySaved: boolean }> {
  const body = {
    restaurantId: payload.place_id,
    source,
    name: payload.name,
    photo: payload.photo ?? undefined,
    cuisine: payload.cuisine ?? undefined,
    neighborhood: payload.neighborhood ?? undefined,
    address: payload.address ?? undefined,
    lat: payload.lat ?? undefined,
    lng: payload.lng ?? undefined,
    cuisines: payload.cuisines ?? undefined,
  };
  if (__DEV__) {
    console.log('[SavedAPI] POST /saved payload', body);
  }
  const { data } = await apiClient.post<{
    ok: boolean;
    saved: boolean;
    alreadySaved?: boolean;
    restaurantId?: string;
  }>(`/api/users/${encodeURIComponent(userId)}/saved`, body);
  if (__DEV__) {
    console.log('[SavedAPI] POST /saved response', data);
  }
  return {
    saved: data.saved === true,
    alreadySaved: data.alreadySaved === true,
  };
}

export async function removeSavedRestaurant(userId: string, placeId: string): Promise<void> {
  await apiClient.delete(
    `/api/users/${encodeURIComponent(userId)}/saved/${encodeURIComponent(placeId)}`,
  );
}
