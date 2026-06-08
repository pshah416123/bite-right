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
    /** Derived cuisine labels from types + name (server). */
    cuisines?: string[];
    googlePlaceId?: string | null;
    lat?: number | null;
    lng?: number | null;
    displayImageUrl?: string | null;
    displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
    displayImageLastResolvedAt?: string | null;
    /** Normalized resolved image field (same chain as Feed). */
    previewPhotoUrl?: string;
    /** Resolved image URL (https or relative). Never a photo_reference. Always populated by backend. */
    imageUrl?: string;
    /** Must-try dish chips — same source as the Tonight pool. */
    recommendedDishes?: { name: string; price?: string | null; description?: string | null }[] | null;
  };
  percentMatch: number;
  explanations: string[];
  /** One standout label: "Pilsen staple", "Hidden gem", "Top rated", etc. */
  heroLabel?: string | null;
  /** 1–2 short cuisine/subcategory tags: "Tacos", "Birria", "Seafood". */
  cardTags?: string[];
  /** One social proof badge per card: friend signal, taste similarity, or trending. */
  socialProofBadge?: string | null;
}

export interface DiscoverSections {
  topPicksForYou: DiscoverRecommendation[];
  becauseYouLiked: DiscoverRecommendation[];
  trendingWithSimilarUsers: DiscoverRecommendation[];
  allNearby: DiscoverRecommendation[];
}

export type DiscoverModeApi = 'trending' | 'blended' | 'clustered';

export interface DiscoverResponse {
  isColdStart: boolean;
  /** Recommendation strategy used: trending (cold start), blended (light personalization), clustered (full collaborative). */
  discoverMode?: DiscoverModeApi;
  sections: DiscoverSections;
  /** Flat list of all nearby (same as sections.allNearby). Kept for backward compatibility. */
  recommendations: DiscoverRecommendation[];
  location?: { lat: number; lng: number };
  radiusMiles?: number;
}

export type DiscoverMode = 'nearby' | 'location';
export type DiscoverSortMode = 'best' | 'nearest' | 'rating' | 'popular' | 'new';
export type DiscoverOccasion = 'brunch' | 'lunch' | 'dinner' | 'bars' | 'dessert' | 'coffee' | 'late_night';

export async function getDiscover(opts: {
  mode: DiscoverMode;
  userId?: string;
  lat?: number;
  lng?: number;
  query?: string;
  radiusMiles?: number;
  /** Cuisine chip label — sent to backend for keyword search + filtering. */
  cuisine?: string | null;
  /** Free-text search term (e.g. "ramen", "bubble tea"). Uses Text Search for precise results. */
  search?: string | null;
  /** Sort mode: 'best' (default ranking) or 'nearest' (distance ascending). */
  sortMode?: DiscoverSortMode;
  /** Occasion filter: brunch, lunch, dinner, bars, dessert, coffee, late_night. */
  occasion?: DiscoverOccasion | null;
  /** Open Now toggle — server filters out places explicitly closed per Google's
   *  open_now flag. Places with unknown status remain in results. */
  openNow?: boolean;
  /** When true, server skips its 5-min discover cache for this one call. Set
   *  by explicit user re-locate actions (e.g. tapping "Near you") so the
   *  result reflects the freshly-polled GPS fix, not whatever a previous
   *  call cached at a coarser rounded grid. Off by default. */
  fresh?: boolean;
}): Promise<DiscoverResponse> {
  const params: Record<string, string> = {
    mode: opts.mode,
    radiusMiles: String(opts.radiusMiles ?? 10),
  };
  if (opts.userId) params.userId = opts.userId;
  if (opts.cuisine && opts.cuisine.trim()) params.cuisine = opts.cuisine.trim();
  if (opts.search && opts.search.trim()) params.search = opts.search.trim();
  if (opts.sortMode && opts.sortMode !== 'best') params.sortMode = opts.sortMode;
  if (opts.occasion) params.occasion = opts.occasion;
  if (opts.openNow) params.openNow = '1';
  if (opts.fresh) params.fresh = '1';
  // If we already know lat/lng (e.g. user picked a predefined location),
  // pass it through even for mode=location to avoid backend geocoding.
  if (opts.lat != null && opts.lng != null) {
    params.lat = String(opts.lat);
    params.lng = String(opts.lng);
  }
  if (opts.mode === 'location' && opts.query) params.query = opts.query;
  const { data } = await apiClient.get<DiscoverResponse>('/api/discover', { params });
  return data;
}

export async function postNegativeFeedback(
  userId: string,
  restaurantId: string,
  actionType: 'hide' | 'suggest_less',
): Promise<{ ok: boolean }> {
  const { data } = await apiClient.post<{ ok: boolean }>(
    `/api/users/${encodeURIComponent(userId)}/negative-feedback`,
    { restaurantId, actionType },
  );
  return data;
}
