import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import type { SavedRestaurantItem } from '../api/saved';
import { resolveRestaurantDisplayImage } from '../utils/restaurantImage';

interface Props {
  item: SavedRestaurantItem;
  tags?: string[];
  onRemove: (placeId: string) => void;
}

export function SavedRestaurantListCard({ item, tags, onRemove }: Props) {
  const placeId = item.place_id ?? item.restaurantId;
  const photo = resolveRestaurantDisplayImage({
    previewPhotoUrl: item.previewPhotoUrl,
  }).url;
  const secondary = [item.neighborhood, item.city].filter(Boolean).join(' · ') || item.address || '';
  const rating = item.rating != null ? item.rating.toFixed(1) : null;
  const price =
    item.price_level != null && item.price_level > 0
      ? Array.from({ length: item.price_level }).fill('$').join('')
      : null;

  return (
    <View style={styles.wrap}>
      <Link href={`/(tabs)/restaurant/${placeId}`} asChild>
        <TouchableOpacity style={styles.card} activeOpacity={0.8}>
          <Image source={{ uri: photo }} style={styles.photo} />
          <View style={styles.meta}>
            <View style={styles.badgeRow}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            </View>
            {secondary ? (
              <Text style={styles.secondary} numberOfLines={1}>{secondary}</Text>
            ) : null}
            <View style={styles.row}>
              {rating != null && (
                <View style={styles.ratingPill}>
                  <Ionicons name="star" size={12} color={colors.accent} />
                  <Text style={styles.ratingText}>{rating}</Text>
                </View>
              )}
              {price ? <Text style={styles.price}>{price}</Text> : null}
            </View>
            {tags && tags.length > 0 && (
              <View style={styles.tagRow}>
                {tags.slice(0, 3).map((tag) => (
                  <View key={tag} style={styles.tagPill}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Link>
      <TouchableOpacity
        style={styles.bookmarkBtn}
        onPress={() => onRemove(placeId)}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="bookmark" size={22} color={colors.accent} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: {
    width: 88,
    height: 88,
    backgroundColor: colors.surfaceSoft,
  },
  meta: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  bookmarkBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
    padding: 4,
  },
  secondary: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  price: {
    fontSize: 12,
    color: colors.textMuted,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
