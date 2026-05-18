/**
 * QuickTipsBlock — Displays structured quick tips from visitors on the restaurant detail page.
 * Shows order tips and best-time-to-go as compact, scannable rows.
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useFeedContext } from '../context/FeedContext';
import { useMemo } from 'react';

interface Tip {
  userName: string;
  quickTip?: string | null;
  bestTime?: string | null;
}

export function QuickTipsBlock({ restaurantId }: { restaurantId: string }) {
  const { items } = useFeedContext();

  const tips = useMemo(() => {
    const result: Tip[] = [];
    const seen = new Set<string>();

    for (const log of items) {
      if (log.restaurantId !== restaurantId) continue;
      if (!log.quickTip && !log.bestTime) continue;
      if (seen.has(log.userName)) continue;
      seen.add(log.userName);
      result.push({
        userName: log.userName,
        quickTip: log.quickTip,
        bestTime: log.bestTime,
      });
    }

    return result.slice(0, 4);
  }, [items, restaurantId]);

  // Aggregate best times for a summary
  const bestTimes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tips) {
      if (t.bestTime) counts.set(t.bestTime, (counts.get(t.bestTime) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([time]) => time);
  }, [tips]);

  if (tips.length === 0) return null;

  const orderTips = tips.filter((t) => t.quickTip);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Tips from visitors</Text>

      {/* Order tips */}
      {orderTips.map((t, i) => (
        <View key={i} style={s.tipRow}>
          <Text style={s.tipIcon}>{'\u{1F4A1}'}</Text>
          <View style={s.tipBody}>
            <Text style={s.tipText} numberOfLines={2}>{t.quickTip}</Text>
            <Text style={s.tipAuthor}>{t.userName === 'You' ? 'You' : t.userName}</Text>
          </View>
        </View>
      ))}

      {/* Best time summary */}
      {bestTimes.length > 0 && (
        <View style={s.bestTimeRow}>
          <Text style={s.bestTimeIcon}>{'\u{1F552}'}</Text>
          <Text style={s.bestTimeText}>
            Best for: {bestTimes.join(' or ')}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: 20,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipIcon: {
    fontSize: 14,
    marginTop: 1,
  },
  tipBody: {
    flex: 1,
  },
  tipText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 18,
  },
  tipAuthor: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
    color: colors.textFaint,
  },
  bestTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
  },
  bestTimeIcon: {
    fontSize: 13,
  },
  bestTimeText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.accent,
  },
});
