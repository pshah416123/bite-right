import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { RestaurantImage } from './RestaurantImage';

export interface RecommendedDish {
  name: string;
  price?: string | null;
  description?: string | null;
}

export interface TonightCardModel {
  restaurant: {
    id: string;
    name: string;
    cuisine: string;
    neighborhood?: string;
    priceLevel?: number;
    googlePlaceId?: string | null;
    displayImageUrl?: string | null;
    displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
    displayImageLastResolvedAt?: string | null;
  };
  matchScore: number;
  /** Google Places rating (1–5). Used as fallback when matchScore is 0. */
  rating?: number | null;
  imageUrl?: string;
  /** @deprecated Use imageUrl. */
  heroPhotoUrl?: string;
  reasonTags: string[];
  socialProofBadge?: string | null;
  groupSignal?: string | null;
  distanceMi?: number | null;
  whyLine?: string | null;
  /** Surfaced on the card when the cuisine filter was relaxed and this card
   *  is being shown as a substitution (e.g. "No ramen nearby — japanese pick"). */
  fallbackNote?: string | null;
  recommendedDishes?: RecommendedDish[] | null;
  isOpenNow?: boolean | null;
}

export type SwipeIntent = 'left' | 'right' | 'up' | null;

interface Props {
  card: TonightCardModel;
  saved?: boolean;
  swipeIntent?: SwipeIntent;
  onOtherOptions?: () => void;
  onLockIn?: () => void;
  hideActions?: boolean;
  groupMode?: boolean;
}

function formatPriceLevel(level?: number): string {
  if (level == null || level < 1) return '';
  return Array.from({ length: Math.min(4, level) }, () => '$').join('');
}

function formatDistance(mi?: number | null): string {
  if (mi == null) return '';
  if (mi < 0.1) return 'Nearby';
  return `${mi.toFixed(1)} mi`;
}

function formatRating(rating?: number | null): string {
  if (rating == null || rating <= 0) return '';
  return rating.toFixed(1);
}

// ─── Cuisine emoji map ──────────────────────────────────────────────────────

function getCuisineEmoji(cuisine: string): string {
  const c = (cuisine || '').toLowerCase();
  if (/sushi|japanese/.test(c)) return '\u{1F363}';
  if (/italian|pasta/.test(c)) return '\u{1F35D}';
  if (/mexican|taco/.test(c)) return '\u{1F32E}';
  if (/chinese/.test(c)) return '\u{1F961}';
  if (/indian/.test(c)) return '\u{1F35B}';
  if (/thai/.test(c)) return '\u{1F35C}';
  if (/korean/.test(c)) return '\u{1F372}';
  if (/pizza/.test(c)) return '\u{1F355}';
  if (/burger/.test(c)) return '\u{1F354}';
  if (/seafood|fish/.test(c)) return '\u{1F99E}';
  if (/steak/.test(c)) return '\u{1F969}';
  if (/bbq/.test(c)) return '\u{1F356}';
  if (/french/.test(c)) return '\u{1F950}';
  if (/mediterranean|greek/.test(c)) return '\u{1F957}';
  return '\u{1F37D}\uFE0F';
}

// ─── Social proof label (only show when there's a real signal) ───────────────

function getReasonLabel(card: TonightCardModel): string | null {
  const badge = card.socialProofBadge?.toLowerCase() ?? '';
  const tags = card.reasonTags ?? [];
  if (badge.includes('friend') || tags.some((r) => /friend/i.test(r)))
    return '\u{1F46F} Friends loved this';
  if (badge.includes('trending') || tags.some((r) => /trending|popular/i.test(r)))
    return '\u{1F525} Trending nearby';
  if (badge.includes('taste') || badge.includes('like you') || tags.some((r) => /taste|match/i.test(r)))
    return '\u2728 Matches your taste';
  return null;
}

// ─── Filter out generic placeholder dishes ──────────────────────────────────

const GENERIC_DISHES = new Set([
  "chef's special",
  'seasonal plate',
  'shareable appetizer',
  'house special',
  'daily special',
]);

function isRealDish(name: string): boolean {
  return !GENERIC_DISHES.has(name.toLowerCase().trim());
}

// ─── Best-for line (contextual based on cuisine, price, distance) ───────────

function getBestForLine(cuisine: string, priceLevel?: number, distanceMi?: number | null): string {
  const c = (cuisine || '').toLowerCase();
  const price = priceLevel ?? 2;
  const isWalkable = distanceMi != null && distanceMi <= 0.5;

  if (price <= 1) {
    if (isWalkable && /burger|pizza|taco|mexican/.test(c)) return 'Quick walk for a casual bite';
    if (/burger|pizza|taco|mexican/.test(c)) return 'Casual hangout, quick bite';
    if (isWalkable) return 'Easy walk for a low-key dinner';
    return 'Casual dinner, low-key night';
  }
  if (price >= 4) {
    if (/steak|french|seafood/.test(c)) return 'Special occasion, upscale dining';
    return 'Celebration-worthy, fine dining';
  }
  if (price >= 3) {
    if (/sushi|japanese/.test(c)) return 'Date night, refined experience';
    if (/steak/.test(c)) return 'Classic steakhouse, great for groups';
    if (/italian|french/.test(c)) return 'Cozy date night';
    if (/seafood/.test(c)) return 'Fresh catch, special dinner';
    return 'Nice dinner out';
  }
  if (/bbq/.test(c)) return 'Lively group dinner';
  if (/korean/.test(c)) return 'Fun group dinner, shareable plates';
  if (/thai|indian|chinese/.test(c)) return 'Flavorful weeknight dinner';
  if (/burger|american/.test(c)) return 'Casual dinner with friends';
  if (/pizza/.test(c)) return 'Casual group dinner';
  if (/mexican|taco/.test(c)) return 'Lively spot, great margaritas';
  if (/mediterranean|greek/.test(c)) return 'Bright, relaxed vibe';
  if (isWalkable) return 'Easy walk, solid dinner';
  return 'Solid dinner tonight';
}

