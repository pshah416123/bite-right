import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { RestaurantImage } from './RestaurantImage';
import type { DiscoverItem } from './RestaurantCard';

interface Props {
  title: string;
  subtitle?: string;
  restaurants: DiscoverItem[];
  onPressHeader: () => void;
  onPressRestaurant: (item: DiscoverItem) => void;
  userCoords?: { lat: number; lng: number } | null;
}

function haversineDistanceMi(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function MiniRestaurantCard({
  item,
  onPress,
  userCoords,
}: {
  item: DiscoverItem;
  onPress: () => void;
  userCoords?: { lat: number; lng: number } | null;
}) {
  const { restaurant, matchScore } = item;

  const distanceLabel =
    userCoords &&
    restaurant.lat != null &&
    restaurant.lng != null &&
    isFinite(restaurant.lat) &&
    isFinite(restaurant.lng)
      ? `${haversineDistanceMi(userCoords.lat, userCoords.lng, restaurant.lat, restaurant.lng).toFixed(1)} mi`
      : null;

  return (
    <TouchableOpacity style={styles.miniCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.miniImageWrap}>
        <RestaurantImage
          restaurant={{
            id: restaurant.id,
            name: restaurant.name,
            cuisine: restaurant.cuisine,
            googlePlaceId: restaurant.googlePlaceId ?? restaurant.placeId ?? null,
            displayImageUrl:
              restaurant.displayImageUrl ?? restaurant.imageUrl ?? restaurant.previewPhotoUrl ?? null,
            displayImageSourceType: restaurant.displayImageSourceType ?? null,
            displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt ?? null,
            previewPhotoUrl: restaurant.previewPhotoUrl ?? null,
            imageUrl: restaurant.imageUrl ?? null,
          }}
          aspectRatio={1}
          fallbackType="icon"
          borderRadius={14}
          style={styles.miniImage}
        />
        <View style={styles.scoreBadge}>
          <Text style={styles.scoreBadgeText}>{Math.round(matchScore * 100)}%</Text>
        </View>
      </View>
      <Text style={styles.miniName} numberOfLines={1}>
        {restaurant.name}
      </Text>
      {distanceLabel ? (
        <View style={styles.miniDistanceRow}>
          <Ionicons name="location-outline" size={10} color={colors.accent} />
          <Text style={styles.miniDistance}>{distanceLabel}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export function DiscoverBridgeCard({
  title,
  subtitle,
  restaurants,
  onPressHeader,
  onPressRestaurant,
  userCoords,
}: Props) {
  if (restaurants.length === 0) return null;

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.headerRow}
        onPress={onPressHeader}
        activeOpacity={0.75}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <FlatList
        data={restaurants}
        keyExtractor={(item) => item.restaurant.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        renderItem={({ item }) => (
          <MiniRestaurantCard
            item={item}
            onPress={() => onPressRestaurant(item)}
            userCoords={userCoords}
          />
        )}
      />
    </View>
  );
}

const MINI_CARD_WIDTH = 130;

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 16,
    paddingBottom: 14,
    marginBottom: 14,
    shadowColor: 'rgba(180,120,80,0.12)',
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  scrollContent: {
    paddingHorizontal: 14,
    gap: 12,
  },
  miniCard: {
    width: MINI_CARD_WIDTH,
  },
  miniImageWrap: {
    width: MINI_CARD_WIDTH,
    height: MINI_CARD_WIDTH,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSoft,
  },
  miniImage: {
    width: MINI_CARD_WIDTH,
    height: MINI_CARD_WIDTH,
    borderRadius: 14,
  },
  scoreBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 38,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  miniName: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  miniDistanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  miniDistance: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
