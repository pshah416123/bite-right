/**
 * RestaurantAutocomplete — inline dropdown of matching restaurants from
 * the server's Google-Places-backed autocomplete. Companion to
 * FoodAutocomplete (which only surfaces dishes/drinks); this lets the
 * Discover search bar resolve "Rebecca's" or "Pizzeria Uno" directly to
 * a restaurant detail page instead of forcing a full Discover search.
 *
 * The caller renders the TextInput; we own the suggestion list and the
 * debounced fetch, and call onPick(suggestion) when the user taps one.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchAutocomplete, type AutocompleteSuggestion } from '../api/restaurants';

type Props = {
  query: string;
  coords?: { lat: number; lng: number } | null;
  onPick: (suggestion: AutocompleteSuggestion) => void;
  /** Cap the visible suggestion count. Default 5. */
  maxSuggestions?: number;
  /** Optional style override (margin etc.) */
  style?: object;
};

export function RestaurantAutocomplete({ query, coords, onPick, maxSuggestions = 5, style }: Props) {
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // Request-id guard so a slow earlier request can't overwrite a faster
  // later one when the user types quickly.
  const reqIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const results = await fetchAutocomplete(trimmed, coords);
        if (reqIdRef.current !== reqId) return;
        setSuggestions(results.slice(0, maxSuggestions));
      } catch {
        if (reqIdRef.current !== reqId) return;
        setSuggestions([]);
      } finally {
        if (reqIdRef.current === reqId) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, coords?.lat, coords?.lng, maxSuggestions]);

  if (!loading && suggestions.length === 0) return null;

  return (
    <View style={[s.wrap, style]}>
      <Text style={s.sectionLabel}>Restaurants</Text>
      {loading && suggestions.length === 0 ? (
        <View style={s.loadingRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={s.loadingText}>Searching…</Text>
        </View>
      ) : null}
      {suggestions.map((sug) => (
        <TouchableOpacity
          key={sug.placeId}
          style={s.row}
          onPress={() => onPick(sug)}
          activeOpacity={0.7}
        >
          <Ionicons name="storefront-outline" size={14} color={colors.textMuted} />
          <View style={s.textWrap}>
            <Text style={s.name} numberOfLines={1}>{sug.name}</Text>
            {sug.address ? (
              <Text style={s.address} numberOfLines={1}>{sug.address}</Text>
            ) : null}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  textWrap: { flex: 1 },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1,
  },
  address: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  loadingText: { fontSize: 13, color: colors.textMuted },
});
