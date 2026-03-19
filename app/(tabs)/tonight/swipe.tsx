import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Swiper from 'react-native-deck-swiper';
import { TonightCard } from '~/src/components/TonightCard';
import { getTonightPool, postTonightSwipe } from '~/src/api/tonight';
import { apiClient } from '~/src/api/client';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { useTonightSession } from '~/src/context/TonightContext';
import { colors } from '~/src/theme/colors';
import type { TonightCardModel } from '~/src/components/TonightCard';

/** Subtle feedback only after a more committed drag (keep small drags calm). */
const SUBTLE_FEEDBACK_THRESHOLD = 60;

function ensureAbsolutePhotoUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('http')) return url;
  const base = apiClient.defaults.baseURL || '';
  return base ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url;
}

function poolItemToCard(item: {
  restaurantId: string;
  name: string;
  address: string;
  placeId?: string | null;
  previewPhotoUrl?: string;
  imageUrl?: string;
  socialProofBadge?: string | null;
  groupSignal?: string | null;
}): TonightCardModel {
  const resolved = ensureAbsolutePhotoUrl(item.imageUrl ?? item.previewPhotoUrl);
  return {
    restaurant: {
      id: item.restaurantId,
      name: item.name,
      cuisine: '',
      neighborhood: item.address,
    },
    matchScore: 0,
    imageUrl: resolved,
    reasonTags: [],
    socialProofBadge: item.socialProofBadge ?? null,
    groupSignal: item.groupSignal ?? null,
  };
}

export default function TonightSwipeScreen() {
  const { session } = useTonightSession();
  const { saveRestaurant, isSaved } = useSavedRestaurants();
  const router = useRouter();
  const [cards, setCards] = useState<TonightCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const swiperRef = useRef<Swiper<TonightCardModel> | null>(null);
  const [swipeIntent, setSwipeIntent] = useState<'left' | 'right' | 'up' | null>(null);
  const nextPageRef = useRef(1);
  const prefetchingRef = useRef(false);

  const handleSwiping = () => {
    // Keep swipe feedback minimal: no extra overlays or icon changes while dragging.
    if (swipeIntent !== null) setSwipeIntent(null);
  };

  const clearSwipeIntent = () => setSwipeIntent(null);

  useEffect(() => {
    if (!session?.code || !session?.participantId) {
      router.replace('/(tabs)/tonight');
      return;
    }
    let cancelled = false;
    nextPageRef.current = 1;
    getTonightPool(session.code, 0, 20, session.participantId)
      .then((res) => {
        if (cancelled) return;
        const nextCards = res.pool.map(poolItemToCard);
        setCards(nextCards);
        setError(null);
        if (__DEV__ && nextCards.length > 0) {
          const first = nextCards[0];
          const firstItem = res.pool[0];
          const imageUrl = first.imageUrl ?? firstItem?.imageUrl ?? '(placeholder)';
          const isHttps = typeof imageUrl === 'string' && imageUrl.startsWith('https');
          console.log('[TonightSwipe] First Discover card:', {
            name: first.restaurant.name,
            placeId: firstItem?.placeId ?? null,
            imageUrl,
            isHttpsUrl: isHttps,
          });
        }
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

  // Prefetch next page when remaining cards drop below 10 so the stack rarely runs out.
  useEffect(() => {
    if (!session?.code || !session?.participantId || loading || cards.length >= 10) return;
    if (prefetchingRef.current) return;
    prefetchingRef.current = true;
    const page = nextPageRef.current;
    getTonightPool(session.code, page, 20, session.participantId)
      .then((res) => {
        if (res.pool.length === 0) {
          nextPageRef.current = page + 1;
          prefetchingRef.current = false;
          return;
        }
        nextPageRef.current = page + 1;
        const newCards = res.pool.map(poolItemToCard);
        setCards((prev) => {
          const existingIds = new Set(prev.map((c) => c.restaurant.id));
          const toAdd = newCards.filter((c) => !existingIds.has(c.restaurant.id));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      })
      .catch(() => {})
      .finally(() => {
        prefetchingRef.current = false;
      });
  }, [session?.code, session?.participantId, loading, cards.length]);

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

  if (!session) {
    return null;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.helper}>Loading restaurants…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => router.replace('/(tabs)/tonight')} style={styles.button}>
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
          <Text style={styles.emptyTitle}>You’re done swiping</Text>
          <Text style={styles.helper}>Check matches to see where the group can eat.</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/(tabs)/tonight/matches')}
          >
            <Text style={styles.buttonText}>See matches</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/tonight')}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Swipe right to like, left to pass</Text>
      </View>
      <View style={styles.swipeBody}>
        <View style={styles.deckClipZone}>
          <Swiper
            ref={swiperRef}
            key={cards[0]?.restaurant?.id ?? 'empty'}
            cards={cards}
            renderCard={(card) => {
              if (__DEV__ && cards[0]?.restaurant?.id === card.restaurant.id) {
                console.log('[TonightSwipe] Rendering card image:', card.heroPhotoUrl ?? '(placeholder)');
              }
              return (
                <TonightCard
                  card={card}
                  saved={isSaved(card.restaurant.id)}
                  swipeIntent={swipeIntent}
                />
              );
            }}
            backgroundColor={colors.bg}
            containerStyle={styles.swiperContainer}
            cardStyle={styles.swiperCardShell}
            stackSize={3}
            onSwiping={handleSwiping}
            onSwipedAborted={clearSwipeIntent}
            onSwipedRight={(index) => {
              clearSwipeIntent();
              handleSwipe(cards[index], 'LIKE');
            }}
            onSwipedLeft={(index) => {
              clearSwipeIntent();
              handleSwipe(cards[index], 'PASS');
            }}
            onSwipedAll={() => {
              if (__DEV__) console.log('[TonightSwipe] All cards swiped');
            }}
          />
        </View>
        <View style={styles.swipeFooter}>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.passButton]}
              onPress={() => swiperRef.current?.swipeLeft()}
            >
              <Text style={styles.actionButtonText}>Pass</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.likeButton]}
              onPress={() => swiperRef.current?.swipeRight()}
            >
              <Text style={[styles.actionButtonText, styles.likeButtonText]}>Like</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.matchesButton}
            onPress={() => router.replace('/(tabs)/tonight/matches')}
          >
            <Text style={styles.buttonText}>See matches</Text>
          </TouchableOpacity>
        </View>
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 16,
    color: colors.accent,
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    color: colors.textMuted,
  },
  swipeBody: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.bg,
  },
  deckClipZone: {
    flex: 1,
    minHeight: 0,
    zIndex: 2,
    elevation: 4,
    overflow: 'hidden',
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  swiperContainer: {
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  swiperCardShell: {
    backgroundColor: colors.bg,
  },
  swipeFooter: {
    flexShrink: 0,
    zIndex: 1,
    backgroundColor: colors.bg,
    paddingBottom: 16,
  },
  helper: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.text,
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
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 16,
  },
  actionButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    minWidth: 100,
    alignItems: 'center',
  },
  passButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  likeButton: {
    backgroundColor: colors.accent,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  likeButtonText: {
    color: '#111827',
  },
  matchesButton: {
    marginHorizontal: 24,
    marginBottom: 24,
    paddingVertical: 14,
    backgroundColor: colors.accent,
    borderRadius: 12,
    alignItems: 'center',
  },
});
