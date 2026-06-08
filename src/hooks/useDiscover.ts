import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { DiscoverItem } from '../components/RestaurantCard';
import { getDiscover } from '../api/discover';
import type { DiscoverModeApi } from '../api/discover';
import type { DiscoverSections } from '../api/discover';
import { getDiscoverRecommendations } from '../recommendation/discoverMock';
import { apiClient } from '../api/client';
import { useTestMode } from '../context/TestModeContext';
import { TEST_DISCOVER_ITEMS } from '../data/testMockData';

function ensureAbsoluteImageUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('http')) return url;
  const base = apiClient.defaults.baseURL || '';
  return base ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url;
}

export interface DiscoverSectionItems {
  topPicksForYou: DiscoverItem[];
  becauseYouLiked: DiscoverItem[];
  trendingWithSimilarUsers: DiscoverItem[];
  allNearby: DiscoverItem[];
}

const EMPTY_SECTIONS: DiscoverSectionItems = {
  topPicksForYou: [],
  becauseYouLiked: [],
  trendingWithSimilarUsers: [],
  allNearby: [],
};

interface UseDiscoverResult {
  sections: DiscoverSectionItems;
  isColdStart: boolean;
  discoverMode: DiscoverModeApi;
  /** User's GPS coordinates (falls back to Chicago if denied). */
  userCoords: { lat: number; lng: number } | null;
  /** Re-poll GPS. Call when the user explicitly asks to use their
   *  current location (e.g. taps "Near you" after traveling). */
  refreshLocation: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

function sectionsToItems(sections: DiscoverSections | undefined): DiscoverSectionItems {
  if (!sections) return EMPTY_SECTIONS;
  return {
    topPicksForYou: (sections.topPicksForYou || []).map(recToItem),
    becauseYouLiked: (sections.becauseYouLiked || []).map(recToItem),
    trendingWithSimilarUsers: (sections.trendingWithSimilarUsers || []).map(recToItem),
    allNearby: (sections.allNearby || []).map(recToItem),
  };
}

function recToItem(rec: {
  restaurant: {
    id: string;
    name: string;
    cuisine?: string;
    cuisines?: string[];
    neighborhood?: string;
    priceLevel?: number;
    lat?: number | null;
    lng?: number | null;
    placeId?: string | null;
    googlePlaceId?: string | null;
    displayImageUrl?: string | null;
    displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
    displayImageLastResolvedAt?: string | null;
    imageUrl?: string;
    previewPhotoUrl?: string;
  };
  percentMatch: number;
  explanations: string[];
  heroLabel?: string | null;
  cardTags?: string[];
  socialProofBadge?: string | null;
}): DiscoverItem {
  return {
    restaurant: {
      id: rec.restaurant.id,
      name: rec.restaurant.name,
      cuisine: rec.restaurant.cuisine ?? '',
      cuisines: rec.restaurant.cuisines,
      neighborhood: rec.restaurant.neighborhood,
      priceLevel: rec.restaurant.priceLevel,
      lat: rec.restaurant.lat ?? null,
      lng: rec.restaurant.lng ?? null,
      placeId: rec.restaurant.placeId,
      googlePlaceId: rec.restaurant.googlePlaceId,
      displayImageUrl: ensureAbsoluteImageUrl(
        rec.restaurant.displayImageUrl ?? rec.restaurant.imageUrl ?? rec.restaurant.previewPhotoUrl,
      ),
      displayImageSourceType: rec.restaurant.displayImageSourceType ?? null,
      displayImageLastResolvedAt: rec.restaurant.displayImageLastResolvedAt ?? null,
      previewPhotoUrl: ensureAbsoluteImageUrl(rec.restaurant.previewPhotoUrl),
      imageUrl: ensureAbsoluteImageUrl(rec.restaurant.imageUrl ?? rec.restaurant.previewPhotoUrl),
    },
    matchScore: rec.percentMatch / 100,
    reasonTags: rec.explanations,
    heroLabel: rec.heroLabel ?? null,
    cardTags: rec.cardTags ?? [],
    socialProofBadge: rec.socialProofBadge ?? null,
  };
}

/**
 * Resolves GPS location and fetches nearby discover results.
 * No mode switching — always uses user's GPS coordinates.
 */
export function useDiscover(
  userId = 'you',
  opts: { cuisine?: string | null } = {},
): UseDiscoverResult {
  const { isTestMode } = useTestMode();
  const cuisine = opts.cuisine ?? null;
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [sections, setSections] = useState<DiscoverSectionItems>(EMPTY_SECTIONS);
  const [isColdStartState, setIsColdStartState] = useState(true);
  const [discoverMode, setDiscoverMode] = useState<DiscoverModeApi>('trending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped to Date.now() inside refreshLocation. The next discover fetch
  // reads it, compares against lastFreshFetchRef, and sends fresh=true
  // exactly once — bypassing the server cache for explicit user-triggered
  // re-locates without affecting background re-renders.
  const freshTokenRef = useRef(0);
  const lastFreshFetchRef = useRef(0);

  // Resolve GPS — exposed as a function so callers can re-poll (e.g. when
  // the user taps "Near you" after traveling). Without this, userCoords
  // was captured once on mount and never refreshed; a user who flew from
  // Chicago to Detroit would keep seeing Chicago results even after
  // tapping the GPS option.
  //
  // Uses requestForegroundPermissionsAsync (not getForegroundPermissionsAsync)
  // because on iOS the "active request" path wakes the location service
  // and forces a fresh fix — the pure status-check path lets iOS hand
  // back a stale cached position.
  //
  // Accuracy is Highest (sub-10m, GPS+wifi+cell) on the explicit user-
  // triggered path. iOS's "cached fix" tier only goes up to High accuracy
  // (~10m); requesting Highest forces a brand-new GNSS lock. The 1–2
  // seconds extra is the cost of an action the user just tapped.
  //
  // freshTokenRef bumps on every explicit refresh so the discover fetch
  // can detect "this re-fetch was triggered by a Near-you tap" and ask
  // the server to bypass its 5-min cache for that one call. Cache writes
  // still happen, so subsequent renders at the same spot stay fast.
  const refreshLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        freshTokenRef.current = Date.now();
        setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } else {
        setUserCoords({ lat: 41.88, lng: -87.63 });
      }
    } catch {
      setUserCoords((prev) => prev ?? { lat: 41.88, lng: -87.63 });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refreshLocation();
    })();
    return () => { cancelled = true; };
  }, [refreshLocation]);

  // Fetch nearby results when coords resolve
  useEffect(() => {
    if (!userCoords) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Consume the fresh-token if it's newer than the last fetch — bypasses
    // server cache once after refreshLocation was explicitly called.
    const shouldBypassCache = freshTokenRef.current > lastFreshFetchRef.current;
    if (shouldBypassCache) lastFreshFetchRef.current = freshTokenRef.current;

    getDiscover({
      mode: 'nearby',
      userId: 'default',
      lat: userCoords.lat,
      lng: userCoords.lng,
      radiusMiles: 10,
      cuisine,
      fresh: shouldBypassCache,
    })
      .then((res) => {
        if (cancelled) return;
        setSections(sectionsToItems(res.sections));
        setIsColdStartState(res.isColdStart ?? true);
        setDiscoverMode(res.discoverMode ?? 'trending');
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.response?.data?.error || e.message || 'Discover failed');
        const mock = getDiscoverRecommendations(userId);
        const list = mock.recommendations.map(recToItem);
        setSections({
          topPicksForYou: list.slice(0, 4),
          becauseYouLiked: [],
          trendingWithSimilarUsers: list.slice(4, 8),
          allNearby: list,
        });
        setIsColdStartState(mock.isColdStart);
        setDiscoverMode('trending');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [userCoords, userId, cuisine]);

  // In test mode, return mock data without GPS or API calls
  if (isTestMode) {
    return {
      sections: {
        topPicksForYou: TEST_DISCOVER_ITEMS,
        becauseYouLiked: TEST_DISCOVER_ITEMS.slice(0, 2),
        trendingWithSimilarUsers: TEST_DISCOVER_ITEMS.slice(2, 4),
        allNearby: TEST_DISCOVER_ITEMS,
      },
      isColdStart: false,
      discoverMode: 'nearby' as DiscoverModeApi,
      userCoords: { lat: 41.88, lng: -87.63 },
      refreshLocation: async () => { /* no-op in test mode */ },
      loading: false,
      error: null,
    };
  }

  return {
    sections,
    isColdStart: isColdStartState,
    discoverMode,
    userCoords,
    refreshLocation,
    loading,
    error,
  };
}
