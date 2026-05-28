/**
 * useRestaurantImage — centralized resolver hook used by Feed, Discover,
 * Saved, Profile, Compare, Lists and any future surface that renders a
 * restaurant photo.
 *
 * Why centralize:
 *   - One source of truth for resolution, caching, and confidence gating.
 *   - Adding a new image source / rule / debug log happens once.
 *
 * Behavior:
 *   - If the restaurant already has a usable image (displayImageUrl /
 *     imageUrl / previewPhotoUrl), returns it synchronously — source: 'provided'.
 *   - Otherwise fires an async lookup to /api/restaurants/<id> and updates
 *     state when it resolves — source: 'fetched'. While in-flight: 'placeholder'.
 *   - The fetch goes through `getRestaurantFoodPhoto` which enforces a
 *     confidence gate (placeId must match, source must be restaurant-verified).
 *     A low-confidence result returns null → the caller renders a placeholder.
 *
 * Caching is shared across all callers via the module-level photoCache in
 * restaurantPhoto.ts, so the same restaurant resolves once per session.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  getCachedRestaurantPhoto,
  getRestaurantFoodPhoto,
  primeRestaurantPhotoCache,
} from '../utils/restaurantPhoto';
import {
  getProvidedRestaurantImageUrl,
  getRestaurantImageCacheKey,
  type RestaurantImageData,
} from '../utils/restaurantImage';

export type RestaurantImageSource = 'provided' | 'fetched' | 'placeholder';

export interface UseRestaurantImageResult {
  /** URL to render, or null when no confident image is available. */
  uri: string | null;
  /** True while an async resolution is in flight. UI should render placeholder. */
  loading: boolean;
  /** Where the URI (if any) came from. */
  source: RestaurantImageSource;
}

/**
 * Resolve a restaurant image with confidence gating and shared caching.
 *
 * The hook is safe to call even when the restaurant has no id yet — it will
 * gracefully fall back to placeholder.
 */
export function useRestaurantImage(restaurant: RestaurantImageData): UseRestaurantImageResult {
  // Snapshot the inputs that actually influence resolution. Other fields
  // (name, cuisine) don't matter for the URL — they're consumed by the
  // RestaurantImage placeholder component.
  const snapshot = useMemo<RestaurantImageData>(() => ({
    id: restaurant.id ?? null,
    restaurantId: restaurant.restaurantId ?? null,
    placeId: restaurant.placeId ?? null,
    place_id: restaurant.place_id ?? null,
    googlePlaceId: restaurant.googlePlaceId ?? null,
    name: restaurant.name ?? null,
    cuisine: restaurant.cuisine ?? null,
    displayImageUrl: restaurant.displayImageUrl ?? null,
    displayImageSourceType: restaurant.displayImageSourceType ?? null,
    displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt ?? null,
    imageUrl: restaurant.imageUrl ?? null,
    previewPhotoUrl: restaurant.previewPhotoUrl ?? null,
    cover_image_url: restaurant.cover_image_url ?? null,
    food_image_urls: restaurant.food_image_urls ?? null,
  }), [
    restaurant.id, restaurant.restaurantId, restaurant.placeId, restaurant.place_id,
    restaurant.googlePlaceId, restaurant.name, restaurant.cuisine,
    restaurant.displayImageUrl, restaurant.displayImageSourceType,
    restaurant.displayImageLastResolvedAt, restaurant.imageUrl,
    restaurant.previewPhotoUrl, restaurant.cover_image_url, restaurant.food_image_urls,
  ]);

  const cacheKey = getRestaurantImageCacheKey(snapshot);

  // What we know synchronously: provided URL, or cached URL from a prior resolution.
  const provided = useMemo(() => getProvidedRestaurantImageUrl(snapshot), [snapshot]);
  const cached = useMemo(() => getCachedRestaurantPhoto(snapshot), [snapshot, cacheKey]);

  // Initial state: provided wins, then cached, then null (placeholder).
  const initial = provided ?? cached ?? null;
  const initialSource: RestaurantImageSource = provided
    ? 'provided'
    : (cached ? 'fetched' : 'placeholder');

  const [uri, setUri] = useState<string | null>(initial);
  const [source, setSource] = useState<RestaurantImageSource>(initialSource);
  const [loading, setLoading] = useState<boolean>(!initial && !!cacheKey);

  useEffect(() => {
    // Reset state when the restaurant identity changes.
    setUri(initial);
    setSource(initialSource);
    setLoading(!initial && !!cacheKey);
    primeRestaurantPhotoCache(snapshot);
  }, [cacheKey, initial, initialSource, snapshot]);

  useEffect(() => {
    let cancelled = false;
    if (initial || !cacheKey) return;

    if (__DEV__) {
      console.log('[BiteRight][useRestaurantImage] retry triggered', {
        cacheKey, hadProvided: !!provided, hadCached: cached !== undefined,
      });
    }

    getRestaurantFoodPhoto(snapshot)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved) {
          setUri(resolved);
          setSource('fetched');
          if (__DEV__) console.log('[BiteRight][useRestaurantImage] fetched', { cacheKey });
        } else {
          // Confidence gate rejected the response, or backend has no photo.
          setUri(null);
          setSource('placeholder');
          if (__DEV__) console.log('[BiteRight][useRestaurantImage] placeholder (low confidence or no image)', { cacheKey });
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, initial, snapshot, provided, cached]);

  return { uri, loading, source };
}
