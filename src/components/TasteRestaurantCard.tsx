import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '~/src/theme/colors';

export type TasteRestaurantCardModel = {
  id: string;
  name: string;
  neighborhood?: string | null;
  city?: string | null;
  /** Short label e.g. Casual */
  tag: string;
  imageUrl?: string | null;
  saved: boolean;
  /** Encoded payload for restaurant detail deep link */
  detailPayload: string;
};

type Props = {
  item: TasteRestaurantCardModel;
};

export function TasteRestaurantCard({ item }: Props) {
  const uri =
    item.imageUrl && item.imageUrl.startsWith('http')
      ? item.imageUrl
      : 'https://placehold.co/200x200/e5e7eb/6b7280?text=·';
  const placeLine = [item.neighborhood, item.city].filter(Boolean).join(', ');

  return (
    <Link
      href={`/(tabs)/restaurant/${encodeURIComponent(item.id)}?payload=${item.detailPayload}`}
      asChild
    >
      <TouchableOpacity style={styles.card} activeOpacity={0.88}>
        <Image source={{ uri }} style={styles.photo} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={2}>
              {item.name}
            </Text>
            {item.saved ? (
              <Ionicons name="bookmark" size={18} color={colors.accent} style={styles.bookmark} />
            ) : null}
          </View>
          {placeLine ? (
            <Text style={styles.place} numberOfLines={1}>
              {placeLine}
            </Text>
          ) : null}
          <View style={styles.tagPill}>
            <Text style={styles.tagText}>{item.tag}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  photo: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: colors.surfaceSoft,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 21,
  },
  bookmark: { marginTop: 2 },
  place: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  tagPill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
