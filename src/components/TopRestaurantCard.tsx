import { StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { colors } from '../theme/colors';
import type { TopRestaurant } from '../types/profile';

interface Props {
  restaurant: TopRestaurant;
  rank?: number;
}

export function TopRestaurantCard({ restaurant, rank }: Props) {
  return (
    <Link href={`/restaurant/${restaurant.id}`} asChild>
      <View style={styles.card}>
        {rank != null && (
          <View style={styles.rank}>
            <Text style={styles.rankText}>{rank}</Text>
          </View>
        )}
        <View style={styles.meta}>
          <Text style={styles.name}>{restaurant.name}</Text>
          <Text style={styles.secondary}>
            {restaurant.cuisine} · {restaurant.neighborhood}
          </Text>
        </View>
        <View style={styles.scorePill}>
          <Text style={styles.scoreText}>{restaurant.yourScore.toFixed(1)}</Text>
        </View>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
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
  scorePill: {
    minWidth: 40,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
});
