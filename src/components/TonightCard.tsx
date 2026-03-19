import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { NEUTRAL_RESTAURANT_PLACEHOLDER_URI } from '../constants/restaurantMedia';

/** Neutral placeholder when no restaurant image is available (not food-specific). */
export const TONIGHT_CARD_PLACEHOLDER_URI = NEUTRAL_RESTAURANT_PLACEHOLDER_URI;

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
  /** One social proof badge: e.g. "3 friends saved this", "Trending tonight", "People like you loved this". */
  socialProofBadge?: string | null;
  /** Optional group consensus signal, e.g. \"3/4 liked this\". */
  groupSignal?: string | null;
}

export type SwipeIntent = 'left' | 'right' | 'up' | null;

interface Props {
  card: TonightCardModel;
  /** When true, show a saved indicator (e.g. user already saved this from Discover or restaurant page). */
  saved?: boolean;
  /** Current drag direction for subtle icon feedback before the large overlay appears. */
  swipeIntent?: SwipeIntent;
  /** Solo Tonight: pass + like / lock — rendered inside the card footer when both are set. */
  onOtherOptions?: () => void;
  onLockIn?: () => void;
  /** Hide in-card actions while the user is dragging (e.g. deck swiper). */
  hideActions?: boolean;
}

/** Use only if value is a real URL (https or absolute), not a photo_reference. */
function isUsableImageUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('http');
}

function formatPriceLevel(level?: number): string {
  if (level == null || level < 1) return '';
  return Array.from({ length: Math.min(4, level) }, () => '$').join('');
}

export function TonightCard({
  card,
  saved,
  swipeIntent,
  onOtherOptions,
  onLockIn,
  hideActions,
}: Props) {
  const { restaurant, matchScore, imageUrl, heroPhotoUrl, socialProofBadge, groupSignal } = card;
  const raw = imageUrl ?? heroPhotoUrl;
  const imageUri = isUsableImageUrl(raw) ? raw : TONIGHT_CARD_PLACEHOLDER_URI;
  const priceStr = formatPriceLevel(restaurant.priceLevel);
  const metaLine = [
    restaurant.cuisine,
    restaurant.neighborhood ? restaurant.neighborhood : null,
  ]
    .filter(Boolean)
    .join(' • ');
  /** Keep to 1–2 concise lines for a compact, decision-oriented card */
  const reasonBullets =
    card.reasonTags && card.reasonTags.length > 0
      ? card.reasonTags.slice(0, 2)
      : ['Matches your taste and tonight plans', 'Popular pick nearby'];

  const distanceText = card.reasonTags.find((r) => /\b(min|mins|mi|mile|miles)\b/i.test(r));
  const tags: string[] = [];
  if (socialProofBadge?.toLowerCase().includes('trending')) tags.push('Trending');
  if (groupSignal?.toLowerCase().includes('liked')) tags.push('Great for groups');
  if (card.reasonTags.some((r) => /group|share/i.test(r))) tags.push('Good for groups');
  if (card.reasonTags.some((r) => /popular|trending/i.test(r))) tags.push('Popular nearby');

  const showInCardActions = Boolean(onOtherOptions && onLockIn && !hideActions);

  return (
    <View style={styles.card}>
      {swipeIntent && (
        <View
          style={[
            styles.tintOverlay,
            swipeIntent === 'left' && styles.tintLeft,
            swipeIntent === 'right' && styles.tintRight,
            swipeIntent === 'up' && styles.tintUp,
          ]}
        />
      )}

      <View style={styles.imageWrap}>
        <Image source={{ uri: imageUri }} style={styles.image} />
        <View style={styles.topRow}>
          {saved && (
            <View style={styles.savedBadge}>
              <Ionicons name="bookmark" size={12} color="#fff" />
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.bodyScrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        nestedScrollEnabled
      >
        <Text style={styles.name} numberOfLines={2}>
          {restaurant.name}
        </Text>
        {metaLine || priceStr ? (
          <Text style={styles.meta} numberOfLines={2}>
            {[metaLine, priceStr].filter(Boolean).join(metaLine && priceStr ? ' · ' : '')}
          </Text>
        ) : null}

        <View style={styles.matchRow}>
          <View style={styles.matchPillInline}>
            <Text style={styles.matchTextInline}>{Math.round(matchScore * 100)}% match</Text>
          </View>
        </View>

        {socialProofBadge ? (
          <Text style={styles.socialProofBadge} numberOfLines={2}>
            {socialProofBadge}
          </Text>
        ) : null}

        <View style={styles.whySection}>
          <Text style={styles.whyTitle}>Why this works for you</Text>
          {reasonBullets.map((r, i) => (
            <View key={`${i}-${r.slice(0, 24)}`} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText} numberOfLines={2}>
                {r}
              </Text>
            </View>
          ))}
        </View>

        {distanceText || tags.length > 0 || groupSignal ? (
          <View style={styles.metaRow}>
            {distanceText ? <Text style={styles.metaBadge}>{distanceText}</Text> : null}
            {tags.map((tag) => (
              <Text key={tag} style={styles.metaBadge}>
                {tag}
              </Text>
            ))}
            {groupSignal ? <Text style={styles.metaBadge}>{groupSignal}</Text> : null}
          </View>
        ) : null}
      </ScrollView>

      {showInCardActions ? (
        <View style={styles.actionsFooter}>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnSecondary]}
              onPress={onOtherOptions}
              activeOpacity={0.85}
            >
              <Ionicons name="options-outline" size={17} color={colors.textMuted} />
              <Text style={styles.actionBtnTextSecondary}>Other options</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={onLockIn}
              activeOpacity={0.9}
            >
              <Ionicons name="checkmark-circle" size={17} color="#111827" />
              <Text style={styles.actionBtnTextPrimary}>Lock this in</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const HERO_HEIGHT = 132;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imageWrap: {
    height: HERO_HEIGHT,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  tintOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  tintLeft: {
    backgroundColor: 'rgba(248, 113, 113, 0.16)', // soft red
  },
  tintRight: {
    backgroundColor: 'rgba(251, 146, 60, 0.16)', // soft orange
  },
  tintUp: {
    backgroundColor: 'rgba(52, 211, 153, 0.16)', // soft teal/green
  },
  cardFallback: {
    backgroundColor: colors.surfaceSoft,
  },
  topRow: {
    position: 'absolute',
    top: 10,
    right: 10,
    alignItems: 'flex-end',
    zIndex: 1,
  },
  savedBadge: {
    alignSelf: 'flex-end',
    padding: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  bodyScrollContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    flexGrow: 1,
  },
  matchRow: {
    marginTop: 6,
  },
  matchPillInline: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
  },
  matchTextInline: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  socialProofBadge: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  name: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 24,
  },
  meta: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  whySection: {
    marginTop: 8,
    gap: 2,
  },
  whyTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    width: 14,
    marginTop: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.accent,
    fontWeight: '700',
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  actionsFooter: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: colors.surface,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.border,
  },
  actionBtnPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionBtnTextSecondary: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  actionBtnTextPrimary: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  metaBadge: {
    fontSize: 12,
    color: colors.textMuted,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});

