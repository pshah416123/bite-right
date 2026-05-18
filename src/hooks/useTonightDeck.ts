import { useCallback, useRef, useState } from 'react';
import type { TonightCardModel } from '../components/TonightCard';
import { RESTAURANTS } from '../data/restaurants';

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 10;
const PREFETCH_THRESHOLD = 2;

// Assign price levels for demo (real app would use Google Places priceLevel)
export const PRICE_MAP: Record<string, number> = {
  rest_1: 2, rest_2: 3, rest_3: 1, rest_4: 2, rest_5: 3,
  rest_tokyo_1: 4, rest_tokyo_2: 1, rest_tokyo_3: 3, rest_tokyo_4: 4, rest_tokyo_5: 2,
  rest_mh_1: 2, rest_mh_2: 1, rest_mh_3: 4, rest_mh_4: 2, rest_mh_5: 2,
  rest_other_1: 2, rest_other_2: 3, rest_other_3: 1, rest_other_4: 2, rest_other_5: 2,
};

export function getCuisineCategory(cuisine: string): string {
  const c = cuisine.toLowerCase();
  if (c.includes('pizza') || c.includes('neapolitan') || c.includes('italian') || c.includes('pasta')) return 'Italian';
  if (c.includes('mexican') || c.includes('taco') || c.includes('burrito')) return 'Mexican';
  if (
    c.includes('sushi') || c.includes('ramen') || c.includes('japanese') ||
    c.includes('tempura') || c.includes('yakiniku') || c.includes('katsu') ||
    c.includes('noodle') || c.includes('izakaya')
  ) return 'Asian';
  if (c.includes('mediterranean') || c.includes('greek') || c.includes('falafel')) return 'Mediterranean';
  if (c.includes('seafood') || c.includes('fish') || c.includes('oyster')) return 'Seafood';
  return 'American';
}

const ALL_IDS = RESTAURANTS.map((r) => r.id);

// ── Card builder ──────────────────────────────────────────────────────────────

function buildCard(id: string, index: number): TonightCardModel {
  const r = RESTAURANTS.find((x) => x.id === id);
  return {
    restaurant: {
      id: r?.id ?? id,
      name: r?.name ?? 'Restaurant',
      cuisine: r?.cuisine ?? '',
      neighborhood: r?.neighborhood ?? '',
      priceLevel: PRICE_MAP[id] ?? 2,
    },
    matchScore: Math.max(0.7, 0.96 - index * 0.02),
    reasonTags:
      index === 0
        ? ['Matches your taste perfectly']
        : index === 1
        ? ['Popular with people like you']
        : [],
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTonightDeck() {
  const [cards, setCards] = useState<TonightCardModel[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedCountRef = useRef(0);
  const prefetchingRef = useRef(false);
  const swipeCountRef = useRef(0);

  const prefetchNext = useCallback(() => {
    if (prefetchingRef.current) return;
    const start = loadedCountRef.current;
    const batch = ALL_IDS.slice(start, start + BATCH_SIZE);
    if (batch.length === 0) return;
    prefetchingRef.current = true;
    if (__DEV__) console.log('[TonightDeck] pre-fetching batch', { start, count: batch.length });
    const newCards = batch.map((id, i) => buildCard(id, start + i));
    loadedCountRef.current = start + newCards.length;
    setCards((prev) => [...prev, ...newCards]);
    prefetchingRef.current = false;
  }, []);

  const loadDeck = useCallback(() => {
    setLoading(true);
    loadedCountRef.current = 0;
    swipeCountRef.current = 0;
    const batch = ALL_IDS.slice(0, BATCH_SIZE);
    const deck = batch.map((id, i) => buildCard(id, i));
    loadedCountRef.current = batch.length;
    setCards(deck);
    setLoading(false);
  }, []);

  const swipe = useCallback(
    (_card: TonightCardModel, _action: 'like' | 'pass' | 'super_like') => {
      // SwipeDeck advances its own internal index — we do NOT filter cards here.
      // Filtering would cause an index-skip bug. We only track swipes for pre-fetch.
      swipeCountRef.current += 1;
      const remaining = loadedCountRef.current - swipeCountRef.current;
      if (remaining <= PREFETCH_THRESHOLD) {
        prefetchNext();
      }
    },
    [prefetchNext],
  );

  return { cards, loading, loadDeck, swipe };
}
