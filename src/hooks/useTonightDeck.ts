import { useCallback, useState } from 'react';
import type { TonightCardModel } from '../components/TonightCard';
import { RESTAURANTS } from '../data/restaurants';

const SOLO_DECK_IDS = ['rest_4', 'rest_5', 'rest_1', 'rest_2', 'rest_3'];

export function useTonightDeck() {
  const [cards, setCards] = useState<TonightCardModel[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDeck = useCallback(async () => {
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const deck: TonightCardModel[] = SOLO_DECK_IDS.map((id, i) => {
      const r = RESTAURANTS.find((x) => x.id === id);
      return {
        restaurant: {
          id: r?.id ?? id,
          name: r?.name ?? 'Restaurant',
          cuisine: r?.cuisine ?? '',
          neighborhood: r?.neighborhood ?? '',
          priceLevel: 2,
        },
        matchScore: 0.9 - i * 0.02,
        heroPhotoUrl: r?.samplePhotoUrl,
        reasonTags: i === 0 ? ['Wine & small plates – very you'] : i === 1 ? ['Friends rated 9.4', 'Best burger in Chicago'] : [],
      };
    });
    setCards(deck);
    if (__DEV__ && deck.length > 0) {
      console.log('[TonightDeck] Loaded', deck.length, 'cards. First image:', deck[0].heroPhotoUrl ?? '(placeholder)');
    }
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

