import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiClient } from '~/src/api/client';
import { colors } from '~/src/theme/colors';

export type DiscoverSelectedLocation = {
  label: string;
  placeId: string | null;
  lat: number;
  lng: number;
};

const RECENT_LOCATIONS_KEY = 'biteright_recent_location_searches';

type GeoSuggestion = { label: string; lat: number; lng: number };

export const POPULAR_LOCATIONS: DiscoverSelectedLocation[] = [
  { label: 'West Loop, Chicago, IL', placeId: null, lat: 41.8815, lng: -87.6472 },
  { label: 'River North, Chicago, IL', placeId: null, lat: 41.8902, lng: -87.6369 },
  { label: 'Lincoln Park, Chicago, IL', placeId: null, lat: 41.9205, lng: -87.653 },
  { label: 'Logan Square, Chicago, IL', placeId: null, lat: 41.923, lng: -87.706 },
  { label: 'Wicker Park, Chicago, IL', placeId: null, lat: 41.9074, lng: -87.679 },
  { label: 'Gold Coast, Chicago, IL', placeId: null, lat: 41.9016, lng: -87.6233 },
  { label: 'Chicago Loop, Chicago, IL', placeId: null, lat: 41.8837, lng: -87.6298 },
];

export type DiscoverLocationBarProps = {
  filterMode: 'nearby' | 'location';
  onFilterModeChange: (mode: 'nearby' | 'location') => void;
  selectedLocation: DiscoverSelectedLocation | null;
  /** Fires when user picks a suggestion / recent / popular location */
  onCommitLocation: (loc: DiscoverSelectedLocation) => void;
  /** When user edits input away from the committed selection (Discover clears fetch cache) */
  onLocationInputDiverged?: () => void;
  /** Shown under mode chips (nearby) or under search (location) — same as Discover */
  cuisineRow?: ReactNode;
};

