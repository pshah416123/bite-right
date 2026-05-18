import { apiClient } from '../api/client';
import {
  getProvidedRestaurantImageUrl,
  getRestaurantImageCacheKey,
  type RestaurantImageData,
} from './restaurantImage';

// ── Cache with TTL for failures ─────────────────────────────────────────────

interface CacheEntry {
  url: string | null;
  /** Timestamp when this entry was set. Used for TTL on null entries. */
  ts: number;
}

/** How long a null (failed) cache entry stays valid before we allow a retry. */
const FAILURE_TTL_MS = 60_000; // 1 minute

const photoCache = new Map<string, CacheEntry>();

function getCacheEntry(key: string): string | null | undefined {
  const entry = photoCache.get(key);
  if (!entry) return undefined;
  // Successful entries never expire
  if (entry.url) return entry.url;
  // Failed entries expire after TTL
  if (Date.now() - entry.ts < FAILURE_TTL_MS) return null;
  // Expired failure — remove and return undefined so caller retries
  photoCache.delete(key);
  return undefined;
}

function setCacheEntry(key: string, url: string | null): void {
  photoCache.set(key, { url, ts: Date.now() });
}

// ── Public API ──────────────────────────────────────────────────────────────

export function primeRestaurantPhotoCache(restaurant: RestaurantImageData): void {
  const cacheKey = getRestaurantImageCacheKey(restaurant);
  if (!cacheKey || photoCache.has(cacheKey)) return;
  const provided = getProvidedRestaurantImageUrl(restaurant);
  if (provided) {
    setCacheEntry(cacheKey, provided);
  }
}

export function getCachedRestaurantPhoto(restaurant: RestaurantImageData): string | null | undefined {
  const cacheKey = getRestaurantImageCacheKey(restaurant);
  if (!cacheKey) return undefined;
  return getCacheEntry(cacheKey);
}

export async function getRestaurantFoodPhoto(
  restaurant: string | RestaurantImageData,
): Promise<string | null> {
  const restaurantData: RestaurantImageData =
    typeof restaurant === 'string' ? { id: restaurant } : restaurant;
  const cacheKey = getRestaurantImageCacheKey(restaurantData);
  if (!cacheKey) return null;

  const cached = getCacheEntry(cacheKey);
  if (cached !== undefined) return cached;

  const provided = getProvidedRestaurantImageUrl(restaurantData);
  if (provided) {
    setCacheEntry(cacheKey, provided);
    return provided;
  }

  const restaurantId = restaurantData.id || restaurantData.restaurantId || restaurantData.place_id;
  if (!restaurantId) {
    setCacheEntry(cacheKey, null);
    return null;
  }

  try {
    const { data } = await apiClient.get<{
      displayImageUrl?: string | null;
      imageUrl?: string | null;
      previewPhotoUrl?: string | null;
    }>(
      `/api/restaurants/${encodeURIComponent(restaurantId)}`,
    );
    const url = getProvidedRestaurantImageUrl({
      displayImageUrl: data?.displayImageUrl ?? null,
      imageUrl: data?.imageUrl ?? null,
      previewPhotoUrl: data?.previewPhotoUrl ?? null,
    });
    setCacheEntry(cacheKey, url ?? null);
    if (__DEV__) {
      console.log('[BiteRight][PhotoCache]', url ? 'resolved' : 'no-image', {
        key: cacheKey,
        restaurantId,
      });
    }
    return url ?? null;
  } catch {
    // Do NOT permanently cache failures — TTL will allow retry
    setCacheEntry(cacheKey, null);
    if (__DEV__) {
      console.log('[BiteRight][PhotoCache] detail-lookup-failed', {
        key: cacheKey,
        restaurantId,
      });
    }
    return null;
  }
}

/**
 * Set a resolved image URL directly into the cache for a given restaurant.
 * Used by FeedContext fallback enrichment after name-based search succeeds.
 */
export function setRestaurantPhotoCache(restaurant: RestaurantImageData, url: string): void {
  const cacheKey = getRestaurantImageCacheKey(restaurant);
  if (!cacheKey) return;
  setCacheEntry(cacheKey, url);
}

/**
 * Check if a cache entry exists and is a confirmed failure (null within TTL).
 * Returns true if we already tried and failed recently — caller should skip.
 * Returns false if no entry or entry expired — caller should attempt resolution.
 */
export function isRecentlyFailed(restaurant: RestaurantImageData): boolean {
  const cacheKey = getRestaurantImageCacheKey(restaurant);
  if (!cacheKey) return false;
  const entry = photoCache.get(cacheKey);
  if (!entry) return false;
  if (entry.url) return false; // has image, not a failure
  return Date.now() - entry.ts < FAILURE_TTL_MS;
}

export function prefetchRestaurantPhotos(restaurants: RestaurantImageData[]): void {
  restaurants.forEach((restaurant) => {
    const cacheKey = getRestaurantImageCacheKey(restaurant);
    if (!cacheKey || photoCache.has(cacheKey)) return;
    getRestaurantFoodPhoto(restaurant).catch(() => {});
  });
}

export function invalidateRestaurantPhoto(restaurant: string | RestaurantImageData): void {
  const cacheKey =
    typeof restaurant === 'string' ? restaurant : getRestaurantImageCacheKey(restaurant);
  if (!cacheKey) return;
  photoCache.delete(cacheKey);
}
