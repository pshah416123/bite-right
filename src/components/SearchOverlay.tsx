/**
 * SearchOverlay — Full-screen search experience shared across Feed, Discover, and Compare.
 * Shows recent searches, popular near you, and live autocomplete results.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  fetchAutocomplete,
  selectRestaurant,
  getSampleSuggestions,
  type AutocompleteSuggestion,
} from '../api/restaurants';
import { useCompare, type CompareRestaurant } from '../context/CompareContext';
import { colors } from '../theme/colors';

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const MAX_RECENTS = 5;

// In-memory recent searches (persists across overlay opens within a session)
let recentSearches: { query: string; placeId?: string; name: string; address: string }[] = [];

function addRecent(entry: { query?: string; placeId?: string; name: string; address: string }) {
  recentSearches = [
    { query: entry.query ?? entry.name, ...entry },
    ...recentSearches.filter((r) => r.name !== entry.name),
  ].slice(0, MAX_RECENTS);
}

export interface SearchOverlayProps {
  visible: boolean;
  onClose: () => void;
  /** User GPS coordinates for location-biased results. */
  userCoords?: { lat: number; lng: number } | null;
  /** When set, show "Add to compare" action on results. */
  compareMode?: boolean;
}

export function SearchOverlay({
  visible,
  onClose,
  userCoords,
  compareMode = false,
}: SearchOverlayProps) {
  const router = useRouter();
  const { selected, toggle } = useCompare();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [popularNearby, setPopularNearby] = useState<AutocompleteSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load popular suggestions on mount
  useEffect(() => {
    if (visible) {
      setPopularNearby(getSampleSuggestions());
      setTimeout(() => inputRef.current?.focus(), 150);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [visible]);

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const suggestions = await fetchAutocomplete(query.trim(), userCoords);
        setResults(suggestions.slice(0, 8));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, userCoords]);

  const navigateToRestaurant = useCallback(
    async (suggestion: AutocompleteSuggestion) => {
      addRecent({ name: suggestion.name, address: suggestion.address, placeId: suggestion.placeId });
      Keyboard.dismiss();

      // Mock restaurants use local IDs — skip selectRestaurant API call
      const isMock = suggestion.placeId.startsWith('mock_');
      const restaurantId = isMock ? suggestion.placeId.replace(/^mock_/, '') : suggestion.placeId;

      if (isMock) {
        const payload = encodeURIComponent(
          JSON.stringify({ id: restaurantId, name: suggestion.name, cuisine: '' }),
        );
        onClose();
        router.push(`/(tabs)/restaurant/${encodeURIComponent(restaurantId)}?payload=${payload}`);
        return;
      }

      try {
        const res = await selectRestaurant(suggestion.placeId);
        const payload = encodeURIComponent(
          JSON.stringify({
            id: res.restaurantId,
            name: res.name ?? suggestion.name,
            cuisine: '',
            placeId: res.placeId ?? suggestion.placeId,
            googlePlaceId: res.googlePlaceId ?? res.placeId ?? suggestion.placeId,
            displayImageUrl: res.displayImageUrl ?? null,
            displayImageSourceType: res.displayImageSourceType ?? null,
            displayImageLastResolvedAt: res.displayImageLastResolvedAt ?? null,
            imageUrl: res.displayImageUrl ?? null,
            address: res.address ?? suggestion.address ?? null,
          }),
        );
        onClose();
        router.push(`/(tabs)/restaurant/${encodeURIComponent(res.restaurantId)}?payload=${payload}`);
      } catch {
        const payload = encodeURIComponent(
          JSON.stringify({
            id: suggestion.placeId,
            name: suggestion.name,
            cuisine: '',
            placeId: suggestion.placeId,
            googlePlaceId: suggestion.placeId,
          }),
        );
        onClose();
        router.push(`/(tabs)/restaurant/${encodeURIComponent(suggestion.placeId)}?payload=${payload}`);
      }
    },
    [router, onClose],
  );

  const addToCompare = useCallback(
    async (suggestion: AutocompleteSuggestion) => {
      const isMock = suggestion.placeId.startsWith('mock_');
      const restaurantId = isMock ? suggestion.placeId.replace(/^mock_/, '') : suggestion.placeId;

      if (selected.some((r) => r.id === restaurantId || r.id === suggestion.placeId)) {
        onClose();
        return;
      }

      if (isMock) {
        toggle({ id: restaurantId, name: suggestion.name, cuisine: '' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
        return;
      }

      try {
        const res = await selectRestaurant(suggestion.placeId);
        const restaurant: CompareRestaurant = {
          id: res.restaurantId,
          name: res.name ?? suggestion.name,
          cuisine: '',
          imageUrl: res.displayImageUrl || null,
        };
        toggle(restaurant);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch {
        toggle({ id: suggestion.placeId, name: suggestion.name, cuisine: '' });
      }
      onClose();
    },
    [selected, toggle, onClose],
  );

  const handleSelect = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      if (compareMode) {
        addToCompare(suggestion);
      } else {
        navigateToRestaurant(suggestion);
      }
    },
    [compareMode, addToCompare, navigateToRestaurant],
  );

  if (!visible) return null;

  const hasQuery = query.trim().length >= MIN_QUERY;
  const showRecents = !hasQuery && recentSearches.length > 0;
  const showPopular = !hasQuery && !showRecents && popularNearby.length > 0;
  const showResults = hasQuery && (results.length > 0 || loading);

  return (
    <SafeAreaView style={styles.overlay} edges={['top']}>
      {/* Search header */}
      <View style={styles.header}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search restaurants, cuisines, dishes..."
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {loading && <ActivityIndicator size="small" color={colors.textMuted} />}
          {query.length > 0 && !loading && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {/* Recent searches */}
      {showRecents && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent</Text>
          {recentSearches.map((r) => (
            <TouchableOpacity
              key={r.name}
              style={styles.resultRow}
              onPress={() => {
                setQuery(r.name);
                if (r.placeId) handleSelect({ placeId: r.placeId, name: r.name, address: r.address });
              }}
              activeOpacity={0.6}
            >
              <Ionicons name="time-outline" size={16} color={colors.textFaint} />
              <View style={styles.resultText}>
                <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                {r.address ? (
                  <Text style={styles.resultAddr} numberOfLines={1}>{r.address}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Popular near you */}
      {showPopular && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Popular near you</Text>
          {popularNearby.map((s) => (
            <TouchableOpacity
              key={s.placeId}
              style={styles.resultRow}
              onPress={() => handleSelect(s)}
              activeOpacity={0.6}
            >
              <Ionicons name="flame-outline" size={16} color={colors.accent} />
              <View style={styles.resultText}>
                <Text style={styles.resultName} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.resultAddr} numberOfLines={1}>{s.address}</Text>
              </View>
              {compareMode ? (
                <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Live results */}
      {showResults && (
        <View style={styles.section}>
          {loading && results.length === 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Searching...</Text>
            </View>
          ) : (
            results.map((s) => {
              const inCompare = selected.some((r) => r.id === s.placeId);
              return (
                <TouchableOpacity
                  key={s.placeId}
                  style={styles.resultRow}
                  onPress={() => handleSelect(s)}
                  activeOpacity={0.6}
                >
                  <Ionicons name="restaurant-outline" size={16} color={colors.textMuted} />
                  <View style={styles.resultText}>
                    <Text style={styles.resultName} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.resultAddr} numberOfLines={1}>{s.address}</Text>
                  </View>
                  {compareMode ? (
                    inCompare ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                    ) : (
                      <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                    )
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}

      {/* Empty state when typing but no results */}
      {hasQuery && !loading && results.length === 0 && (
        <View style={styles.emptyWrap}>
          <Ionicons name="search-outline" size={32} color={colors.textFaint} />
          <Text style={styles.emptyText}>No restaurants found for "{query.trim()}"</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 999,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    paddingVertical: 0,
  },
  cancelBtn: {
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },

  section: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultText: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  resultAddr: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textMuted,
    marginTop: 1,
  },

  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },

  emptyWrap: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
