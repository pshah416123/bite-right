/**
 * CompareSheet — Side-by-side restaurant comparison that highlights differences.
 *
 * Design principles:
 * - Lead with what's DIFFERENT, not what's the same
 * - Each card gets a unique positioning hook (never identical copy)
 * - Decision nudge at the top when one restaurant clearly wins
 * - Factors highlight the winner in each category
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCompare, type CompareRestaurant } from '../context/CompareContext';
import { colors } from '../theme/colors';
import { getRestaurantDetail, type RestaurantDetail } from '../api/restaurants';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_H * 0.82;
const COLUMN_W = Math.floor((SCREEN_W - 50) / 2);
const COLUMN_H = SHEET_HEIGHT - 130;

// ── Comparative hook generation ─────────────────────────────────────────────
// The key insight: hooks must differentiate, never duplicate.
// Each restaurant gets positioned RELATIVE to the other.

interface CompareSignals {
  isCheaper: boolean;
  isPricier: boolean;
  isCloser: boolean;
  isFarther: boolean;
  hasBetterMatch: boolean;
  hasMoreFriends: boolean;
  hasStandoutDish: boolean;
  hasBetterScore: boolean;
}

function computeSignals(
  r: CompareRestaurant,
  others: CompareRestaurant[],
): CompareSignals {
  const price = r.priceLevel ?? 0;
  const otherPrices = others.map((o) => o.priceLevel ?? 0);
  const dist = r.distanceLabel ? parseFloat(r.distanceLabel) : Infinity;
  const otherDists = others.map((o) => o.distanceLabel ? parseFloat(o.distanceLabel) : Infinity);
  const match = r.matchScore ?? 0;
  const otherMatches = others.map((o) => o.matchScore ?? 0);
  const friends = r.friendCount ?? 0;
  const otherFriends = others.map((o) => o.friendCount ?? 0);
  const score = r.score ?? 0;
  const otherScores = others.map((o) => o.score ?? 0);

  return {
    isCheaper: price > 0 && otherPrices.some((p) => price < p),
    isPricier: price > 0 && otherPrices.some((p) => price > p),
    isCloser: dist < Infinity && otherDists.some((d) => dist < d),
    isFarther: dist < Infinity && otherDists.some((d) => dist > d),
    hasBetterMatch: match > 0 && otherMatches.every((m) => match > m),
    hasMoreFriends: friends > 0 && otherFriends.every((f) => friends > f),
    hasStandoutDish: !!(r.standoutDish || (r.dishes && r.dishes.length > 0)),
    hasBetterScore: score > 0 && otherScores.every((s) => score > s),
  };
}

function generateHook(
  r: CompareRestaurant,
  others: CompareRestaurant[],
  signals: CompareSignals,
): string {
  const vibes = new Set(r.vibeTags ?? []);
  const otherVibes = new Set(others.flatMap((o) => o.vibeTags ?? []));

  // 1. Vibe-based (most personal, unique between restaurants)
  if (vibes.has('date_night') && !otherVibes.has('date_night')) return 'Better for date night';
  if (vibes.has('celebration') && !otherVibes.has('celebration')) return 'The celebration pick';
  if (vibes.has('group') && !otherVibes.has('group')) return signals.isCheaper ? 'Easier group pick' : 'Best for the crew';
  if (vibes.has('quick_bite') && !otherVibes.has('quick_bite')) return 'Quick and easy';
  if (vibes.has('cozy') && !otherVibes.has('cozy')) return 'The cozy one';
  if (vibes.has('trendy') && !otherVibes.has('trendy')) return 'The trendy pick';
  if (vibes.has('classic') && !otherVibes.has('classic')) return 'The tried-and-true';

  // 2. Comparative positioning (highlights what THIS one does better)
  if (signals.hasBetterMatch && signals.isCheaper) return 'Better match, better price';
  if (signals.hasBetterMatch) return 'Stronger match for you';
  if (signals.isCheaper && signals.isCloser) return 'Closer and cheaper';
  if (signals.hasMoreFriends) return 'Your friends\u2019 pick';

  // 3. Standout dish hook (especially useful for same-category)
  if (r.standoutDish) {
    const otherDishes = new Set(others.map((o) => o.standoutDish?.toLowerCase()).filter(Boolean));
    if (!otherDishes.has(r.standoutDish.toLowerCase())) return `Known for the ${r.standoutDish}`;
    return `Get the ${r.standoutDish}`;
  }

  // 4. Neighborhood differentiation
  const otherHoods = others.map((o) => o.neighborhood).filter(Boolean);
  if (r.neighborhood && !otherHoods.includes(r.neighborhood)) {
    return `The ${r.neighborhood} spot`;
  }

  // 5. Score-based
  if (signals.hasBetterScore) return 'Higher rated';

  // 6. Price positioning (only when different)
  if (signals.isPricier && (r.priceLevel ?? 0) >= 3) return 'The splurge pick';
  if (signals.isCheaper) return 'Easier on the wallet';

  // 7. Distance
  if (signals.isCloser) return 'The closer option';

  // 8. Cuisine-specific fallback (only if not shared with others)
  const cuisine = (r.cuisine ?? '').toLowerCase();
  const otherCuisines = others.map((o) => (o.cuisine ?? '').toLowerCase());
  const sameCuisine = otherCuisines.some((c) => c === cuisine);

  if (!sameCuisine) {
    if (cuisine.includes('ramen') || cuisine.includes('noodle')) return 'Warm bowl energy';
    if (cuisine.includes('sushi') || cuisine.includes('japanese')) return 'Clean and fresh';
    if (cuisine.includes('pizza')) return 'Proper pizza';
    if (cuisine.includes('taco') || cuisine.includes('mexican')) return 'The real deal';
    if (cuisine.includes('thai')) return 'Bold and spicy';
    if (cuisine.includes('indian')) return 'Rich, layered flavors';
    if (cuisine.includes('korean')) return 'Korean heat';
  }

  // 9. Same-category: use note or neighborhood to differentiate
  if (r.note) return r.note.length > 30 ? r.note.slice(0, 28) + '\u2026' : r.note;
  if (r.neighborhood) return `A ${r.neighborhood} favorite`;
  return 'Worth a try';
}

// ── Decision nudge ─────────────────────────────────────────────────────────
// One sentence that helps the user decide, shown between the header and cards.

function generateDecisionNudge(
  restaurants: CompareRestaurant[],
): string | null {
  if (restaurants.length < 2) return null;
  const [a, b] = restaurants;

  const aMatch = a.matchScore ?? 0;
  const bMatch = b.matchScore ?? 0;
  const aPrice = a.priceLevel ?? 0;
  const bPrice = b.priceLevel ?? 0;
  const aDist = a.distanceLabel ? parseFloat(a.distanceLabel) : null;
  const bDist = b.distanceLabel ? parseFloat(b.distanceLabel) : null;

  // Clear match winner
  if (aMatch > 0 && bMatch > 0 && Math.abs(aMatch - bMatch) >= 0.08) {
    const winner = aMatch > bMatch ? a : b;
    const pct = Math.round((winner.matchScore ?? 0) * 100);
    return `${winner.name} is a ${pct}% match for you`;
  }

  // Price-distance tradeoff
  if (aPrice !== bPrice && aDist != null && bDist != null) {
    const cheaper = aPrice < bPrice ? a : b;
    const closer = aDist < bDist ? a : b;
    if (cheaper.id !== closer.id) {
      return `${cheaper.name} is cheaper, ${closer.name} is closer`;
    }
  }

  // Friends signal
  const aFriends = a.friendCount ?? 0;
  const bFriends = b.friendCount ?? 0;
  if (aFriends !== bFriends && (aFriends > 0 || bFriends > 0)) {
    const popular = aFriends > bFriends ? a : b;
    const count = Math.max(aFriends, bFriends);
    return `${count} friend${count > 1 ? 's' : ''} ${count > 1 ? 'have' : 'has'} been to ${popular.name}`;
  }

  // Same-category nudge — highlight the key differentiator
  const aCuisine = (a.cuisine ?? '').toLowerCase();
  const bCuisine = (b.cuisine ?? '').toLowerCase();
  if (aCuisine === bCuisine && aCuisine.length > 0) {
    // Same cuisine: find any meaningful difference
    if (aPrice !== bPrice) {
      const cheaper = aPrice < bPrice ? a : b;
      const pricier = aPrice > bPrice ? a : b;
      return `${cheaper.name} is more affordable, ${pricier.name} is more upscale`;
    }
    if (a.neighborhood && b.neighborhood && a.neighborhood !== b.neighborhood) {
      return `${a.name} in ${a.neighborhood} vs ${b.name} in ${b.neighborhood}`;
    }
  }

  return null;
}

// ── Factor rows ─────────────────────────────────────────────────────────────

interface Factor {
  icon: string;
  label: string;
  value: string;
  highlight?: boolean;
}

function buildFactors(
  r: CompareRestaurant,
  others: CompareRestaurant[],
): Factor[] {
  const factors: Factor[] = [];

  // Match score
  if (r.matchScore != null && r.matchScore > 0) {
    const pct = Math.round(r.matchScore * 100);
    const bestMatch = others.every((o) => (o.matchScore ?? 0) <= (r.matchScore ?? 0));
    factors.push({
      icon: '\u2728',
      label: 'Match',
      value: `${pct}%`,
      highlight: bestMatch && others.some((o) => (o.matchScore ?? 0) < (r.matchScore ?? 0)),
    });
  }

  // Price
  if (r.priceLevel != null && r.priceLevel > 0) {
    const dollars = '$'.repeat(Math.min(4, r.priceLevel));
    const isCheapest = others.every((o) => (r.priceLevel ?? 0) <= (o.priceLevel ?? 99));
    factors.push({
      icon: '\u{1F4B0}',
      label: 'Price',
      value: dollars,
      highlight: isCheapest && others.some((o) => (o.priceLevel ?? 0) > (r.priceLevel ?? 0)),
    });
  }

  // Distance
  if (r.distanceLabel) {
    const dist = parseFloat(r.distanceLabel);
    const isClosest = others.every((o) => {
      if (!o.distanceLabel) return true;
      return dist <= parseFloat(o.distanceLabel);
    });
    factors.push({
      icon: '\u{1F4CD}',
      label: 'Distance',
      value: r.distanceLabel,
      highlight: isClosest && others.some((o) => o.distanceLabel && parseFloat(o.distanceLabel) > dist),
    });
  }

  // Friends who've been
  if (r.friendCount && r.friendCount > 0) {
    const most = others.every((o) => (r.friendCount ?? 0) >= (o.friendCount ?? 0));
    factors.push({
      icon: '\u{1F46F}',
      label: 'Friends',
      value: `${r.friendCount} visited`,
      highlight: most && others.some((o) => (o.friendCount ?? 0) < (r.friendCount ?? 0)),
    });
  }

  return factors;
}

// ── "Why this one" reasons ────────────────────────────────────────────────
// Short, actionable bullets that explain what sets this restaurant apart.
// Only includes points where this restaurant WINS vs the other.

function buildWhyReasons(
  r: CompareRestaurant,
  others: CompareRestaurant[],
  signals: CompareSignals,
): string[] {
  const reasons: string[] = [];

  if (signals.hasBetterMatch) {
    const pct = Math.round((r.matchScore ?? 0) * 100);
    reasons.push(`${pct}% match — best fit for your taste`);
  }
  if (signals.isCheaper) {
    const dollars = '$'.repeat(Math.min(4, r.priceLevel ?? 1));
    reasons.push(`${dollars} — easier on the wallet`);
  }
  if (signals.isCloser && r.distanceLabel) {
    reasons.push(`${r.distanceLabel} away — the closer option`);
  }
  if (signals.hasMoreFriends && (r.friendCount ?? 0) > 0) {
    reasons.push(`${r.friendCount} friend${(r.friendCount ?? 0) > 1 ? 's' : ''} been here`);
  }
  if (signals.hasBetterScore) {
    reasons.push('Higher quality rating');
  }
  if (r.standoutDish && !others.some((o) => o.standoutDish === r.standoutDish)) {
    reasons.push(`Known for: ${r.standoutDish}`);
  }

  return reasons.slice(0, 3);
}

function getTopDishes(r: CompareRestaurant): string[] {
  // Standout dish first, then cardTags, then reasonTags
  const result: string[] = [];
  const seen = new Set<string>();

  if (r.standoutDish) {
    result.push(r.standoutDish);
    seen.add(r.standoutDish.toLowerCase());
  }

  const tags = (r.cardTags && r.cardTags.length > 0) ? r.cardTags : (r.reasonTags ?? []);
  for (const t of tags) {
    if (result.length >= 2) break;
    if (!seen.has(t.toLowerCase())) {
      result.push(t);
      seen.add(t.toLowerCase());
    }
  }

  // Fall back to dishes array
  if (result.length < 2 && r.dishes) {
    for (const d of r.dishes) {
      if (result.length >= 2) break;
      if (!seen.has(d.toLowerCase())) {
        result.push(d);
        seen.add(d.toLowerCase());
      }
    }
  }

  return result.slice(0, 2);
}

// ── Shared dish detection ────────────────────────────────────────────────────
// When two restaurants have a dish in common, highlight who does it better.

interface SharedDish {
  name: string;
  /** Which restaurant has it starred (null = neither, id = that one, 'both' = both) */
  starredAt: string | 'both' | null;
  starredName: string | null;
}

