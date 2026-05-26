import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import SwipeDeck from '~/src/components/SwipeDeck';
import { getTonightPool, postTonightSwipe, getSessionState, markDoneSwiping } from '~/src/api/tonight';
import type { ParticipantProgress, PoolItem } from '~/src/api/tonight';
import { apiClient } from '~/src/api/client';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { useTonightSession } from '~/src/context/TonightContext';
import { colors } from '~/src/theme/colors';
import type { TonightCardModel } from '~/src/components/TonightCard';

function ensureAbsolutePhotoUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('http')) return url;
  const base = apiClient.defaults.baseURL || '';
  return base ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url;
}

function poolItemToCard(item: PoolItem): TonightCardModel {
  const resolved = ensureAbsolutePhotoUrl(
    item.displayImageUrl ?? item.imageUrl ?? item.previewPhotoUrl,
  );
  return {
    restaurant: {
      id: item.restaurantId,
      name: item.name,
      cuisine: item.cuisine ?? '',
      neighborhood: item.neighborhood ?? item.address,
      priceLevel: item.priceLevel ?? undefined,
      googlePlaceId: item.googlePlaceId ?? item.placeId ?? null,
      displayImageUrl: resolved,
      displayImageSourceType: item.displayImageSourceType ?? null,
      displayImageLastResolvedAt: item.displayImageLastResolvedAt ?? null,
    },
    matchScore: 0,
    rating: item.rating ?? null,
    imageUrl: resolved,
    reasonTags: [],
    socialProofBadge: item.socialProofBadge ?? null,
    groupSignal: item.groupSignal ?? null,
    distanceMi: item.distanceMi ?? null,
    whyLine: item.whyLine ?? null,
    recommendedDishes: item.recommendedDishes ?? null,
    isOpenNow: item.isOpenNow ?? null,
    fallbackNote: item.fallbackNote ?? null,
  };
}

