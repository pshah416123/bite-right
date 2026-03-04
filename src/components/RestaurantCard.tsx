import { Image, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

export interface DiscoverItem {
  restaurant: {
    id: string;
    name: string;
    cuisine: string;
    neighborhood?: string;
    state?: string;
    priceLevel?: number;
    placeId?: string | null;
    /** Single field for card image: https or absolute URL. */
    imageUrl?: string;
  };
  matchScore: number;
  reasonTags: string[];
}

interface Props {
  item: DiscoverItem;
}

function isUsableImageUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('http');
}

export function RestaurantCard({ item }: Props) {
  const { restaurant, matchScore, reasonTags } = item;
  const imageUrl = isUsableImageUrl(restaurant.imageUrl) ? restaurant.imageUrl : undefined;
  return (
    <Link href={`/restaurant/${restaurant.id}`} asChild>
      <View style={styles.card}>
        <View style={styles.row}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder} />
          )}
          <View style={styles.meta}>
            <Text style={styles.name}>{restaurant.name}</Text>
            <Text style={styles.secondary}>
              {restaurant.cuisine}
              {(restaurant.neighborhood || restaurant.state)
                ? ` · ${[restaurant.neighborhood, restaurant.state].filter(Boolean).join(', ')}`
                : ''}
            </Text>
            {(restaurant.neighborhood || restaurant.state) ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={11} color={colors.textMuted} />
                <Text style={styles.locationText} numberOfLines={1}>
                  {[restaurant.neighborhood, restaurant.state].filter(Boolean).join(', ')}
                </Text>
              </View>
            ) : null}
            <Text style={styles.secondary}>
              {Array.from({ length: restaurant.priceLevel ?? 0 })
                .map(() => '$')
                .join('')}
            </Text>
          </View>
          <View style={styles.matchPill}>
            <Text style={styles.matchText}>{Math.round(matchScore * 100)}%</Text>
          </View>
        </View>
        {reasonTags.length ? (
          <View style={styles.tagsRow}>
            {reasonTags.slice(0, 2).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  photo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surfaceSoft,
  },
  photoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surfaceSoft,
  },
  meta: {
    flex: 1,
    marginLeft: 10,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  secondary: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  locationText: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
  },
  matchPill: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.surfaceSoft,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: {
    fontSize: 11,
    color: colors.textMuted,
  },
});

