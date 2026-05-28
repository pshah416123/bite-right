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

interface FetchedImage { url: string | null; reason: 'confident' | 'placeholder-only' | 'placeid-mismatch' | 'not-verified' | 'lookup-failed' | 'not-found' }

/**
 * Single API lookup with confidence gate. Used internally by
 * getRestaurantFoodPhoto for both the primary id lookup and the googlePlaceId
 * fallback. Returns the URL only when the response is confidently for the
 * requested restaurant (placeId matches and source is verified).
 */
async function fetchImageFromApi(
  idForUrl: string,
  expectedPlaceId: string | null,
): Promise<FetchedImage> {
  try {
    const { data } = await apiClient.get<{
      displayImageUrl?: string | null;
      imageUrl?: string | null;
      previewPhotoUrl?: string | null;
      displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
      placeId?: string | null;
      googlePlaceId?: string | null;
    }>(`/api/restaurants/${encodeURIComponent(idForUrl)}`);

    const responsePlaceId = data?.placeId || data?.googlePlaceId || null;
    const sourceType = data?.displayImageSourceType ?? null;
    const sourceVerified = sourceType === 'user' || sourceType === 'google' || sourceType === 'override';
    const placeIdMatches = !expectedPlaceId || !responsePlaceId || expectedPlaceId === responsePlaceId;

    if (!placeIdMatches) return { url: null, reason: 'placeid-mismatch' };
    if (!sourceVerified)  return { url: null, reason: 'not-verified' };

    const url = getProvidedRestaurantImageUrl({
      displayImageUrl: data?.displayImageUrl ?? null,
      imageUrl: data?.imageUrl ?? null,
      previewPhotoUrl: data?.previewPhotoUrl ?? null,
    });
    return { url: url ?? null, reason: url ? 'confident' : 'placeholder-only' };
  } catch {
    return { url: null, reason: 'lookup-failed' };
  }
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

  const internalId = restaurantData.id || restaurantData.restaurantId || null;
  const googlePlaceId = restaurantData.googlePlaceId || restaurantData.place_id || null;

  // Build attempt order:
  //   1) internal id  (stable when the server remembers this restaurant)
  //   2) googlePlaceId (stable across server restarts — ChIJ-prefixed IDs are
  //      accepted by the detail endpoint as a fallback)
  // Each attempt enforces the confidence gate independently.
  const attempts: { id: string; expectedPlaceId: string | null; label: string }[] = [];
  if (internalId) attempts.push({ id: internalId, expectedPlaceId: googlePlaceId, label: 'internalId' });
  if (googlePlaceId && googlePlaceId !== internalId) {
    attempts.push({ id: googlePlaceId, expectedPlaceId: googlePlaceId, label: 'googlePlaceId-fallback' });
  }

  if (attempts.length === 0) {
    setCacheEntry(cacheKey, null);
    return null;
  }

  for (const attempt of attempts) {
    const result = await fetchImageFromApi(attempt.id, attempt.expectedPlaceId);
    if (__DEV__) {
      console.log('[BiteRight][PhotoCache]', result.reason, {
        key: cacheKey, attempt: attempt.label, attemptId: attempt.id,
      });
    }
    if (result.url) {
      setCacheEntry(cacheKey, result.url);
      return result.url;
    }
    // Don't bail on first failure if there's a googlePlaceId fallback to try.
    if (result.reason === 'lookup-failed' || result.reason === 'placeholder-only') continue;
    // Hard rejection (placeid-mismatch / not-verified) — try next attempt
    // but record we tried.
  }

  setCacheEntry(cacheKey, null);
  return null;
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
