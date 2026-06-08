/**
 * Shared eats-tile components used by both the own-profile screen
 * (app/(tabs)/profile/index.tsx) and the friend-profile screen
 * (app/friend/[id].tsx). Centralized here so a friend's tiles render
 * with byte-for-byte the same layout as the user's own — previously the
 * friend screen had a parallel inline implementation that drifted in
 * subtle ways (score-pill font size, no grid view, no visit grouping).
 */
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RestaurantImage } from './RestaurantImage';
import { colors } from '../theme/colors';

const { width: SW } = Dimensions.get('window');
const GRID_GAP = 12;
const GRID_PADDING = 18;
export const GRID_CARD_W = (SW - GRID_PADDING * 2 - GRID_GAP) / 2;

export type VisitGroup = {
  restaurantId: string;
  restaurantName: string;
  bestScore: number;
  previewPhotoUrl?: string;
  visitCount: number;
  cuisine?: string;
  neighborhood?: string;
  note?: string;
};

export function EatsCard({ group, onPress }: { group: VisitGroup; onPress: () => void }) {
  return (
    <TouchableOpacity style={eats.card} onPress={onPress} activeOpacity={0.88}>
      <RestaurantImage
        restaurant={{
          id: group.restaurantId,
          name: group.restaurantName,
        }}
        aspectRatio={GRID_CARD_W / 120}
        fallbackType="icon"
        borderRadius={0}
        style={eats.photo}
      />
      <View style={eats.scoreBadge}>
        <Text style={eats.scoreText}>{group.bestScore.toFixed(1)}</Text>
      </View>
      <View style={eats.info}>
        <Text style={eats.name} numberOfLines={2}>{group.restaurantName}</Text>
        {group.visitCount > 1 && (
          <Text style={eats.visits}>{group.visitCount} visits</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function EatsListRow({ group, onPress }: { group: VisitGroup; onPress: () => void }) {
  const meta = [group.cuisine, group.neighborhood].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity style={elist.row} onPress={onPress} activeOpacity={0.8}>
      <View style={elist.thumbWrap}>
        <RestaurantImage
          restaurant={{ id: group.restaurantId, name: group.restaurantName }}
          aspectRatio={1}
          fallbackType="icon"
          borderRadius={12}
          style={elist.thumb}
        />
      </View>
      <View style={elist.info}>
        <Text style={elist.name} numberOfLines={1}>{group.restaurantName}</Text>
        {meta ? <Text style={elist.meta} numberOfLines={1}>{meta}</Text> : null}
        {group.note ? <Text style={elist.note} numberOfLines={1}>{group.note}</Text> : null}
        {group.visitCount > 1 ? (
          <Text style={elist.visits}>{group.visitCount} visits</Text>
        ) : null}
      </View>
      <View style={[elist.scorePill, group.bestScore >= 8.0 && elist.scorePillHigh]}>
        <Text style={[elist.scoreText, group.bestScore >= 8.0 && elist.scoreTextHigh]}>
          {group.bestScore.toFixed(1)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const elist = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  thumbWrap: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden' },
  thumb: { width: 48, height: 48 },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  meta: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  note: { fontSize: 12, fontWeight: '500', color: colors.textFaint, fontStyle: 'italic', marginTop: 2 },
  visits: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '500' },
  scorePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  scorePillHigh: { backgroundColor: colors.accent },
  scoreText: { fontSize: 14, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  scoreTextHigh: { color: '#fff' },
});

const eats = StyleSheet.create({
  card: {
    width: GRID_CARD_W,
    borderRadius: 16,
    backgroundColor: '#fff',
    overflow: 'hidden',
    shadowColor: 'rgba(180,120,80,0.12)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  photo: { width: '100%', height: 120 },
  scoreBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  scoreText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  info: { padding: 10, paddingTop: 8 },
  name: { fontSize: 13, fontWeight: '700', color: colors.text, lineHeight: 18 },
  visits: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '500' },
});
