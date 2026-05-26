/**
 * SwipeCard — pure visual card for the Tonight swipe deck.
 * Layout: top 60% full-bleed photo, bottom 40% white card body.
 * A white gradient at the photo bottom blends seamlessly into the card body.
 */
import React from 'react';
import { Dimensions, Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { TonightCardModel, RecommendedDish } from './TonightCard';
import { RestaurantImage } from './RestaurantImage';

export const CARD_W = Dimensions.get('window').width - 16;
// Photo is sized to feel like a swipe-app hero (~42% of screen, capped at 360
// so it never feels oversized on tall phones). Card height is then computed
// as photo + a tight estimate of the body content — this keeps the white
// section wrapping the text instead of leaving a blank panel below.
const PHOTO_H = Math.min(360, Math.round(Dimensions.get('window').height * 0.42));
const BODY_H = 196;
export const CARD_H = PHOTO_H + BODY_H;

// ─── Palette (warm peach — matches rest of app) ───────────────────────────────
export const TN = {
  bg: '#FFF7ED',
  card: '#FFFFFF',
  accent: '#FF6B35',
  nope: '#FF3B30',
  craving: '#FFD700',
  text: '#1C1C1E',
  textMuted: '#6B7280',
  textWarm: '#8A7060',
  border: '#E5E7EB',
  pillBg: 'rgba(0,0,0,0.38)',
  pillBorder: 'rgba(255,255,255,0.25)',
  shadow: 'rgba(180,120,80,0.13)',
  like: '#34C759',
};

// ─── Friend avatar strip ──────────────────────────────────────────────────────

function FriendAvatars({ uris }: { uris: string[] }) {
  const visible = uris.slice(0, 4);
  if (!visible.length) return null;
  return (
    <View style={fa.row} accessibilityLabel={`${visible.length} friends liked this`}>
      {visible.map((uri, i) => (
        <View key={uri + i} style={[fa.ring, { marginLeft: i === 0 ? 0 : -9 }]}>
          <Image source={{ uri }} style={fa.img} />
        </View>
      ))}
      {uris.length > 4 && (
        <View style={[fa.ring, fa.overflow, { marginLeft: -9 }]}>
          <Text style={fa.overflowText}>+{uris.length - 4}</Text>
        </View>
      )}
    </View>
  );
}

const fa = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  ring: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: TN.border,
    overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  overflow: {
    backgroundColor: TN.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: { fontSize: 9, fontWeight: '800', color: '#fff' },
});

// ─── Reason label helper ─────────────────────────────────────────────────────

// Short recommendation line under the restaurant name. Prefers a real social
// signal (friends, trending, taste match); falls back to a generic "Great pick
// tonight" so the line in the hierarchy never collapses unexpectedly.
function getReasonLabel(card: TonightCardModel): string {
  const { socialProofBadge, reasonTags } = card;
  if (socialProofBadge?.toLowerCase().includes('friend'))
    return '\u{1F46F} Friends liked this';
  if (socialProofBadge?.toLowerCase().includes('trending'))
    return '\u{1F525} Trending near you';
  if (socialProofBadge?.toLowerCase().includes('taste') || socialProofBadge?.toLowerCase().includes('like you'))
    return '\u2728 Based on your taste';
  if (reasonTags?.some((r) => /friend/i.test(r)))
    return '\u{1F46F} Friends liked this';
  if (reasonTags?.some((r) => /popular|trending/i.test(r)))
    return '\u{1F525} Trending near you';
  if (reasonTags?.some((r) => /taste|match/i.test(r)))
    return '\u2728 Based on your taste';
  return '\u2728 Great pick tonight';
}

// ─── Decision-helper: category-aware "Why this works" copy ─────────────────
// One short sentence, tuned to the restaurant category so we don't say
// "solid dinner" about a bakery.