export default function TonightSwipeScreen() {
  const { session } = useTonightSession();
  const { saveRestaurant, isSaved } = useSavedRestaurants();
  const router = useRouter();
  const [cards, setCards] = useState<TonightCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Surfaced when the backend dropped or substituted the cuisine filter because
  // it had no matches in the search area. relaxedFrom is what the user asked for
  // (e.g. "Ramen"); relaxedTo is what we showed instead ("Japanese") or null if
  // we had to drop the cuisine entirely.
  const [filtersRelaxed, setFiltersRelaxed] = useState(false);
  const [relaxedFrom, setRelaxedFrom] = useState<string | null>(null);
  const [relaxedTo, setRelaxedTo] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantProgress[]>([]);
  const nextPageRef = useRef(1);
  const prefetchingRef = useRef(false);
  const seenIdsRef = useRef(new Set<string>());

  // ── Load initial pool ──────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.code || !session?.participantId) {
      router.navigate('/(tabs)/tonight');
      return;
    }
    let cancelled = false;
    nextPageRef.current = 1;
    seenIdsRef.current = new Set();
    getTonightPool(session.code, 0, 20, session.participantId)
      .then((res) => {
        if (cancelled) return;
        const nextCards = res.pool.map(poolItemToCard);
        nextCards.forEach((c) => seenIdsRef.current.add(c.restaurant.id));
        setCards(nextCards);
        setError(null);
        setFiltersRelaxed(!!res.filtersRelaxed);
        setRelaxedFrom(res.relaxedFrom ?? res.relaxedCuisine ?? null);
        setRelaxedTo(res.relaxedTo ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message || 'Failed to load pool');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session?.code, session?.participantId, router]);

  // ── Endless prefetch — triggered by SwipeDeck's onRunningLow callback ───
  const handleRunningLow = useCallback(async () => {
    if (!session?.code || !session?.participantId || prefetchingRef.current) return;
    prefetchingRef.current = true;
    const page = nextPageRef.current;
    try {
      const res = await getTonightPool(session.code, page, 20, session.participantId);
      nextPageRef.current = page + 1;
      const seen = seenIdsRef.current;
      const newCards = res.pool.map(poolItemToCard).filter((c) => !seen.has(c.restaurant.id));
      newCards.forEach((c) => seen.add(c.restaurant.id));
      if (newCards.length > 0) {
        setCards((prev) => [...prev, ...newCards]);
      }
    } catch {
      // Silently fail
    } finally {
      prefetchingRef.current = false;
    }
  }, [session?.code, session?.participantId]);

  // ── Poll participant progress (only while still swiping) ──────────────
  const sessionGoneRef = useRef(false);
  const doneSwiping = cards.length === 0 && !loading;
  useEffect(() => {
    if (!session?.code || doneSwiping) return;
    const poll = () => {
      if (sessionGoneRef.current) return;
      getSessionState(session.code).then((state) => {
        setParticipants(state.participants);
      }).catch((err: any) => {
        const status = err?.response?.status;
        if ((status === 404 || status === 410) && !sessionGoneRef.current) {
          sessionGoneRef.current = true;
          // Silently navigate back instead of blocking with Alert
          router.navigate('/(tabs)/tonight');
        }
      });
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [session?.code, doneSwiping, router]);

  // ── Swipe handlers ─────────────────────────────────────────────────────
  const handleSwipe = useCallback(
    (card: TonightCardModel, action: 'LIKE' | 'PASS') => {
      if (!session?.code || !session?.participantId) return;
      const restaurantId = card.restaurant.id;
      setCards((prev) => prev.filter((c) => c.restaurant.id !== restaurantId));
      const userId = 'default';
      postTonightSwipe(session.code, {
        participantId: session.participantId,
        restaurantId,
        action,
        ...(action === 'LIKE' ? { userId } : {}),
      }).catch((err) => {
        if (__DEV__) console.warn('[TonightSwipe] Swipe API error:', err?.message ?? err);
      });
      if (action === 'LIKE') {
        saveRestaurant(
          {
            place_id: restaurantId,
            name: card.restaurant.name,
            photo: card.imageUrl ?? card.heroPhotoUrl ?? undefined,
            cuisine: card.restaurant.cuisine || undefined,
            neighborhood: card.restaurant.neighborhood ?? undefined,
            price_level: card.restaurant.priceLevel ?? undefined,
          },
          'swipe',
        );
      }
    },
    [session?.code, session?.participantId, saveRestaurant],
  );

  const onSwipedRight = useCallback(
    (card: TonightCardModel) => handleSwipe(card, 'LIKE'),
    [handleSwipe],
  );
  const onSwipedLeft = useCallback(
    (card: TonightCardModel) => handleSwipe(card, 'PASS'),
    [handleSwipe],
  );
  const onSwipedTop = useCallback(
    (card: TonightCardModel) => handleSwipe(card, 'LIKE'),
    [handleSwipe],
  );
  const onAllSwiped = useCallback(() => {
    if (__DEV__) console.log('[TonightSwipe] All cards swiped');
    // Auto-mark done swiping on the server when deck runs out
    if (session?.code && session?.participantId) {
      markDoneSwiping(session.code, session.participantId).catch(() => {});
    }
  }, [session?.code, session?.participantId]);

  const isSavedCheck = useCallback(
    (id: string) => isSaved(id),
    [isSaved],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  if (!session) return null;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.helper}>Loading restaurants\u2026</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => router.navigate('/(tabs)/tonight')} style={styles.button}>
            <Text style={styles.buttonText}>Back to Tonight</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (cards.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>You're done swiping</Text>
          <Text style={styles.helper}>Check matches to see where the group can eat.</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push('/(tabs)/tonight/matches')}
          >
            <Text style={styles.buttonText}>See matches</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.navigate('/(tabs)/tonight')}>
            <Text style={styles.backText}>{'\u2190'} Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              if (!session?.code || !session?.participantId) return;
              await markDoneSwiping(session.code, session.participantId).catch(() => {});
              router.navigate('/(tabs)/tonight/matches');
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.doneLink}>Done swiping</Text>
          </TouchableOpacity>
        </View>
        {/* Participant status */}
        {participants.length > 1 && (
          <View style={styles.participantRow}>
            {participants.map((p) => (
              <View key={p.participantId} style={styles.participantPill}>
                <View style={[styles.participantStatusDot, p.doneSwiping && styles.participantDone]} />
                <Text style={styles.participantLabel} numberOfLines={1}>
                  {p.displayName}
                  {p.doneSwiping ? ' \u2713' : p.swipeCount > 0 ? ` (${p.swipeCount})` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Filter-relaxed banner — surfaced when the cuisine filter produced no
          results. Banner explains the substitution so the user knows WHY
          they're seeing what they're seeing (e.g. "No ramen — showing
          Japanese, the closest match"). */}
      {filtersRelaxed ? (
        <View style={styles.relaxedBanner}>
          <Text style={styles.relaxedBannerTitle}>
            {relaxedFrom ? `No ${relaxedFrom.toLowerCase()} places nearby` : 'No matches for your filters'}
          </Text>
          <Text style={styles.relaxedBannerText} numberOfLines={2}>
            {relaxedTo
              ? `Showing ${relaxedTo.toLowerCase()} spots instead — the closest match in your area.`
              : 'Showing top picks in your area instead.'}
          </Text>
        </View>
      ) : null}

      {/* ── Swipe deck (same component as group mode) ─────────────── */}
      <View style={styles.deckArea}>
        <SwipeDeck
          cards={cards}
          onSwipedLeft={onSwipedLeft}
          onSwipedRight={onSwipedRight}
          onSwipedTop={onSwipedTop}
          onAllSwiped={onAllSwiped}
          onRunningLow={handleRunningLow}
          runningLowThreshold={5}
          isSaved={isSavedCheck}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  backText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  doneLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  participantRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  participantPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  participantStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  participantDone: {
    backgroundColor: '#22c55e',
  },
  participantLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    maxWidth: 80,
  },
  deckArea: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 2,
  },
  relaxedBanner: {
    marginHorizontal: 14,
    marginTop: 2,
    marginBottom: 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent + '40',
  },
  relaxedBannerTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  relaxedBannerText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  helper: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  button: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.accent,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
