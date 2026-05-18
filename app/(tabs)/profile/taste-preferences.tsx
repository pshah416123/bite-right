/**
 * Taste Preferences — Sub-screen for dietary, price, vibes, and radius settings.
 * Moved out of the main Settings screen for cleaner separation.
 */
import { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '~/src/theme/colors';

const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Kosher', 'Dairy-free', 'Pescatarian'];
const PRICE_LEVELS: number[] = [1, 2, 3, 4];
const PRICE_LABELS: Record<number, string> = { 1: '$', 2: '$$', 3: '$$$', 4: '$$$$' };
const VIBES = ['Date night', 'Casual', 'Quick bite', 'Group dinner', 'Solo', 'Celebration'];
const RADIUS_STOPS = [1, 3, 5, 10, 25] as const;
const RADIUS_LABELS: Record<number, string> = {
  1: 'Walking distance',
  3: 'Close by',
  5: 'A short drive',
  10: 'Worth the trip',
  25: 'Willing to travel',
};

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function TastePreferencesScreen() {
  const router = useRouter();

  const [dietary, setDietary] = useState<Set<string>>(new Set());
  const [priceComfort, setPriceComfort] = useState<Set<number>>(new Set([1, 2]));
  const [vibes, setVibes] = useState<Set<string>>(new Set());
  const [radiusIndex, setRadiusIndex] = useState(2);
  const [distanceUnit] = useState<'mi' | 'km'>('mi');

  const toggleSet = useCallback(
    <T,>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, item: T) => {
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(item)) next.delete(item);
        else next.add(item);
        return next;
      });
      Haptics.selectionAsync().catch(() => {});
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Taste Preferences</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Help us find spots you'll love</Text>

        {/* Dietary */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>DIETARY NEEDS</Text>
          <View style={styles.card}>
            <View style={styles.chipWrap}>
              {DIETARY.map((d) => (
                <Chip
                  key={d}
                  label={d}
                  selected={dietary.has(d)}
                  onPress={() => toggleSet(setDietary, d)}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Price */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>PRICE COMFORT</Text>
          <View style={styles.card}>
            <View style={styles.priceRow}>
              {PRICE_LEVELS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.priceBtn, priceComfort.has(p) && styles.priceBtnSelected]}
                  onPress={() => toggleSet(setPriceComfort, p)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.priceBtnText, priceComfort.has(p) && styles.priceBtnTextSelected]}>
                    {PRICE_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Vibes */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>MOOD / VIBES</Text>
          <View style={styles.card}>
            <View style={styles.chipWrap}>
              {VIBES.map((v) => (
                <Chip
                  key={v}
                  label={v}
                  selected={vibes.has(v)}
                  onPress={() => toggleSet(setVibes, v)}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Radius */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>SEARCH RADIUS</Text>
          <View style={styles.card}>
            <View style={styles.radiusRow}>
              {RADIUS_STOPS.map((r, i) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.radiusDot, i === radiusIndex && styles.radiusDotActive]}
                  onPress={() => { setRadiusIndex(i); Haptics.selectionAsync().catch(() => {}); }}
                  activeOpacity={0.7}
                />
              ))}
            </View>
            <Text style={styles.radiusLabel}>
              {RADIUS_LABELS[RADIUS_STOPS[radiusIndex]]} ({RADIUS_STOPS[radiusIndex]} {distanceUnit})
            </Text>
          </View>
        </View>

        {/* Reset */}
        <TouchableOpacity style={styles.resetBtn} activeOpacity={0.7}>
          <Ionicons name="refresh-outline" size={16} color={colors.textMuted} />
          <Text style={styles.resetText}>Reset taste profile</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: { padding: 4 },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: 20,
  },

  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
  },
  chipSelected: {
    backgroundColor: colors.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: '#fff',
  },

  priceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  priceBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
  },
  priceBtnSelected: {
    backgroundColor: colors.accent,
  },
  priceBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
  },
  priceBtnTextSelected: {
    color: '#fff',
  },

  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  radiusDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 2,
    borderColor: colors.border,
  },
  radiusDotActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  radiusLabel: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },

  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  resetText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
});