function findSharedDishes(
  restaurants: CompareRestaurant[],
): SharedDish[] {
  if (restaurants.length < 2) return [];
  const [a, b] = restaurants;
  const aDishes = new Set((a.dishes ?? []).map((d) => d.toLowerCase().trim()));
  const bDishes = new Set((b.dishes ?? []).map((d) => d.toLowerCase().trim()));
  const aStarred = new Set((a.standoutDishes ?? (a.standoutDish ? [a.standoutDish] : [])).map((d) => d.toLowerCase().trim()));
  const bStarred = new Set((b.standoutDishes ?? (b.standoutDish ? [b.standoutDish] : [])).map((d) => d.toLowerCase().trim()));

  const shared: SharedDish[] = [];
  for (const dish of aDishes) {
    if (!bDishes.has(dish)) continue;
    // Find the original casing
    const originalName = (a.dishes ?? []).find((d) => d.toLowerCase().trim() === dish) ?? dish;
    const aHasStar = aStarred.has(dish);
    const bHasStar = bStarred.has(dish);

    let starredAt: string | 'both' | null = null;
    let starredName: string | null = null;
    if (aHasStar && bHasStar) {
      starredAt = 'both';
    } else if (aHasStar) {
      starredAt = a.id;
      starredName = a.name;
    } else if (bHasStar) {
      starredAt = b.id;
      starredName = b.name;
    }

    shared.push({ name: originalName, starredAt, starredName });
  }
  return shared.slice(0, 3);
}