function getWhyThisWorks(cuisine: string, priceLevel?: number, distanceMi?: number | null): string {
  const c = (cuisine || '').toLowerCase();
  const price = priceLevel ?? 2;
  const walkable = distanceMi != null && distanceMi <= 0.5;
  const close = distanceMi != null && distanceMi <= 1.5;

  // Dessert / bakery / sweet — no "dinner" language
  if (/bakery|patisserie|p[âa]tisserie|donut|doughnut|ice cream|gelato|cookie|cake|dessert|chocolate|sweets|boba/.test(c)) {
    if (walkable) return 'Easy walk, sweet treat for tonight.';
    if (close) return 'Close by — great dessert stop.';
    return 'A craveable dessert pick.';
  }

  // Coffee / café
  if (/coffee|cafe|caf[eé]|espresso|tea house/.test(c)) {
    if (walkable) return 'Cozy café, low-effort and close.';
    return 'Easy café meet-up.';
  }

  // Bar / cocktails / wine
  if (/bar|cocktail|wine|brewery|pub|tavern/.test(c)) {
    if (price >= 3) return 'Refined drinks, lively vibe.';
    return 'Easy drinks spot tonight.';
  }

  // Upscale / fine dining
  if (price >= 4) {
    if (/steak|french|omakase|seafood/.test(c)) return 'Special occasion, upscale night out.';
    return 'Celebration-worthy dinner.';
  }
  if (price >= 3) {
    if (/sushi|japanese/.test(c)) return 'Date night, refined sushi pick.';
    if (/italian|french/.test(c)) return 'Cozy date night.';
    if (/steak/.test(c)) return 'Classic steakhouse, great for a group.';
    if (/seafood/.test(c)) return 'Fresh catch, special dinner.';
    return 'Nice dinner out.';
  }

  // Casual / inexpensive
  if (price <= 1) {
    if (walkable && /burger|pizza|taco|mexican/.test(c)) return 'Quick walk, casual bite.';
    if (/burger|pizza|taco|mexican/.test(c)) return 'Casual hangout, quick bite.';
    if (walkable) return 'Easy walk, low-key night.';
    return 'Casual, low-key tonight.';
  }

  // Mid-range cuisines
  if (/bbq/.test(c)) return 'Lively group dinner.';
  if (/korean/.test(c)) return 'Fun shareable plates.';
  if (/thai|indian|chinese|vietnamese/.test(c)) return 'Flavorful weeknight pick.';
  if (/burger|american/.test(c)) return 'Casual dinner with friends.';
  if (/pizza/.test(c)) return 'Easy group dinner.';
  if (/mexican|taco/.test(c)) return 'Lively spot, great margaritas.';
  if (/mediterranean|greek/.test(c)) return 'Bright, relaxed vibe.';
  if (/ramen|noodle|udon|pho/.test(c)) return 'Comforting bowl tonight.';

  if (walkable) return 'Easy walk, solid pick.';
  if (close) return 'Close by, easy choice.';
  return 'Great pick tonight.';
}

function formatDistance(mi?: number | null): string {
  if (mi == null) return '';
  if (mi < 0.1) return 'Steps away';
  if (mi < 1) return `${mi.toFixed(1)} mi away`;
  return `${mi.toFixed(1)} mi`;
}

function walkMinutes(mi?: number | null): string {
  if (mi == null || mi > 1.5) return '';
  const mins = Math.max(1, Math.round(mi * 20));
  return `~${mins} min walk`;
}

// ─── Dish emoji helper ───────────────────────────────────────────────────────

