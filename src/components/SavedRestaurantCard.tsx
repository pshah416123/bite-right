import { StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { colors } from '../theme/colors';
import { RESTAURANT_TYPE_LABELS } from '../types/profile';
import type { SavedRestaurant } from '../types/profile';

interface Props {
  restaurant: SavedRestaurant;
}

export function SavedRestaurantCard({ restaurant }: Props) {
  const typeLabel = restaurant.type ? RESTAURANT_TYPE_LABELS[restaurant.type] : null;
  const secondary = [restaurant.cuisine, restaurant.neighborhood].filter(Boolean).join(' · ') || restaurant.neighborhood;
  return (
    <Link href={`/restaurant/${restaurant.id}`} asChild>
      <View style={styles.card}>
        <View style={styles.meta}>
          <Text style={styles.name}>{restaurant.name}</Text>
          <Text style={styles.secondary}>{secondary}</Text>
          {(typeLabel || (restaurant.priceLevel != null && restaurant.priceLevel > 0)) && (
            <View style={styles.typeRow}>
              {typeLabel && (
                <View style={styles.typePill}>
                  <Text style={styles.typeText}>{typeLabel}</Text>
                </View>
              )}
              {restaurant.priceLevel != null && restaurant.priceLevel > 0 && (
                <Text style={styles.price}>
                  {Array.from({ length: restaurant.priceLevel }).map(() => '$').join('')}
                </Text>
              )}
            </View>
          )}
        </View>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meta: {
    flex: 1,
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
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  price: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
