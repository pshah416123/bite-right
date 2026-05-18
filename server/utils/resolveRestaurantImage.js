const DEFAULT_MAX_WIDTH = 800;

const placeDetailsCache = new Map();
const resolutionCache = new Map();

const CURATED_RESTAURANT_IMAGE_OVERRIDES = {};

function normalizeRestaurantName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  return null;
}

function buildGooglePlacePhotoUrl(photoReference, apiKey, maxWidth = DEFAULT_MAX_WIDTH) {
  if (!photoReference || !apiKey) return null;
  const params = new URLSearchParams({
    maxwidth: String(maxWidth),
    photo_reference: String(photoReference),
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/place/photo?${params.toString()}`;
}

/**
 * Rank all photo candidates by food-likelihood score.
 * Returns sorted array of { reference, index, width, height }.
 */
function rankPlacePhotoCandidates(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return [];

  const candidates = photos
    .slice(0, 10)
    .map((photo, index) => ({
      index,
      reference: photo?.photo_reference || null,
      width: Number(photo?.width) || 0,
      height: Number(photo?.height) || 0,
    }))
    .filter((candidate) => candidate.reference);

  // Scoring: lower is better.
  // Prefer food-like photos (square-ish, not the first exterior shot).
  candidates.sort((left, right) => {
    const leftRatio = left.width > 0 && left.height > 0 ? left.width / left.height : 1;
    const rightRatio = right.width > 0 && right.height > 0 ? right.width / right.height : 1;

    const leftAspectScore = Math.abs(leftRatio - 1.0);
    const rightAspectScore = Math.abs(rightRatio - 1.0);

    const leftIndexPenalty = left.index === 0 && candidates.length > 1 ? 0.6 : 0;
    const rightIndexPenalty = right.index === 0 && candidates.length > 1 ? 0.6 : 0;

    const leftWidePenalty = leftRatio > 1.5 ? 0.4 : 0;
    const rightWidePenalty = rightRatio > 1.5 ? 0.4 : 0;

    const leftTotal = leftAspectScore + leftIndexPenalty + leftWidePenalty;
    const rightTotal = rightAspectScore + rightIndexPenalty + rightWidePenalty;

    if (leftTotal !== rightTotal) return leftTotal - rightTotal;
    if (left.width !== right.width) return right.width - left.width;
    return left.index - right.index;
  });

  return candidates;
}

function selectBestPlacePhotoReference(photos, skipRefs) {
  const ranked = rankPlacePhotoCandidates(photos);
  if (ranked.length === 0) return null;

  if (skipRefs && skipRefs.length > 0) {
    const skipSet = new Set(skipRefs);
    const match = ranked.find((c) => !skipSet.has(c.reference));
    return match?.reference || ranked[0].reference;
  }

  return ranked[0]?.reference || null;
}

async function getGooglePlaceDetails(axios, apiKey, googlePlaceId) {
  if (!axios || !apiKey || !googlePlaceId) return null;
  if (placeDetailsCache.has(googlePlaceId)) {
    return placeDetailsCache.get(googlePlaceId);
  }

  try {
    const { data } = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: googlePlaceId,
        key: apiKey,
        fields: 'name,photos',
      },
      timeout: 12000,
    });
    const result = data?.status === 'OK' ? data.result ?? null : null;
    placeDetailsCache.set(googlePlaceId, result);
    return result;
  } catch (error) {
    console.warn('[BiteRight][RestaurantImage] Places Details failed:', error.message);
    placeDetailsCache.set(googlePlaceId, null);
    return null;
  }
}

function getCuratedOverride(restaurant) {
  const restaurantId = String(restaurant?.restaurantId || restaurant?.id || '').trim();
  if (restaurantId && CURATED_RESTAURANT_IMAGE_OVERRIDES[restaurantId]) {
    return CURATED_RESTAURANT_IMAGE_OVERRIDES[restaurantId];
  }
  const normalizedName = normalizeRestaurantName(restaurant?.name);
  if (normalizedName && CURATED_RESTAURANT_IMAGE_OVERRIDES[normalizedName]) {
    return CURATED_RESTAURANT_IMAGE_OVERRIDES[normalizedName];
  }
  return null;
}

async function resolveRestaurantImage(restaurant, options = {}) {
  const {
    axios,
    apiKey,
    maxWidth = DEFAULT_MAX_WIDTH,
    cacheKey,
    userUploadedPhotoUrl,
    buildGooglePhotoUrl,
  } = options;

  const normalizedUserPhoto = normalizeImageUrl(userUploadedPhotoUrl);
  const normalizedCachedDisplayImageUrl = normalizeImageUrl(restaurant?.displayImageUrl);
  const normalizedName = normalizeRestaurantName(restaurant?.name);
  const resolvedCacheKey =
    cacheKey ||
    restaurant?.restaurantId ||
    restaurant?.id ||
    restaurant?.googlePlaceId ||
    normalizedName;

  if (!normalizedUserPhoto && resolvedCacheKey && resolutionCache.has(resolvedCacheKey)) {
    return resolutionCache.get(resolvedCacheKey);
  }

  const override = getCuratedOverride(restaurant);

  let result = {
    displayImageUrl: null,
    displayImageSourceType: 'placeholder',
    displayImageLastResolvedAt: new Date().toISOString(),
    googlePlaceId: restaurant?.googlePlaceId || null,
    placeholderUsed: true,
    photoReference: null,
    blockedGoogleFallback: !!override?.blockGoogleFallback,
  };

  if (override?.displayImageUrl) {
    const normalizedOverrideUrl = normalizeImageUrl(override.displayImageUrl);
    if (normalizedOverrideUrl) {
      result = {
        ...result,
        displayImageUrl: normalizedOverrideUrl,
        displayImageSourceType: 'override',
        placeholderUsed: false,
      };
    }
  }

  if (result.placeholderUsed && normalizedUserPhoto) {
    result = {
      ...result,
      displayImageUrl: normalizedUserPhoto,
      displayImageSourceType: 'user',
      placeholderUsed: false,
    };
  }

  if (result.placeholderUsed && normalizedCachedDisplayImageUrl) {
    result = {
      ...result,
      displayImageUrl: normalizedCachedDisplayImageUrl,
      displayImageSourceType:
        restaurant?.displayImageSourceType && restaurant.displayImageSourceType !== 'placeholder'
          ? restaurant.displayImageSourceType
          : 'google',
      displayImageLastResolvedAt:
        restaurant?.displayImageLastResolvedAt || result.displayImageLastResolvedAt,
      placeholderUsed: false,
    };
  }

  if (
    result.placeholderUsed &&
    restaurant?.googlePlaceId &&
    !override?.blockGoogleFallback
  ) {
    const details = await getGooglePlaceDetails(axios, apiKey, restaurant.googlePlaceId);
    const photoReference = selectBestPlacePhotoReference(details?.photos);
    const googlePhotoUrl = photoReference
      ? buildGooglePhotoUrl
        ? buildGooglePhotoUrl(photoReference, restaurant)
        : buildGooglePlacePhotoUrl(photoReference, apiKey, maxWidth)
      : null;

    if (googlePhotoUrl) {
      result = {
        ...result,
        displayImageUrl: googlePhotoUrl,
        displayImageSourceType: 'google',
        placeholderUsed: false,
        photoReference,
      };
    }
  }

  if (!normalizedUserPhoto && resolvedCacheKey) {
    resolutionCache.set(resolvedCacheKey, result);
  }

  return result;
}

function clearRestaurantImageResolutionCache(cacheKey) {
  if (!cacheKey) {
    resolutionCache.clear();
    placeDetailsCache.clear();
    return;
  }
  resolutionCache.delete(cacheKey);
}

module.exports = {
  CURATED_RESTAURANT_IMAGE_OVERRIDES,
  buildGooglePlacePhotoUrl,
  clearRestaurantImageResolutionCache,
  normalizeRestaurantName,
  rankPlacePhotoCandidates,
  resolveRestaurantImage,
  selectBestPlacePhotoReference,
};
