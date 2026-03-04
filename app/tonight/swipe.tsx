import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Swiper from 'react-native-deck-swiper';
import { TonightCard } from '../../src/components/TonightCard';
import { getTonightPool, postTonightSwipe } from '../../src/api/tonight';
import { apiClient } from '../../src/api/client';
import { useTonightSession } from '../../src/context/TonightContext';
import { colors } from '../../src/theme/colors';
import type { TonightCardModel } from '../../src/components/TonightCard';

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
  };
}

export default function TonightSwipeScreen() {
  const { session } = useTonightSession();
  const router = useRouter();
  const [cards, setCards] = useState<TonightCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const swiperRef = useRef<Swiper<TonightCardModel> | null>(null);

  useEffect(() => {
    if (!session?.code || !session?.participantId) {
      router.replace('/tonight');
      return;
    }
    let cancelled = false;
    getTonightPool(session.code)
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
    },
    [session?.code, session?.participantId],
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
          <TouchableOpacity onPress={() => router.replace('/tonight')} style={styles.button}>
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
            onPress={() => router.replace('/tonight/matches')}
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
        <TouchableOpacity onPress={() => router.replace('/tonight')}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Swipe right to like, left to pass</Text>
      </View>
      <View style={styles.deckContainer}>
        <Swiper
          ref={swiperRef}
          key={cards[0]?.restaurant?.id ?? 'empty'}
          cards={cards}
          renderCard={(card) => {
            if (__DEV__ && cards[0]?.restaurant?.id === card.restaurant.id) {
              console.log('[TonightSwipe] Rendering card image:', card.heroPhotoUrl ?? '(placeholder)');
            }
            return <TonightCard card={card} />;
          }}
          backgroundColor="transparent"
          stackSize={3}
          onSwipedRight={(index) => handleSwipe(cards[index], 'LIKE')}
          onSwipedLeft={(index) => handleSwipe(cards[index], 'PASS')}
          onSwipedAll={() => {
            if (__DEV__) console.log('[TonightSwipe] All cards swiped');
          }}
        />
      </View>
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
        onPress={() => router.replace('/tonight/matches')}
      >
        <Text style={styles.buttonText}>See matches</Text>
      </TouchableOpacity>
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
  deckContainer: {
    flex: 1,
    paddingTop: 16,
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
