import { ImageBackground, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

/** Neutral placeholder when no restaurant image is available (not food-specific). No pizza/food imagery. */
export const TONIGHT_CARD_PLACEHOLDER_URI =
  'https://placehold.co/800x600/e5e7eb/6b7280?text=No+photo';

export interface TonightCardModel {
  restaurant: {
    id: string;
    name: string;
    cuisine: string;
    neighborhood?: string;
    priceLevel?: number;
  };
  matchScore: number;
  /** Single field for card image: always an https or absolute URL, never a photo_reference. */
  imageUrl?: string;
  /** @deprecated Use imageUrl. */
  heroPhotoUrl?: string;
  reasonTags: string[];
}

interface Props {
  card: TonightCardModel;
}

/** Use only if value is a real URL (https or absolute), not a photo_reference. */
function isUsableImageUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('http');
}

export function TonightCard({ card }: Props) {
  const { restaurant, matchScore, imageUrl, heroPhotoUrl, reasonTags } = card;
  const raw = imageUrl ?? heroPhotoUrl;
  const imageUri = isUsableImageUrl(raw) ? raw : TONIGHT_CARD_PLACEHOLDER_URI;

  const content = (
    <View style={styles.overlay}>
      <View style={styles.topRow}>
        <View style={styles.matchPill}>
          <Text style={styles.matchText}>{Math.round(matchScore * 100)}% match</Text>
        </View>
      </View>
      <View style={styles.bottom}>
        <Text style={styles.name}>{restaurant.name}</Text>
        <Text style={styles.meta}>
          {restaurant.cuisine}
          {restaurant.neighborhood ? ` · ${restaurant.neighborhood}` : ''}
        </Text>
        {reasonTags.length ? (
          <Text style={styles.reason}>{reasonTags[0]}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <ImageBackground source={{ uri: imageUri }} style={styles.card} imageStyle={styles.image}>
      {content}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 0.8,
    borderRadius: 24,
    overflow: 'hidden',
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: '#d97757',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  image: {
    resizeMode: 'cover',
  },
  cardFallback: {
    backgroundColor: colors.surfaceSoft,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  matchPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f97316',
  },
  matchText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  bottom: {
    marginBottom: 4,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f9fafb',
  },
  meta: {
    marginTop: 4,
    fontSize: 14,
    color: '#e5e7eb',
  },
  reason: {
    marginTop: 6,
    fontSize: 13,
    color: '#f9fafb',
  },
});