export function DiscoverLocationBar({
  filterMode,
  onFilterModeChange,
  selectedLocation,
  onCommitLocation,
  onLocationInputDiverged,
  cuisineRow,
}: DiscoverLocationBarProps) {
  const [locationInput, setLocationInput] = useState(selectedLocation?.label ?? '');
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [recentLocations, setRecentLocations] = useState<DiscoverSelectedLocation[]>([]);
  const [geoSuggestions, setGeoSuggestions] = useState<GeoSuggestion[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoNoResults, setGeoNoResults] = useState(false);

  const suggestionCacheRef = useRef<Record<string, GeoSuggestion[]>>({});
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const recentLoadedRef = useRef(false);

  useEffect(() => {
    if (selectedLocation?.label) {
      setLocationInput(selectedLocation.label);
    }
  }, [selectedLocation?.label]);

  const persistRecentLocations = async (next: DiscoverSelectedLocation[]) => {
    setRecentLocations(next);
    try {
      await AsyncStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const loadRecentLocations = async () => {
    if (recentLoadedRef.current) return;
    recentLoadedRef.current = true;
    try {
      const raw = await AsyncStorage.getItem(RECENT_LOCATIONS_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (!Array.isArray(parsed)) return;

      const mapped: DiscoverSelectedLocation[] = [];
      for (const entry of parsed) {
        if (typeof entry === 'string') {
          mapped.push({ label: entry, placeId: null, lat: 41.88, lng: -87.63 });
          continue;
        }
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Partial<DiscoverSelectedLocation>;
        if (typeof e.label !== 'string') continue;
        const lat = typeof e.lat === 'number' ? e.lat : 41.88;
        const lng = typeof e.lng === 'number' ? e.lng : -87.63;
        mapped.push({ label: e.label, placeId: e.placeId ?? null, lat, lng });
      }

      setRecentLocations(mapped.slice(0, 8));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (filterMode !== 'location' || !locationDropdownOpen) return;
    loadRecentLocations();
  }, [filterMode, locationDropdownOpen]);

  const commitSelectedLocation = (loc: DiscoverSelectedLocation) => {
    const trimmedLabel = loc.label.trim();
    if (!trimmedLabel) return;
    setLocationDropdownOpen(false);
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    const normalized = trimmedLabel.toLowerCase();
    const next = [
      { ...loc, label: trimmedLabel },
      ...recentLocations.filter((x) => x.label.toLowerCase() !== normalized),
    ].slice(0, 8);

    persistRecentLocations(next).catch(() => {});

    const nextLocation = { ...loc, label: trimmedLabel };
    setLocationInput(trimmedLabel);
    onCommitLocation(nextLocation);
  };

  useEffect(() => {
    if (filterMode !== 'location' || !locationDropdownOpen) return;
    const q = locationInput.trim();
    if (!q) {
      setGeoSuggestions([]);
      setGeoNoResults(false);
      setGeoLoading(false);
      return;
    }

    const key = q.toLowerCase();
    const cached = suggestionCacheRef.current[key];
    if (cached) {
      setGeoSuggestions(cached);
      setGeoNoResults(cached.length === 0);
      setGeoLoading(false);
      return;
    }

    setGeoLoading(true);
    setGeoNoResults(false);

    const reqId = ++requestIdRef.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get<{ results: GeoSuggestion[] }>('/api/geo/autocomplete', {
          params: { query: q },
        });
        if (requestIdRef.current !== reqId) return;
        const results = Array.isArray(data?.results) ? data.results : [];
        suggestionCacheRef.current[key] = results;
        setGeoSuggestions(results);
        setGeoNoResults(results.length === 0);
      } catch {
        if (requestIdRef.current !== reqId) return;
        setGeoSuggestions([]);
        setGeoNoResults(true);
      } finally {
        if (requestIdRef.current !== reqId) return;
        setGeoLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(t);
    };
  }, [filterMode, locationDropdownOpen, locationInput]);

  return (
    <View>
      <View style={styles.chips}>
        {(['nearby', 'location'] as const).map((mode) => (
          <TouchableOpacity
            key={mode}
            onPress={() => onFilterModeChange(mode)}
            style={[styles.chip, filterMode === mode && styles.chipActive]}
          >
            <Text style={[styles.chipText, filterMode === mode && styles.chipTextActive]}>
              {mode === 'nearby' ? 'Nearby' : 'Location'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filterMode === 'nearby' && cuisineRow ? <View style={styles.cuisineSlot}>{cuisineRow}</View> : null}

      {filterMode === 'location' ? (
        <View style={styles.locationSearchWrap}>
          <TextInput
            value={locationInput}
            onChangeText={(text) => {
              setLocationInput(text);
              if (
                selectedLocation &&
                text.trim().toLowerCase() !== selectedLocation.label.trim().toLowerCase()
              ) {
                onLocationInputDiverged?.();
              }
              if (!locationDropdownOpen) setLocationDropdownOpen(true);
            }}
            placeholder="Search for a neighborhood or city"
            placeholderTextColor={colors.textMuted}
            style={styles.locationSearchInput}
            returnKeyType="search"
            onSubmitEditing={async () => {
              const q = locationInput.trim();
              if (!q) return;
              try {
                const { data } = await apiClient.get<{ results: GeoSuggestion[] }>('/api/geo/autocomplete', {
                  params: { query: q },
                });
                const first = Array.isArray(data?.results) ? data.results[0] : null;
                if (!first) return;
                commitSelectedLocation({
                  label: first.label,
                  placeId: null,
                  lat: first.lat,
                  lng: first.lng,
                });
              } catch {
                // ignore
              }
            }}
            onFocus={() => {
              if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
                blurTimeoutRef.current = null;
              }
              setLocationDropdownOpen(true);
            }}
            onBlur={() => {
              blurTimeoutRef.current = setTimeout(() => {
                setLocationDropdownOpen(false);
              }, 140);
            }}
          />
          {locationDropdownOpen ? (
            <View style={styles.locationDropdown}>
              <ScrollView style={styles.locationDropdownScroll} keyboardShouldPersistTaps="handled">
                {locationInput.trim().length === 0 ? (
                  <>
                    {recentLocations.length > 0
                      ? recentLocations.map((loc) => (
                          <TouchableOpacity
                            key={`recent_${loc.label}`}
                            style={styles.locationDropdownRow}
                            activeOpacity={0.9}
                            onPress={() => commitSelectedLocation(loc)}
                          >
                            <Text style={styles.locationDropdownPrimary} numberOfLines={1}>
                              {loc.label}
                            </Text>
                          </TouchableOpacity>
                        ))
                      : null}
                    {POPULAR_LOCATIONS.map((loc) => (
                      <TouchableOpacity
                        key={`popular_${loc.label}`}
                        style={styles.locationDropdownRow}
                        activeOpacity={0.9}
                        onPress={() => commitSelectedLocation(loc)}
                      >
                        <Text style={styles.locationDropdownPrimary} numberOfLines={1}>
                          {loc.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </>
                ) : geoLoading ? (
                  <View style={styles.locationDropdownEmptyRow}>
                    <Text style={styles.locationDropdownEmptyText}>Loading…</Text>
                  </View>
                ) : geoNoResults ? (
                  <View style={styles.locationDropdownEmptyRow}>
                    <Text style={styles.locationDropdownEmptyText}>No locations found</Text>
                  </View>
                ) : geoSuggestions.length > 0 ? (
                  geoSuggestions.map((s) => (
                    <TouchableOpacity
                      key={s.label}
                      style={styles.locationDropdownRow}
                      activeOpacity={0.9}
                      onPress={() =>
                        commitSelectedLocation({
                          label: s.label,
                          placeId: null,
                          lat: s.lat,
                          lng: s.lng,
                        })
                      }
                    >
                      <Text style={styles.locationDropdownPrimary} numberOfLines={1}>
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={styles.locationDropdownEmptyRow}>
                    <Text style={styles.locationDropdownEmptyText}>No locations found</Text>
                  </View>
                )}
              </ScrollView>
            </View>
          ) : null}
          {cuisineRow ? <View style={styles.cuisineSlot}>{cuisineRow}</View> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', marginTop: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  cuisineSlot: { marginTop: 10 },
  locationSearchWrap: { marginTop: 12, gap: 8 },
  locationSearchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.text,
  },
  locationDropdown: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  locationDropdownScroll: { maxHeight: 240 },
  locationDropdownRow: { paddingVertical: 10, paddingHorizontal: 12 },
  locationDropdownPrimary: { fontSize: 13, fontWeight: '700', color: colors.text },
  locationDropdownEmptyRow: { paddingVertical: 14, paddingHorizontal: 12 },
  locationDropdownEmptyText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
});
