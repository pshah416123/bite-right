import { apiClient } from '../api/client';
import { NEUTRAL_RESTAURANT_PLACEHOLDER_URI } from '../constants/restaurantMedia';
import type {
  RestaurantDisplayImageSourceType,
  RestaurantIdentity,
} from '../types/restaurant';

export type RestaurantImageFallbackType = 'blur' | 'color' | 'icon';

export interface RestaurantImageData
  extends Omit<Partial<RestaurantIdentity>, 'id' | 'name'> {
  id?: string | null;
  restaurantId?: string | null;
  placeId?: string | null;
  place_id?: string | null;
  name?: string | null;
  cuisine?: string | null;
  googlePlaceId?: string | null;
  displayImageUrl?: string | null;
  displayImageSourceType?: RestaurantDisplayImageSourceType | null;
  displayImageLastResolvedAt?: string | null;
  imageUrl?: string | null;
  previewPhotoUrl?: string | null;
  cover_image_url?: string | null;
  food_image_urls?: string[] | null;
}

export function isNeutralPlaceholderUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.includes('placehold.co/');
}

export function normalizeRestaurantImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || isNeutralPlaceholderUrl(trimmed)) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  // Local file URIs from the image picker (e.g. file:///var/mobile/...)
  if (trimmed.startsWith('file://')) return trimmed;
  if (trimmed.startsWith('/')) {
    const baseUrl = String(apiClient.defaults.baseURL || '').replace(/\/$/, '');
    return baseUrl ? `${baseUrl}${trimmed}` : trimmed;
  }
  return null;
}

export function getRestaurantImageCacheKey(restaurant: RestaurantImageData): string | null {
  return (
    restaurant.id ||
    restaurant.restaurantId ||
    restaurant.placeId ||
    restaurant.place_id ||
    restaurant.googlePlaceId ||
    restaurant.name ||
    null
  );
}

export function getProvidedRestaurantImageUrl(restaurant: RestaurantImageData): string | null {
  const candidates = [
    restaurant.displayImageUrl,
    restaurant.imageUrl,
    restaurant.previewPhotoUrl,
    restaurant.cover_image_url,
    restaurant.food_image_urls?.[0] ?? null,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeRestaurantImageUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function getCuisineFallbackIcon(cuisine: string | null | undefined): string {
  const value = String(cuisine || '').toLowerCase();
  if (value.includes('pizza')) return 'pizza-outline';
  if (value.includes('burger') || value.includes('american')) return 'fast-food-outline';
  if (value.includes('sushi') || value.includes('ramen') || value.includes('japanese')) return 'fish-outline';
  if (value.includes('bbq') || value.includes('steak')) return 'flame-outline';
  if (value.includes('coffee') || value.includes('bakery') || value.includes('brunch')) return 'cafe-outline';
  if (value.includes('seafood')) return 'fish-outline';
  return 'restaurant-outline';
}

export function getNeutralRestaurantPlaceholderUri(): string {
  return NEUTRAL_RESTAURANT_PLACEHOLDER_URI;
}

export function getProvidedRestaurantImageSourceType(
  restaurant: RestaurantImageData,
): RestaurantDisplayImageSourceType | null {
  if (normalizeRestaurantImageUrl(restaurant.displayImageUrl)) {
    return restaurant.displayImageSourceType ?? 'google';
  }
  if (normalizeRestaurantImageUrl(restaurant.imageUrl ?? null)) return 'user';
  if (normalizeRestaurantImageUrl(restaurant.previewPhotoUrl ?? null)) return 'user';
  return null;
}
