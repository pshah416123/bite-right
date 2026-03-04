import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RESTAURANTS } from '../../src/data/restaurants';
import { colors } from '../../src/theme/colors';
import { useFeedContext } from '../../src/context/FeedContext';
import type { VibeTag } from '../../src/components/FeedCard';
import { getRestaurantDetail, type RestaurantDetail } from '../../src/api/restaurants';

const VIBE_LABELS: Record<VibeTag, string> = {
  date_night: 'Date night',
  casual: 'Casual',
  solo_dining: 'Solo dining',
  group: 'Group dinner',
  celebration: 'Celebration',
  quick_bite: 'Quick bite',
};

function isOpenableUrl(url: string): boolean {
  return typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'));
}

export default function RestaurantScreen() {
  const params = useLocalSearchParams<{ id: string; logId?: string }>();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : undefined;
  const logId = typeof params.logId === 'string' ? params.logId : Array.isArray(params.logId) ? params.logId[0] : undefined;
  const router = useRouter();
  const { items: feedItems } = useFeedContext();
  const [detail, setDetail] = useState<RestaurantDetail | null>(null);
  const restaurant = id ? RESTAURANTS.find((r) => r.id === id) : null;
  const log = logId
    ? feedItems.find((l) => l.id === logId)
    : id
      ? feedItems.find((l) => l.restaurantId === id)
      : undefined;

  useEffect(() => {
    if (!id) return;
    getRestaurantDetail(id).then(setDetail);
  }, [id]);

  const canReserve =
    (detail?.reservationUrl && isOpenableUrl(detail.reservationUrl)) ||
    (detail?.websiteUrl && isOpenableUrl(detail.websiteUrl)) ||
    (detail?.googleMapsUrl && isOpenableUrl(detail.googleMapsUrl)) ||
    (detail?.phone && detail.phone.trim().length > 0);

  const handleReserve = () => {
    if (!detail) return;
    const url =
      (detail.reservationUrl && isOpenableUrl(detail.reservationUrl) ? detail.reservationUrl : null) ||
      (detail.websiteUrl && isOpenableUrl(detail.websiteUrl) ? detail.websiteUrl : null) ||
      (detail.googleMapsUrl && isOpenableUrl(detail.googleMapsUrl) ? detail.googleMapsUrl : null);
    if (url) {
      Linking.openURL(url).catch(() => {});
      return;
    }
    if (detail.phone && detail.phone.trim()) {
      Alert.alert(
        'Call restaurant',
        `Open phone to call ${detail.phone.trim()}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call', onPress: () => Linking.openURL(`tel:${detail.phone!.trim()}`).catch(() => {}) },
        ],
      );
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#111827" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{restaurant?.name ?? log?.restaurantName ?? detail?.name ?? `Restaurant ${id}`}</Text>
        {restaurant ? (
          <Text style={styles.subtitle}>
            {restaurant.cuisine}
            {(restaurant.neighborhood || restaurant.state)
              ? ` · ${[restaurant.neighborhood, restaurant.state].filter(Boolean).join(', ')}`
              : ''}
          </Text>
        ) : log ? (
          <Text style={styles.subtitle}>{log.cuisine}</Text>
        ) : (
          <Text style={styles.subtitle}>Restaurant page details coming soon.</Text>
        )}

        {canReserve ? (
          <TouchableOpacity style={styles.reserveButton} onPress={handleReserve} activeOpacity={0.8}>
            <Text style={styles.reserveButtonText}>Reserve</Text>
          </TouchableOpacity>
        ) : null}

        {restaurant && (restaurant.neighborhood || restaurant.state) ? (
          <View style={styles.locationSection}>
            <View style={styles.locationRow}>
              <Ionicons name="location" size={18} color={colors.accent} />
              <Text style={styles.locationLabel}>Location</Text>
            </View>
            <Text style={styles.locationAddress}>
              {[restaurant.neighborhood, restaurant.state].filter(Boolean).join(', ')}
            </Text>
          </View>
        ) : null}

        {log ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your rating</Text>
              <View style={styles.ratingBreakdown}>
                <View style={styles.ratingRow}>
                  <Text style={styles.ratingLabel}>Overall</Text>
                  <Text style={styles.ratingValue}>{log.score.toFixed(1)}</Text>
                </View>
                {log.foodRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Food</Text>
                    <Text style={styles.ratingValue}>{log.foodRating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {log.serviceRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Service</Text>
                    <Text style={styles.ratingValue}>{log.serviceRating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {log.ambienceRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Ambience</Text>
                    <Text style={styles.ratingValue}>{log.ambienceRating.toFixed(1)}</Text>
                  </View>
                ) : null}
                {log.valueRating != null ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>Value</Text>
                    <Text style={styles.ratingValue}>{log.valueRating.toFixed(1)}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {log.dishes && log.dishes.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Dishes you tried</Text>
                <View style={styles.dishList}>
                  {log.dishes.map((d, i) => (
                    <Text key={i} style={styles.dishItem}>
                      · {d}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {log.vibeTags && log.vibeTags.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Vibe</Text>
                <View style={styles.vibeWrap}>
                  {log.vibeTags.map((v) => (
                    <View key={v} style={styles.vibePill}>
                      <Text style={styles.vibePillText}>{VIBE_LABELS[v]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Network rating</Text>
              <Text style={styles.placeholder}>Ratings and taste-matched stats will appear here.</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recommended dishes</Text>
              <Text style={styles.placeholder}>Dish recommendations from logs will show up here.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backText: {
    marginLeft: 2,
    fontSize: 14,
    color: '#111827',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 20,
  },
  reserveButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  reserveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  locationSection: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  locationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  locationAddress: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: 26,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  placeholder: {
    fontSize: 14,
    color: '#6b7280',
  },
  ratingBreakdown: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  ratingLabel: { fontSize: 14, color: colors.text },
  ratingValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  dishList: { marginTop: 6 },
  dishItem: { fontSize: 14, color: colors.text, marginBottom: 4 },
  vibeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  vibePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vibePillText: { fontSize: 13, color: colors.text },
});