function getDishEmoji(name: string): string {
  const n = name.toLowerCase();
  if (/sushi|nigiri|sashimi|roll|maki/.test(n)) return '\u{1F363}';
  if (/ramen|noodle|udon|soba|pho/.test(n)) return '\u{1F35C}';
  if (/taco|burrito|enchilada|quesadilla/.test(n)) return '\u{1F32E}';
  if (/pizza|margherita/.test(n)) return '\u{1F355}';
  if (/burger|smash/.test(n)) return '\u{1F354}';
  if (/steak|ribeye|wagyu|filet/.test(n)) return '\u{1F969}';
  if (/chicken|wing/.test(n)) return '\u{1F357}';
  if (/lobster|crab|oyster|shrimp|seafood/.test(n)) return '\u{1F99E}';
  if (/salmon|fish/.test(n)) return '\u{1F41F}';
  if (/pasta|cacio|spaghetti|penne|rigatoni/.test(n)) return '\u{1F35D}';
  if (/soup|broth|bisque|chowder|tom yum|jjigae/.test(n)) return '\u{1F372}';
  if (/salad|wedge/.test(n)) return '\u{1F957}';
  if (/curry|biryani|tikka/.test(n)) return '\u{1F35B}';
  if (/dumpling|bao|xiao long/.test(n)) return '\u{1F95F}';
  if (/bread|naan|pita|focaccia/.test(n)) return '\u{1F35E}';
  if (/dessert|cr[eè]me|cake|ice cream|gelato/.test(n)) return '\u{1F370}';
  if (/bbq|brisket|ribs|pulled|burnt end|smoked/.test(n)) return '\u{1F356}';
  if (/mac.*cheese|spinach|fries/.test(n)) return '\u{1F37D}\uFE0F';
  return '\u{1F374}';
}

// ─── SwipeCard ────────────────────────────────────────────────────────────────

export interface SwipeCardProps {
  card: TonightCardModel;
  isSaved?: boolean;
  friendAvatars?: string[];
}

