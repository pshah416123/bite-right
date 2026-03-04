import { apiClient } from './client';

export interface SavedRestaurantItem {
  restaurantId: string;
  name: string;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  previewPhotoUrl: string | null;
  savedAt: string;
}

export async function getSavedRestaurants(
  userId: string,
  opts: { sort?: 'location' | 'distance'; lat?: number; lng?: number } = {},
): Promise<SavedRestaurantItem[]> {
  const params: Record<string, string> = {
    sort: opts.sort === 'distance' ? 'distance' : 'location',
  };
  if (opts.sort === 'distance' && opts.lat != null && opts.lng != null) {
    params.lat = String(opts.lat);
    params.lng = String(opts.lng);
  }
  const { data } = await apiClient.get<SavedRestaurantItem[]>(
    `/api/users/${encodeURIComponent(userId)}/saved`,
    { params },
  );
  return data;
}