export function TonightCard({
  card,
  saved,
  swipeIntent,
  onOtherOptions,
  onLockIn,
  hideActions,
  groupMode,
}: Props) {
  const { restaurant, matchScore, rating, imageUrl, heroPhotoUrl, distanceMi } = card;
  const priceStr = formatPriceLevel(restaurant.priceLevel);
  const scorePercent = Math.round(matchScore * 100);
  const ratingStr = formatRating(rating);
  const distStr = formatDistance(distanceMi);

  // Determine image pill: prefer match %, fall back to rating
  const showMatchPill = scorePercent > 0;
  const showRatingPill = !showMatchPill && !!ratingStr;

  // Filter out generic placeholder dishes, take up to 2
  const realDishes = (card.recommendedDishes ?? []).filter((d) => isRealDish(d.name));
  const dishes = realDishes.slice(0, 2);

  const reasonLabel = getReasonLabel(card);
  const bestFor = getBestForLine(restaurant.cuisine, restaurant.priceLevel, distanceMi);

  const showInCardActions = Boolean(onOtherOptions && onLockIn && !hideActions);

  // Clean meta: $ · Cuisine · distance · Open (no address/neighborhood)
  const metaParts = [priceStr, restaurant.cuisine, distStr].filter(Boolean);

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
        <RestaurantImage
          restaurant={{
            id: restaurant.id,
            name: restaurant.name,
            cuisine: restaurant.cuisine,
            googlePlaceId: restaurant.googlePlaceId ?? null,
            displayImageUrl: restaurant.displayImageUrl ?? imageUrl ?? heroPhotoUrl ?? null,
            displayImageSourceType: restaurant.displayImageSourceType ?? null,
            displayImageLastResolvedAt: restaurant.displayImageLastResolvedAt ?? null,
            imageUrl: imageUrl ?? null,
            previewPhotoUrl: heroPhotoUrl ?? null,
          }}
          fallbackType="icon"
          borderRadius={0}
          style={styles.image}
        />
        {/* Signal pill — top-right: match % or rating */}
        {showMatchPill && (
          <View style={styles.matchPillImage}>
            <Text style={styles.matchPillImageText}>{'\u{1F525}'} {scorePercent}% match</Text>
          </View>
        )}
        {showRatingPill && (
          <View style={styles.ratingPillImage}>
            <Ionicons name="star" size={11} color="#FFD700" />
            <Text style={styles.ratingPillImageText}>{ratingStr}</Text>
          </View>
        )}
        {/* Saved badge */}
        {saved && (
          <View style={styles.savedBadge}>
            <Ionicons name="bookmark" size={12} color="#fff" />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>{restaurant.name}</Text>

        {/* Meta row: $$ · Cuisine · distance · Open */}
        <View style={styles.metaRow}>
          <Text style={styles.metaText} numberOfLines={1}>
            {metaParts.join(' \u00B7 ')}
          </Text>
          {card.isOpenNow === true && (
            <View style={styles.openInline}>
              <View style={styles.openDot} />
              <Text style={styles.openText}>Open</Text>
            </View>
          )}
        </View>

        {/* Social proof (only if real signal exists) */}
        {reasonLabel && (
          <Text style={styles.reasonLabel} numberOfLines={1}>{reasonLabel}</Text>
        )}

        {/* Must-try dishes */}
        {dishes.length > 0 && (
          <View style={styles.dishesSection}>
            <Text style={styles.dishesTitle}>Must-try</Text>
            <View style={styles.dishChipsRow}>
              {dishes.map((dish, i) => (
                <View key={i} style={styles.dishChip}>
                  <Text style={styles.dishChipText} numberOfLines={1}>{dish.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Best-for line */}
        <Text style={styles.decisionLine} numberOfLines={1}>Best for: {bestFor}</Text>
      </View>

      {showInCardActions && (
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    marginHorizontal: 0,
    borderWidth: 0,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  tintOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 5,
  },
  tintLeft: { backgroundColor: 'rgba(255, 59, 48, 0.14)' },
  tintRight: { backgroundColor: 'rgba(52, 199, 89, 0.14)' },
  tintUp: { backgroundColor: 'rgba(255, 215, 0, 0.14)' },

  // ── Image ──
  imageWrap: {
    height: 220,
    flexShrink: 0,
    backgroundColor: colors.surfaceSoft,
  },
  image: { ...StyleSheet.absoluteFillObject },
  matchPillImage: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  matchPillImageText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  ratingPillImage: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  ratingPillImageText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  savedBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    padding: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // ── Body ──
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 25,
    letterSpacing: -0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  metaText: {
    fontSize: 13,
    color: colors.textMuted,
    flexShrink: 1,
  },
  openInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  openDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  openText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1B873B',
  },
  // ── Reason ──
  reasonLabel: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#8A7060',
    lineHeight: 18,
  },

  // ── Dishes ──
  dishesSection: {
    marginTop: 8,
  },
  dishesTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  dishChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dishChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFF5EE',
    borderWidth: 1,
    borderColor: '#F0DDD0',
  },
  dishChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },

  // ── Decision helper ──
  decisionLine: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 16,
  },

  // ── Actions footer ──
  actionsFooter: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
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
    paddingVertical: 10,
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
});
