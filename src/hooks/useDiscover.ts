import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import type { DiscoverItem } from '../components/RestaurantCard';
import { getDiscover } from '../api/discover';
import type { DiscoverMode } from '../api/discover';
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

interface UseDiscoverResult {
  items: DiscoverItem[];
  isColdStart: boolean;
  filterMode: DiscoverMode;
  setFilterMode: (mode: DiscoverMode) => void;
  locationQuery: string;
  setLocationQuery: (q: string) => void;
  applyLocationQuery: () => void;
  locationPermissionDenied: boolean;
  loading: boolean;
  error: string | null;
}

function recToItem(rec: {
  restaurant: {
    id: string;
    name: string;
    cuisine?: string;
    neighborhood?: string;
    priceLevel?: number;
    placeId?: string | null;
    imageUrl?: string;
  };
  percentMatch: number;
  explanations: string[];
}): DiscoverItem {
  return {
    restaurant: {
      id: rec.restaurant.id,
      name: rec.restaurant.name,
      cuisine: rec.restaurant.cuisine ?? '',
      neighborhood: rec.restaurant.neighborhood,
      priceLevel: rec.restaurant.priceLevel,
      placeId: rec.restaurant.placeId,
      imageUrl: ensureAbsoluteImageUrl(rec.restaurant.imageUrl),
    },
    matchScore: rec.percentMatch / 100,
    reasonTags: rec.explanations,
  };
}

export function useDiscover(userId = 'you'): UseDiscoverResult {
  const [filterMode, setFilterModeState] = useState<DiscoverMode>('nearby');
  const [locationQuery, setLocationQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [items, setItems] = useState<DiscoverItem[]>([]);
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
        const { status } = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setLocationPermissionDenied(true);
          setUserCoords(null);
          setFilterModeState('location');
          return;
        }
        setLocationPermissionDenied(false);
        try {
          const loc = await Location.getCurrentPositionAsync({});
          if (cancelled) return;
          setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        } catch {
          if (!cancelled) {
            setUserCoords(null);
            setLocationPermissionDenied(true);
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
      getDiscover({ mode: 'nearby', lat: userCoords.lat, lng: userCoords.lng, radiusMiles: 10 })
        .then((res) => {
          if (cancelled) return;
          const items = res.recommendations.map(recToItem);
          setItems(items);
          if (__DEV__ && items.length > 0) {
            const first = res.recommendations[0]?.restaurant;
            if (first) {
              const imageUrl = first.imageUrl ?? '(none)';
              const isHttps = typeof imageUrl === 'string' && imageUrl.startsWith('https');
              console.log('[Discover] First result:', { name: first.name, placeId: first.placeId ?? null, imageUrl, isHttpsUrl: isHttps });
            }
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e.response?.data?.error || e.message || 'Discover failed');
          const mock = getDiscoverRecommendations(userId);
          setItems(mock.recommendations.map(recToItem));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return;
    }

    if (filterMode === 'location' && appliedQuery) {
      getDiscover({ mode: 'location', query: appliedQuery, radiusMiles: 10 })
        .then((res) => {
          if (cancelled) return;
          const items = res.recommendations.map(recToItem);
          setItems(items);
          if (__DEV__ && items.length > 0) {
            const first = res.recommendations[0]?.restaurant;
            if (first) {
              const imageUrl = first.imageUrl ?? '(none)';
              const isHttps = typeof imageUrl === 'string' && imageUrl.startsWith('https');
              console.log('[Discover] First result:', { name: first.name, placeId: first.placeId ?? null, imageUrl, isHttpsUrl: isHttps });
            }
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e.response?.data?.error || e.message || 'Discover failed');
          const mock = getDiscoverRecommendations(userId);
          setItems(mock.recommendations.map(recToItem));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return;
    }

    setLoading(false);
    if (filterMode === 'location' && !appliedQuery) {
      setItems([]);
      return;
    }
    const mock = getDiscoverRecommendations(userId);
    setItems(mock.recommendations.map(recToItem));
  }, [filterMode, userCoords, appliedQuery, locationPermissionDenied, userId]);

  const isColdStart = useMemo(() => {
    const mock = getDiscoverRecommendations(userId);
    return mock.isColdStart;
  }, [userId]);

  return {
    items,
    isColdStart,
    filterMode,
    setFilterMode,
    locationQuery,
    setLocationQuery,
    applyLocationQuery,
    locationPermissionDenied,
    loading,
    error,
  };
}

