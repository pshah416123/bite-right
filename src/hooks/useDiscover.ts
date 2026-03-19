import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import type { DiscoverItem } from '../components/RestaurantCard';
import { getDiscover } from '../api/discover';
import type { DiscoverMode, DiscoverModeApi } from '../api/discover';
import type { DiscoverSections } from '../api/discover';
import { getDiscoverRecommendations } from '../recommendation/discoverMock';
import { apiClient } from '../api/client';

function ensureAbsoluteImageUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('http')) return url;
  const base = apiClient.defaults.baseURL || '';
  return base ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url;
}

const DISCOVER_STORAGE_KEY = 'biteright_discover_filter';

export interface DiscoverFilterState {
  mode: DiscoverMode;
  locationQuery: string;
}

export interface DiscoverSectionItems {
  topPicksForYou: DiscoverItem[];
  becauseYouLiked: DiscoverItem[];
  trendingWithSimilarUsers: DiscoverItem[];
  allNearby: DiscoverItem[];
}

interface UseDiscoverResult {
  items: DiscoverItem[];
  sections: DiscoverSectionItems;
  isColdStart: boolean;
  discoverMode: DiscoverModeApi;
  filterMode: DiscoverMode;
  setFilterMode: (mode: DiscoverMode) => void;
  locationQuery: string;
  setLocationQuery: (q: string) => void;
  applyLocationQuery: () => void;
  /** The currently applied/selected location (empty until user selects/commits). */
  selectedLocation: string;
  locationPermissionDenied: boolean;
  loading: boolean;
  error: string | null;
}

function sectionsToItems(sections: DiscoverSections | undefined): DiscoverSectionItems {
  if (!sections) {
    return { topPicksForYou: [], becauseYouLiked: [], trendingWithSimilarUsers: [], allNearby: [] };
  }
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
    placeId?: string | null;
    imageUrl?: string;
    previewPhotoUrl?: string;
  };
  percentMatch: number;
  explanations: string[];
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
      placeId: rec.restaurant.placeId,
      previewPhotoUrl: ensureAbsoluteImageUrl(rec.restaurant.previewPhotoUrl),
      imageUrl: ensureAbsoluteImageUrl(rec.restaurant.imageUrl ?? rec.restaurant.previewPhotoUrl),
    },
    matchScore: rec.percentMatch / 100,
    reasonTags: rec.explanations,
    socialProofBadge: rec.socialProofBadge ?? null,
  };
}

export function useDiscover(
  userId = 'you',
  opts: { cuisine?: string | null } = {},
): UseDiscoverResult {
  const cuisine = opts.cuisine ?? null;
  const [filterMode, setFilterModeState] = useState<DiscoverMode>('nearby');
  const [locationQuery, setLocationQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [sections, setSections] = useState<DiscoverSectionItems>({
    topPicksForYou: [],
    becauseYouLiked: [],
    trendingWithSimilarUsers: [],
    allNearby: [],
  });
  const [isColdStartState, setIsColdStartState] = useState(true);
  const [discoverMode, setDiscoverMode] = useState<DiscoverModeApi>('trending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFilterMode = useCallback((mode: DiscoverMode) => {
    setFilterModeState(mode);
    if (mode === 'location') setLocationPermissionDenied(false);
  }, []);

  const applyLocationQuery = useCallback(() => {
    setAppliedQuery(locationQuery.trim());
  }, [locationQuery]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DISCOVER_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as DiscoverFilterState;
          setFilterModeState(parsed.mode ?? 'nearby');
          setLocationQuery(parsed.locationQuery ?? '');
          setAppliedQuery(parsed.locationQuery ?? '');
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      DISCOVER_STORAGE_KEY,
      JSON.stringify({ mode: filterMode, locationQuery: filterMode === 'location' ? (appliedQuery || locationQuery) : '' }),
    ).catch(() => {});
  }, [filterMode, locationQuery, appliedQuery]);

  useEffect(() => {
    if (filterMode === 'nearby') {
      let cancelled = false;
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (cancelled) return;
          if (status === 'granted') {
            setLocationPermissionDenied(false);
            const loc = await Location.getCurrentPositionAsync({});
            if (cancelled) return;
            setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          } else {
            // Graceful fallback: remember that permission was denied, but still use a default city center
            // so Nearby mode continues to show recommendations.
            setLocationPermissionDenied(true);
            setUserCoords({ lat: 41.88, lng: -87.63 }); // Chicago downtown default
          }
        } catch {
          if (!cancelled) {
            setLocationPermissionDenied(true);
            setUserCoords({ lat: 41.88, lng: -87.63 });
          }
        }
      })();
      return () => { cancelled = true; };
    } else {
      setLocationPermissionDenied(false);
    }
  }, [filterMode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (filterMode !== 'location') return;
    const q = locationQuery.trim();
    debounceRef.current = setTimeout(() => setAppliedQuery((prev) => (prev !== q ? q : prev)), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filterMode, locationQuery]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (filterMode === 'nearby' && userCoords) {
      if (__DEV__) {
        console.log('[useDiscover] fetch nearby', {
          lat: userCoords.lat,
          lng: userCoords.lng,
          cuisine: cuisine || null,
        });
      }
      getDiscover({
        mode: 'nearby',
        userId: 'default',
        lat: userCoords.lat,
        lng: userCoords.lng,
        radiusMiles: 10,
        cuisine,
      })
        .then((res) => {
          if (cancelled) return;
          const list = res.recommendations?.map(recToItem) ?? [];
          setItems(list);
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
          setItems(list);
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
      return;
    }

    if (filterMode === 'location' && appliedQuery) {
      getDiscover({
        mode: 'location',
        userId: 'default',
        query: appliedQuery,
        radiusMiles: 10,
        cuisine,
      })
        .then((res) => {
          if (cancelled) return;
          const list = res.recommendations?.map(recToItem) ?? [];
          setItems(list);
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
          setItems(list);
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
      return;
    }

    setLoading(false);
    if (filterMode === 'location' && !appliedQuery) {
      setItems([]);
      setSections({ topPicksForYou: [], becauseYouLiked: [], trendingWithSimilarUsers: [], allNearby: [] });
      return;
    }
    const mock = getDiscoverRecommendations(userId);
    const list = mock.recommendations.map(recToItem);
    setItems(list);
    setSections({
      topPicksForYou: list.slice(0, 4),
      becauseYouLiked: [],
      trendingWithSimilarUsers: list.slice(4, 8),
      allNearby: list,
    });
    setIsColdStartState(mock.isColdStart);
    setDiscoverMode('trending');
  }, [filterMode, userCoords, appliedQuery, locationPermissionDenied, userId, cuisine]);

  return {
    items,
    sections,
    isColdStart: isColdStartState,
    discoverMode,
    filterMode,
    setFilterMode,
    locationQuery,
    setLocationQuery,
    applyLocationQuery,
    selectedLocation: appliedQuery,
    locationPermissionDenied,
    loading,
    error,
  };
}

