import { useCallback, useState } from 'react';
import type { TonightCardModel } from '../components/TonightCard';
import { RESTAURANTS } from '../data/restaurants';
import { getRestaurantDetail } from '../api/restaurants';
import { getNeutralRestaurantPlaceholderUri } from '../utils/restaurantImage';

const SOLO_DECK_IDS = ['rest_4', 'rest_5', 'rest_1', 'rest_2', 'rest_3'];

export function useTonightDeck() {
  const [cards, setCards] = useState<TonightCardModel[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDeck = useCallback(async () => {
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const neutral = getNeutralRestaurantPlaceholderUri();
    const deck: TonightCardModel[] = await Promise.all(
      SOLO_DECK_IDS.map(async (id, i) => {
        const r = RESTAURANTS.find((x) => x.id === id);
        const detail = await getRestaurantDetail(id).catch(() => null);
        const imageUrl =
          detail?.imageUrl && (detail.imageUrl.startsWith('http') || detail.imageUrl.startsWith('/'))
            ? detail.imageUrl
            : neutral;
        if (__DEV__) {
          console.log('[TonightDeck] image', {
            internalId: id,
            restaurantName: r?.name ?? id,
            googlePlaceId: detail?.placeId ?? null,
            googlePlaceIdFound: !!(detail?.placeId && String(detail.placeId).length > 0),
            chosenImageSourceType: detail?.imageUrl ? 'API_RESOLVED' : 'NEUTRAL_PLACEHOLDER',
            placeholderUsed: !detail?.imageUrl,
          });
        }
        return {
          restaurant: {
            id: r?.id ?? id,
            name: r?.name ?? 'Restaurant',
            cuisine: r?.cuisine ?? '',
            neighborhood: r?.neighborhood ?? '',
            priceLevel: 2,
          },
          matchScore: 0.9 - i * 0.02,
          imageUrl,
          reasonTags:
            i === 0 ? ['Wine & small plates – very you'] : i === 1 ? ['Friends rated 9.4', 'Best burger in Chicago'] : [],
        };
      }),
    );
    setCards(deck);
    setLoading(false);
  }, []);

  const swipe = useCallback(
    (card: TonightCardModel, action: 'like' | 'pass' | 'super_like') => {
      setCards((prev) => prev.filter((c) => c.restaurant.id !== card.restaurant.id));
    },
    [],
  );

  return {
    cards,
    loading,
    loadDeck,
    swipe,
  };
}

