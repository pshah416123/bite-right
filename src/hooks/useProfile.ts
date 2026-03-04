import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { getSavedRestaurants } from '../api/saved';
import type { SavedRestaurantItem } from '../api/saved';
import { geocodeAutocomplete } from '../api/geo';
import type { GeocodeResult } from '../api/geo';
import type { TopRestaurant, SavedRestaurant, RestaurantType } from '../types/profile';

const DEFAULT_USER_ID = 'default';
const SAVED_LOCATION_STORAGE_KEY = 'biteright_saved_location';
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

export type SavedLocationMode = 'NEARBY' | 'CUSTOM';

export type CustomLocation = GeocodeResult;

interface PersistedSavedLocation {
  savedLocationMode: SavedLocationMode;
  customLocation: CustomLocation | null;
}

const DEFAULT_MODE: SavedLocationMode = 'NEARBY';

const MOCK_TOP: TopRestaurant[] = [
  { id: 'r1', name: "Lou Malnati's", cuisine: 'Pizza', neighborhood: 'River North', yourScore: 9.2, visitCount: 4 },
  { id: 'r2', name: 'Girl & the Goat', cuisine: 'American', neighborhood: 'West Loop', yourScore: 8.7, visitCount: 2 },
  { id: 'r3', name: "Portillo's", cuisine: 'Chicago classics', neighborhood: 'River North', yourScore: 9.0, visitCount: 3 },
];

function toSavedRestaurant(item: SavedRestaurantItem): SavedRestaurant {
  return {
    id: item.restaurantId,
    name: item.name,
    neighborhood: item.neighborhood || item.city || item.address || '',
    address: item.address,
    savedAt: item.savedAt,
  };
}

export function useProfile() {
  const [typeFilter, setTypeFilter] = useState<RestaurantType | 'all'>('all');
  const [savedLocationMode, setSavedLocationModeState] = useState<SavedLocationMode>(DEFAULT_MODE);
  const [customLocation, setCustomLocation] = useState<CustomLocation | null>(null);
  const [savedRaw, setSavedRaw] = useState<SavedRestaurantItem[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [customSearchQuery, setCustomSearchQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<GeocodeResult[]>([]);
  const [locationSuggestionsLoading, setLocationSuggestionsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSavedLocationMode = useCallback((mode: SavedLocationMode) => {
    setSavedLocationModeState(mode);
    if (mode !== 'CUSTOM') setLocationSuggestions([]);
  }, []);

  const refreshSaved = useCallback(async () => {
    setSavedLoading(true);
    setSavedError(null);
    try {
      let opts: { sort: 'location' | 'distance'; lat?: number; lng?: number };
      if (savedLocationMode === 'NEARBY' && userCoords) {
        opts = { sort: 'distance', lat: userCoords.lat, lng: userCoords.lng };
      } else if (savedLocationMode === 'CUSTOM' && customLocation) {
        opts = { sort: 'distance', lat: customLocation.lat, lng: customLocation.lng };
      } else {
        opts = { sort: 'location' };
      }
      const list = await getSavedRestaurants(DEFAULT_USER_ID, opts);
      setSavedRaw(list);
    } catch (e: unknown) {
      setSavedError(e instanceof Error ? e.message : 'Failed to load saved');
      setSavedRaw([]);
    } finally {
      setSavedLoading(false);
    }
  }, [savedLocationMode, userCoords, customLocation]);

  useEffect(() => {
    if (savedLocationMode !== 'CUSTOM') return;
    const q = customSearchQuery.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) {
      setLocationSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLocationSuggestionsLoading(true);
      const results = await geocodeAutocomplete(q);
      setLocationSuggestions(results);
      setLocationSuggestionsLoading(false);
      debounceRef.current = null;
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [savedLocationMode, customSearchQuery]);

  const selectCustomLocation = useCallback((item: GeocodeResult) => {
    setCustomLocation(item);
    setSavedLocationModeState('CUSTOM');
    setLocationSuggestions([]);
    setCustomSearchQuery(item.label);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVED_LOCATION_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedSavedLocation & { savedLocationMode?: string };
          const mode = parsed.savedLocationMode === 'CUSTOM' ? 'CUSTOM' : 'NEARBY';
          setSavedLocationModeState(mode);
          if (parsed.customLocation) {
            setCustomLocation(parsed.customLocation);
            if (mode === 'CUSTOM') setCustomSearchQuery(parsed.customLocation.label);
          }
        }
      } catch {
        // keep defaults
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      SAVED_LOCATION_STORAGE_KEY,
      JSON.stringify({
        savedLocationMode: savedLocationMode,
        customLocation: customLocation,
      } as PersistedSavedLocation),
    ).catch(() => {});
  }, [savedLocationMode, customLocation]);

  useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  useEffect(() => {
    if (savedLocationMode !== 'NEARBY') {
      setLocationPermission(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (cancelled) return;
      setLocationPermission(status === 'granted');
      if (status !== 'granted') {
        setUserCoords(null);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        setUserCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        if (!cancelled) setUserCoords(null);
      }
    })();
    return () => { cancelled = true; };
  }, [savedLocationMode]);

  const topRestaurants = useMemo(() => MOCK_TOP, []);

  const savedRestaurants = useMemo(() => {
    let list = savedRaw.map(toSavedRestaurant);
    if (typeFilter !== 'all') {
      list = list.filter((r) => r.type === typeFilter);
    }
    return list;
  }, [savedRaw, typeFilter]);

  return {
    topRestaurants,
    savedRestaurants,
    savedLoading,
    savedError,
    typeFilter,
    setTypeFilter,
    savedLocationMode,
    setSavedLocationMode,
    customLocation,
    customSearchQuery,
    setCustomSearchQuery,
    locationSuggestions,
    locationSuggestionsLoading,
    selectCustomLocation,
    locationPermission,
    refreshSaved,
  };
}