// ── Winner label ────────────────────────────────────────────────────────────

function getWinnerLabel(
  r: CompareRestaurant,
  bestMatchId: string | null,
): { emoji: string; text: string } | null {
  if (r.id === bestMatchId) return { emoji: '\u2728', text: 'Best match for you' };
  return null;
}

// ── Column component ────────────────────────────────────────────────────────

function RestaurantColumn({
  restaurant,
  hook,
  winnerLabel,
  factors,
  dishes,
  whyReasons,
  detail,
  onPress,
  onRemove,
}: {
  restaurant: CompareRestaurant;
  hook: string;
  winnerLabel: { emoji: string; text: string } | null;
  factors: Factor[];
  dishes: string[];
  whyReasons: string[];
  detail: RestaurantDetail | null | undefined;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={[s.column, winnerLabel && s.columnWinner]}>
      {/* Remove */}
      <TouchableOpacity style={s.removeBtn} onPress={onRemove} hitSlop={8} activeOpacity={0.7}>
        <Ionicons name="close-circle" size={18} color={colors.textFaint} />
      </TouchableOpacity>

      {/* Winner badge */}
      {winnerLabel && (
        <View style={s.winnerBadge}>
          <Text style={s.winnerText}>{winnerLabel.emoji} {winnerLabel.text}</Text>
        </View>
      )}

      {/* Name */}
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Text style={s.colName} numberOfLines={2}>{restaurant.name}</Text>
      </TouchableOpacity>

      {/* Meta: cuisine · neighborhood */}
      <Text style={s.colMeta} numberOfLines={1}>
        {[restaurant.cuisine, restaurant.neighborhood].filter(Boolean).join(' \u00B7 ')}
      </Text>

      {/* Hook — the differentiator */}
      <View style={s.hookWrap}>
        <Text style={s.hookText} numberOfLines={2}>{hook}</Text>
      </View>

      {/* ── Comparison factors ── */}
      {factors.length > 0 && (
        <View style={s.factorsWrap}>
          {factors.map((f, i) => (
            <View key={i} style={s.factorRow}>
              <Text style={s.factorIcon}>{f.icon}</Text>
              <View style={s.factorBody}>
                <Text style={s.factorLabel}>{f.label}</Text>
                <Text style={[s.factorValue, f.highlight && s.factorHighlight]}>
                  {f.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Why this one ── */}
      {whyReasons.length > 0 && (
        <View style={s.whyWrap}>
          <Text style={s.whyLabel}>Why this one</Text>
          {whyReasons.map((reason, i) => (
            <View key={i} style={s.whyRow}>
              <Text style={s.whyBullet}>{'\u2713'}</Text>
              <Text style={s.whyText} numberOfLines={2}>{reason}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Order this / known for ── */}
      {dishes.length > 0 && (
        <View style={s.dishesWrap}>
          <Text style={s.dishesLabel}>Order this</Text>
          {dishes.map((d, i) => (
            <View key={i} style={s.dishPill}>
              <Text style={s.dishText} numberOfLines={1}>{d}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── From Google: hours status + rating + top review ── */}
      {detail && (
        <View style={s.googleWrap}>
          {detail.isOpenNow != null ? (
            <View style={[s.openPill, detail.isOpenNow ? s.openPillOpen : s.openPillClosed]}>
              <Text style={[s.openPillText, detail.isOpenNow ? s.openPillTextOpen : s.openPillTextClosed]}>
                {detail.isOpenNow ? 'Open now' : 'Closed'}
              </Text>
            </View>
          ) : null}

          {detail.googleRating != null ? (
            <Text style={s.googleRating}>
              {'★'} {detail.googleRating.toFixed(1)}
              {detail.googleRatingsTotal != null ? (
                <Text style={s.googleRatingCount}>
                  {' '}({detail.googleRatingsTotal >= 1000
                    ? `${(detail.googleRatingsTotal / 1000).toFixed(1)}k`
                    : detail.googleRatingsTotal} Google)
                </Text>
              ) : null}
            </Text>
          ) : null}

          {(detail.popularDishesFromReviews?.length ?? 0) > 0 ? (
            <Text style={s.popularDishes} numberOfLines={2}>
              Popular: {detail.popularDishesFromReviews!.map((d) => d.name).join(' · ')}
            </Text>
          ) : null}

          {detail.googleReviews && detail.googleReviews.length > 0 ? (
            <View style={s.reviewWrap}>
              <Text style={s.reviewText} numberOfLines={3}>
                {'“'}{detail.googleReviews[0].text}{'”'}
              </Text>
              <Text style={s.reviewAuthor}>
                — {detail.googleReviews[0].authorName}
                {detail.googleReviews[0].relativeTime ? ` · ${detail.googleReviews[0].relativeTime}` : ''}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* CTA — pinned to bottom */}
      <TouchableOpacity style={s.viewBtn} onPress={onPress} activeOpacity={0.8}>
        <Text style={s.viewBtnText}>Go with this one</Text>
        <Ionicons name="chevron-forward" size={13} color={colors.accent} />
      </TouchableOpacity>
    </View>
  );
}

// ── Main sheet ──────────────────────────────────────────────────────────────

export function CompareSheet() {
  const { selected, sheetOpen, closeSheet, remove, clear } = useCompare();
  const router = useRouter();
  const [details, setDetails] = useState<Map<string, RestaurantDetail | null>>(new Map());

  // Fetch Google details (hours + reviews + rating) for each compared restaurant
  // when the sheet opens. Cached by id so reopening doesn't refetch.
  useEffect(() => {
    if (!sheetOpen || selected.length === 0) return;
    let cancelled = false;
    const missing = selected.filter((r) => !details.has(r.id));
    if (missing.length === 0) return;

    Promise.all(missing.map(async (r) => {
      try {
        const d = await getRestaurantDetail(r.id);
        return [r.id, d] as const;
      } catch {
        return [r.id, null] as const;
      }
    })).then((entries) => {
      if (cancelled) return;
      setDetails((prev) => {
        const next = new Map(prev);
        for (const [id, d] of entries) next.set(id, d);
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [sheetOpen, selected, details]);

  const handlePress = useCallback(
    (r: CompareRestaurant) => {
      closeSheet();
      // Pass the restaurant data as a payload so the detail screen renders
      // the name + image immediately instead of falling back to the raw
      // internal id (which read as "restaurant_<hash>") while the
      // /api/restaurants lookup is in flight or unsuccessful.
      const payload = encodeURIComponent(JSON.stringify({
        id: r.id,
        placeId: r.placeId ?? null,
        googlePlaceId: r.googlePlaceId ?? r.placeId ?? null,
        name: r.name,
        cuisine: r.cuisine,
        neighborhood: r.neighborhood ?? null,
        priceLevel: r.priceLevel ?? null,
        matchScore: r.matchScore ?? null,
        displayImageUrl: r.imageUrl ?? null,
        imageUrl: r.imageUrl ?? null,
        previewPhotoUrl: r.imageUrl ?? null,
      }));
      router.push(`/(tabs)/restaurant/${encodeURIComponent(r.id)}?payload=${payload}`);
    },
    [closeSheet, router],
  );

  const bestMatchId = useMemo(() => {
    if (selected.length < 2) return null;

    // Clear matchScore winner (5%+ gap)
    let best: CompareRestaurant | null = null;
    for (const r of selected) {
      if (r.matchScore != null && (best == null || (best.matchScore ?? 0) < r.matchScore)) best = r;
    }
    if (best?.matchScore != null) {
      const secondBest = Math.max(...selected.filter((r) => r.id !== best!.id).map((r) => r.matchScore ?? 0));
      if (best.matchScore - secondBest >= 0.05) return best.id;
    }

    // Composite winner: count how many "wins" each restaurant has
    const wins = new Map<string, number>();
    for (const r of selected) {
      const others = selected.filter((o) => o.id !== r.id);
      const sig = computeSignals(r, others);
      let w = 0;
      if (sig.hasBetterMatch) w += 2;
      if (sig.hasBetterScore) w += 1;
      if (sig.isCheaper) w += 1;
      if (sig.isCloser) w += 1;
      if (sig.hasMoreFriends) w += 1;
      wins.set(r.id, w);
    }
    const sorted = Array.from(wins.entries()).sort((a, b) => b[1] - a[1]);
    if (sorted.length >= 2 && sorted[0][1] > sorted[1][1] && sorted[0][1] >= 3) {
      return sorted[0][0];
    }

    return null;
  }, [selected]);

  const content = useMemo(() => {
    const map = new Map<string, { hook: string; factors: Factor[]; dishes: string[]; whyReasons: string[] }>();
    for (const r of selected) {
      const others = selected.filter((o) => o.id !== r.id);
      const signals = computeSignals(r, others);
      map.set(r.id, {
        hook: generateHook(r, others, signals),
        factors: buildFactors(r, others),
        dishes: getTopDishes(r),
        whyReasons: buildWhyReasons(r, others, signals),
      });
    }
    // Deduplicate hooks: if two cards got the same hook, append neighborhood to disambiguate
    const hooks = Array.from(map.entries());
    if (hooks.length === 2 && hooks[0][1].hook === hooks[1][1].hook) {
      for (const [id, data] of hooks) {
        const r = selected.find((s) => s.id === id);
        if (r?.neighborhood) {
          data.hook = `${data.hook} \u2014 ${r.neighborhood}`;
        }
      }
    }
    return map;
  }, [selected]);

  const decisionNudge = useMemo(() => generateDecisionNudge(selected), [selected]);
  const sharedDishes = useMemo(() => findSharedDishes(selected), [selected]);

  if (!sheetOpen) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closeSheet}>
      <Pressable style={s.backdrop} onPress={closeSheet}>
        <Pressable style={s.sheet} onPress={() => {}}>
          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>So, where are we going?</Text>
              {decisionNudge ? (
                <Text style={s.nudge}>{decisionNudge}</Text>
              ) : (
                <Text style={s.subtitle}>Here{'\u2019'}s how they stack up</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => { clear(); closeSheet(); }} activeOpacity={0.7}>
              <Text style={s.clearAll}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Shared dishes callout */}
          {sharedDishes.length > 0 && (
            <View style={s.sharedSection}>
              {sharedDishes.map((sd) => (
                <View key={sd.name} style={s.sharedRow}>
                  <Text style={s.sharedIcon}>🍽</Text>
                  <Text style={s.sharedText} numberOfLines={1}>
                    {sd.starredAt === 'both'
                      ? `Both known for ${sd.name}`
                      : sd.starredName
                        ? `Both serve ${sd.name} — starred at ${sd.starredName}`
                        : `Both serve ${sd.name}`}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Scrollable columns */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
            style={s.scroll}
          >
            {selected.map((r) => {
              const c = content.get(r.id);
              return (
                <RestaurantColumn
                  key={r.id}
                  restaurant={r}
                  hook={c?.hook ?? 'Worth a try'}
                  winnerLabel={getWinnerLabel(r, bestMatchId)}
                  factors={c?.factors ?? []}
                  dishes={c?.dishes ?? []}
                  whyReasons={c?.whyReasons ?? []}
                  detail={details.get(r.id)}
                  onPress={() => handlePress(r)}
                  onRemove={() => remove(r.id)}
                />
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D0CDD4',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  subtitle: { marginTop: 2, fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  nudge: { marginTop: 3, fontSize: 13, fontWeight: '600', color: colors.accent },
  clearAll: { fontSize: 14, fontWeight: '600', color: colors.accent, marginTop: 4 },

  // ── Shared dishes ──
  sharedSection: {
    paddingHorizontal: 20,
    marginBottom: 10,
    gap: 6,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  sharedIcon: { fontSize: 12 },
  sharedText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 20,
  },

  // ── Column ──
  column: {
    width: COLUMN_W,
    height: COLUMN_H,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'flex-start',
  },
  columnWinner: {
    borderColor: colors.accent,
    borderWidth: 1.5,
  },
  removeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
  },
  winnerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    marginBottom: 6,
  },
  winnerText: { fontSize: 10, fontWeight: '700', color: colors.accent },
  colName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    paddingRight: 20,
    lineHeight: 20,
  },
  colMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textFaint,
    fontWeight: '500',
  },

  // ── Hook ──
  hookWrap: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
  },
  hookText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
    lineHeight: 18,
  },

  // ── Factors ──
  factorsWrap: {
    marginTop: 12,
    gap: 8,
  },
  factorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  factorIcon: {
    fontSize: 14,
    width: 20,
    textAlign: 'center',
  },
  factorBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  factorLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  factorValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  factorHighlight: {
    color: colors.accent,
  },

  // ── Why this one ──
  whyWrap: {
    marginTop: 12,
    gap: 4,
  },
  whyLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  whyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
  },
  whyBullet: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.accent,
    marginTop: 1,
  },
  whyText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 15,
  },

  // ── Dishes ──
  dishesWrap: {
    marginTop: 12,
    gap: 5,
  },
  dishesLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  dishPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  dishText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },

  // ── From Google (hours + rating + review) ──
  googleWrap: {
    marginTop: 12,
    gap: 6,
  },
  openPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  openPillOpen: {
    backgroundColor: '#E8F4EA',
  },
  openPillClosed: {
    backgroundColor: '#F5E5E5',
  },
  openPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  openPillTextOpen: {
    color: '#2E7D32',
  },
  openPillTextClosed: {
    color: '#B83A3A',
  },
  googleRating: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  googleRatingCount: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textFaint,
  },
  popularDishes: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accentText,
  },
  reviewWrap: {
    paddingTop: 4,
    gap: 3,
  },
  reviewText: {
    fontSize: 11,
    fontStyle: 'italic',
    color: colors.textMuted,
    lineHeight: 15,
  },
  reviewAuthor: {
    fontSize: 10,
    color: colors.textFaint,
  },

  // ── CTA ──
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 'auto' as any,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
  },
  viewBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
});
