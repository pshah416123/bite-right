import { apiClient } from './client';

export interface DiscoverRecommendation {
  restaurant: {
    id: string;
    name: string;
    address?: string;
    neighborhood?: string;
    cuisine?: string;
    priceLevel?: number;
    placeId?: string | null;
    /** Resolved image URL (https or relative). Never a photo_reference. Always populated by backend. */
    imageUrl?: string;
  };
  percentMatch: number;
  explanations: string[];
}

export interface DiscoverResponse {
  recommendations: DiscoverRecommendation[];
  location?: { lat: number; lng: number };
  radiusMiles?: number;
}

export type DiscoverMode = 'nearby' | 'location';

export async function getDiscover(opts: {
  mode: DiscoverMode;
  lat?: number;
  lng?: number;
  query?: string;
  radiusMiles?: number;
}): Promise<DiscoverResponse> {
  const params: Record<string, string> = {
    mode: opts.mode,
    radiusMiles: String(opts.radiusMiles ?? 10),
  };
  if (opts.mode === 'nearby') {
    if (opts.lat != null && opts.lng != null) {
      params.lat = String(opts.lat);
      params.lng = String(opts.lng);
    }
  } else {
    if (opts.query) params.query = opts.query;
  }
  const { data } = await apiClient.get<DiscoverResponse>('/api/discover', { params });
  return data;
}
