import { NEUTRAL_RESTAURANT_PLACEHOLDER_URI } from '../constants/restaurantMedia';

export function isValidRemoteImageUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/** How the UI chose the image (for debugging). */
export type RestaurantImageSource =
  | 'USER_OR_LOG_PHOTO'
  | 'API_RESOLVED'
  | 'RELATIVE_PROXY'
  | 'NEUTRAL_PLACEHOLDER';

export interface RestaurantImageInput {
  /** User-uploaded or log primary photo (highest priority). */
  userOrLogPhotoUrl?: string | null;
  /** Server-resolved preview (Places / website / already absolute). */
  previewPhotoUrl?: string | null;
  imageUrl?: string | null;
}

export interface ResolvedRestaurantImage {
  url: string;
  source: RestaurantImageSource;
  usedPlaceholder: boolean;
}

/**
 * Client-side resolution for Feed / Discover / Saved / Profile cards.
 * Server is authoritative for Places vs website vs placeholder; this only merges user photos + API fields.
 *
 * Priority:
 * 1) user/log photo URL
 * 2) https previewPhotoUrl / imageUrl from API
 * 3) relative `/api/restaurants/...` proxy paths (server-resolved Places)
 * 4) neutral placeholder (no cuisine stock imagery)
 */
export function resolveRestaurantDisplayImage(input: RestaurantImageInput): ResolvedRestaurantImage {
  const log = (source: RestaurantImageSource, usedPlaceholder: boolean, url: string) => {
    if (__DEV__) {
      console.log('[RestaurantImage]', { source, usedPlaceholder, urlPreview: url.slice(0, 80) });
    }
    return { url, source, usedPlaceholder };
  };

  if (isValidRemoteImageUrl(input.userOrLogPhotoUrl)) {
    return log('USER_OR_LOG_PHOTO', false, input.userOrLogPhotoUrl.trim());
  }
  if (isValidRemoteImageUrl(input.previewPhotoUrl)) {
    return log('API_RESOLVED', false, input.previewPhotoUrl.trim());
  }
  if (isValidRemoteImageUrl(input.imageUrl)) {
    return log('API_RESOLVED', false, input.imageUrl.trim());
  }
  const rel = (input.previewPhotoUrl || input.imageUrl || '').trim();
  if (rel.startsWith('/')) {
    return log('RELATIVE_PROXY', false, rel);
  }
  return log('NEUTRAL_PLACEHOLDER', true, NEUTRAL_RESTAURANT_PLACEHOLDER_URI);
}

/**
 * @deprecated Prefer resolveRestaurantDisplayImage for observability.
 * Prefer previewPhotoUrl when available, otherwise imageUrl, else undefined (caller may use placeholder).
 */
export function getResolvedRestaurantImageUrl(opts: {
  previewPhotoUrl?: string | null;
  imageUrl?: string | null;
}): string | undefined {
  const r = resolveRestaurantDisplayImage({
    previewPhotoUrl: opts.previewPhotoUrl,
    imageUrl: opts.imageUrl,
  });
  if (r.usedPlaceholder) return undefined;
  return r.url;
}

/** Explicit neutral URI for heroes and Tonight before API hydrate. */
export function getNeutralRestaurantPlaceholderUri(): string {
  return NEUTRAL_RESTAURANT_PLACEHOLDER_URI;
}