export function SwipeCard({ card, isSaved, friendAvatars }: SwipeCardProps) {
  const { restaurant, matchScore, rating, imageUrl, heroPhotoUrl, distanceMi, whyLine, fallbackNote } = card;

  const metaParts = [restaurant.cuisine, restaurant.neighborhood].filter(Boolean);
  const priceStr = restaurant.priceLevel
    ? Array.from({ length: Math.min(4, restaurant.priceLevel) }, () => '$').join('')
    : '';

  const reasonLabel = getReasonLabel(card);
  const dishes = (card.recommendedDishes ?? []).slice(0, 2);
  const scorePercent = Math.round(matchScore * 100);
  const hasMatch = scorePercent > 0;
  const ratingStr = rating != null && rating > 0 ? rating.toFixed(1) : '';
  const distanceStr = formatDistance(distanceMi);
  const walkStr = walkMinutes(distanceMi);
  const whyThisWorks = getWhyThisWorks(restaurant.cuisine, restaurant.priceLevel, distanceMi);

  return (
    <View style={s.card}>
      {/* ── Photo section ────────────────────────────────────────────── */}
      <View style={s.photoWrap}>
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
          aspectRatio={CARD_W / PHOTO_H}
          fallbackType="icon"
          borderRadius={0}
          style={s.photo}
        />

        {/* White gradient — fades photo into the white card body below */}
        <LinearGradient
          colors={[
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0.55)',
            'rgba(255,255,255,1)',
          ]}
          locations={[0, 0.4, 0.78, 1]}
          style={s.photoGradient}
        />

        {/* Saved badge */}
        {isSaved && (
          <View style={s.savedBadge} accessibilityLabel="Already saved">
            <Ionicons name="bookmark" size={13} color={TN.accent} />
          </View>
        )}

        {/* Friend avatars — bottom-right of photo */}
        {!!friendAvatars?.length && (
          <View style={s.friendWrap}>
            <FriendAvatars uris={friendAvatars} />
          </View>
        )}

        {/* Cuisine / neighborhood / price / open-now pills — over lower photo */}
        <View style={s.pillsRow}>
          {card.isOpenNow === true && (
            <View style={[s.pill, s.openPill]}>
              <Text style={s.openPillText}>Open now</Text>
            </View>
          )}
          {metaParts.map((p) => (
            <View key={p} style={s.pill}>
              <Text style={s.pillText}>{p}</Text>
            </View>
          ))}
          {priceStr ? (
            <View style={s.pill}>
              <Text style={s.pillText}>{priceStr}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ── Card body ────────────────────────────────────────────────── */}
      <View style={s.body}>
        <Text style={s.name} numberOfLines={2}>{restaurant.name}</Text>

        {/* Reason label */}
        {reasonLabel ? (
          <Text style={s.reasonLabel} numberOfLines={1}>{reasonLabel}</Text>
        ) : null}

        {/* BiteScore / rating badge */}
        <View style={s.scoreRow}>
          {hasMatch ? (
            <View style={s.scoreBadge}>
              <Text style={s.scoreText}>{'\u{1F525}'} {scorePercent}% BiteScore</Text>
            </View>
          ) : ratingStr ? (
            <View style={s.scoreBadge}>
              <Text style={s.scoreText}>{'\u2B50'} {ratingStr} rating</Text>
            </View>
          ) : null}
          {hasMatch && ratingStr ? (
            <View style={s.metaInline}>
              <Ionicons name="star" size={12} color="#F5A623" />
              <Text style={s.metaInlineText}>{ratingStr}</Text>
            </View>
          ) : null}
          {distanceStr ? (
            <View style={s.metaInline}>
              <Ionicons name="location-outline" size={12} color={TN.textMuted} />
              <Text style={s.metaInlineText}>{distanceStr}</Text>
            </View>
          ) : null}
          {walkStr ? (
            <View style={s.metaInline}>
              <Ionicons name="walk-outline" size={12} color={TN.textMuted} />
              <Text style={s.metaInlineText}>{walkStr}</Text>
            </View>
          ) : null}
        </View>

        {/* Popular dishes — emoji chips */}
        {dishes.length > 0 ? (
          <View style={s.dishesWrap}>
            <Text style={s.dishesLabel}>Must-try</Text>
            <View style={s.dishChipsRow}>
              {dishes.map((dish, i) => (
                <View key={i} style={s.dishChip}>
                  <Text style={s.dishChipEmoji}>{getDishEmoji(dish.name)}</Text>
                  <Text style={s.dishChipText} numberOfLines={1}>{dish.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Why this works — one sentence. Prefer backend's personalized
            whyLine if present; otherwise use the category-aware sentence. */}
        <View style={s.bestForWrap}>
          <View style={s.bestForBadge}>
            <Text style={s.bestForBadgeText}>WHY THIS WORKS</Text>
          </View>
          <Text style={s.bestForText} numberOfLines={2}>{fallbackNote ?? whyLine ?? whyThisWorks}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    backgroundColor: TN.card,
    overflow: 'hidden',
    shadowColor: 'rgba(180,120,80,0.12)',
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  photoWrap: {
    height: PHOTO_H,
    overflow: 'hidden',
    backgroundColor: '#f0e8e0',
  },
  photo: {
    ...StyleSheet.absoluteFillObject,
  },
  photoGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: PHOTO_H * 0.55,
  },
  savedBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  friendWrap: {
    position: 'absolute',
    bottom: 46,
    right: 14,
  },
  pillsRow: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  pillText: { fontSize: 11, fontWeight: '600', color: TN.text },
  openPill: {
    backgroundColor: 'rgba(52,199,89,0.18)',
    borderColor: 'rgba(52,199,89,0.5)',
  },
  openPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1B873B',
  },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: TN.card,
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    color: TN.text,
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  // Reason label
  reasonLabel: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: TN.textWarm,
    lineHeight: 16,
  },
  // BiteScore row (badge + inline rating/distance/walk)
  scoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
    marginTop: 6,
  },
  metaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaInlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: TN.textMuted,
  },
  scoreBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: TN.accent,
    shadowColor: TN.accent,
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  scoreText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
  },
  // Dishes
  dishesWrap: {
    marginTop: 9,
  },
  dishesLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: TN.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 5,
  },
  dishChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dishChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFF5EE',
    borderWidth: 1,
    borderColor: '#F0DDD0',
  },
  dishChipEmoji: {
    fontSize: 12,
  },
  dishChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: TN.text,
    maxWidth: 140,
  },
  // Best-for decision helper
  bestForWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 7,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TN.border,
  },
  bestForBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: TN.accent,
  },
  bestForBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.6,
  },
  bestForText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: TN.textMuted,
    lineHeight: 16,
  },
});
