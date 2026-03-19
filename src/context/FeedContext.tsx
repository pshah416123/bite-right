import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FeedLog } from '../components/FeedCard';
import { RESTAURANTS, getFallbackRestaurantPhoto } from '../data/restaurants';
import { getNeutralRestaurantPlaceholderUri } from '../utils/restaurantImage';
import { getRestaurantDetail } from '../api/restaurants';

export interface NewLogInput {
  userName: string;
  restaurantId: string;
  restaurantName: string;
  cuisine: string;
  neighborhood?: string;
  state?: string;
  address?: string;
  rating: number;
  note?: string;
  dishHighlight?: string;
  photoUris?: string[];
  primaryPhotoIndex?: number | null;
  /** When user doesn't add photos, pass resolved restaurant image URL from API so the feed shows a pic. */
  previewPhotoUrl?: string;
  /** Profile image URL for Discover / social surfaces */
  userAvatar?: string;
  foodRating?: number;
  serviceRating?: number;
  ambienceRating?: number;
  valueRating?: number;
  dishes?: string[];
  vibeTags?: import('../components/FeedCard').VibeTag[];
}

interface FeedContextValue {
  items: FeedLog[];
  addLog: (input: NewLogInput) => void;
}

const FeedContext = createContext<FeedContextValue | undefined>(undefined);

const INITIAL_LOGS: FeedLog[] = [
  {
    id: '1',
    userName: 'You',
    restaurantName: "Lou Malnati's",
    restaurantId: 'rest_1',
    score: 9.2,
    cuisine: 'Pizza · Deep dish',
    neighborhood: 'River North',
    state: 'IL',
    dishHighlight: 'Chicago-style deep dish',
    standoutDish: { label: 'Standout', name: 'Chicago-style deep dish' },
    note: 'Buttery crust and that sausage layer. Worth the wait.',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_1'),
    createdAt: '2024-01-12T18:00:00.000Z',
  },
  {
    id: '2',
    userName: 'Maya',
    userAvatar: 'https://i.pravatar.cc/120?img=32',
    restaurantName: 'Girl & the Goat',
    restaurantId: 'rest_2',
    score: 8.7,
    cuisine: 'American · Small plates',
    neighborhood: 'West Loop',
    state: 'IL',
    dishHighlight: 'Goat belly & lobster',
    standoutDish: { label: 'Standout', name: 'Goat belly & lobster' },
    note: 'Everything we ordered was great. Make a res.',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_2'),
    createdAt: '2024-01-08T18:00:00.000Z',
  },
  {
    id: '3',
    userName: 'Alex',
    userAvatar: 'https://i.pravatar.cc/120?img=12',
    restaurantName: "Portillo's",
    restaurantId: 'rest_3',
    score: 9.4,
    cuisine: 'Hot dogs · Chicago classics',
    neighborhood: 'River North',
    state: 'IL',
    dishHighlight: 'Chicago dog & chocolate cake',
    standoutDish: { label: 'Standout', name: 'Chicago dog & chocolate cake' },
    note: 'Iconic. The cake shake is a must.',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_3'),
    createdAt: '2023-12-20T18:00:00.000Z',
  },
  {
    id: '4',
    userName: 'Jordan',
    userAvatar: 'https://i.pravatar.cc/120?img=47',
    restaurantName: "Lou Malnati's",
    restaurantId: 'rest_1',
    score: 8.9,
    cuisine: 'Pizza · Deep dish',
    neighborhood: 'River North',
    state: 'IL',
    dishHighlight: 'Classic deep dish',
    standoutDish: { label: 'Standout', name: 'Classic deep dish' },
    note: 'Solid as always.',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_1'),
    createdAt: '2024-01-05T18:00:00.000Z',
  },
  {
    id: '5',
    userName: 'Sam',
    userAvatar: 'https://i.pravatar.cc/120?img=51',
    restaurantName: "Lou Malnati's",
    restaurantId: 'rest_1',
    score: 9.0,
    cuisine: 'Pizza · Deep dish',
    neighborhood: 'River North',
    state: 'IL',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_1'),
    createdAt: '2024-01-03T18:00:00.000Z',
  },
  {
    id: '6',
    userName: 'Riley',
    userAvatar: 'https://i.pravatar.cc/120?img=68',
    restaurantName: "Lou Malnati's",
    restaurantId: 'rest_1',
    score: 8.5,
    cuisine: 'Pizza · Deep dish',
    neighborhood: 'River North',
    state: 'IL',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_1'),
    createdAt: '2024-01-02T18:00:00.000Z',
  },
  {
    id: '7',
    userName: 'Taylor',
    userAvatar: 'https://i.pravatar.cc/120?img=5',
    restaurantName: "Lou Malnati's",
    restaurantId: 'rest_1',
    score: 9.1,
    cuisine: 'Pizza · Deep dish',
    neighborhood: 'River North',
    state: 'IL',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_1'),
    createdAt: '2024-01-01T18:00:00.000Z',
  },
  {
    id: '8',
    userName: 'Casey',
    userAvatar: 'https://i.pravatar.cc/120?img=9',
    restaurantName: "Lou Malnati's",
    restaurantId: 'rest_1',
    score: 8.8,
    cuisine: 'Pizza · Deep dish',
    neighborhood: 'River North',
    state: 'IL',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_1'),
    createdAt: '2023-12-28T18:00:00.000Z',
  },
];

export function FeedProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<FeedLog[]>(INITIAL_LOGS);

  // Hydrate seeded logs with real restaurant images (Places / website) when available.
  useEffect(() => {
    let cancelled = false;
    async function hydrateSeedImages() {
      const ids = Array.from(new Set(items.map((l) => l.restaurantId)));
      const updates: Record<string, string> = {};
      await Promise.all(
        ids.map(async (restaurantId) => {
          const detail = await getRestaurantDetail(restaurantId).catch(() => null);
          if (detail?.imageUrl && detail.imageUrl.trim()) {
            updates[restaurantId] = detail.imageUrl.trim();
          }
        }),
      );
      if (cancelled || Object.keys(updates).length === 0) return;
      setItems((prev) =>
        prev.map((log) => {
          const updated = updates[log.restaurantId];
          if (!updated) return log;
          const seedNeutral = getNeutralRestaurantPlaceholderUri();
          const isSeedFallback =
            log.previewPhotoUrl === seedNeutral || log.previewPhotoUrl === getFallbackRestaurantPhoto(log.restaurantId);
          if (!isSeedFallback) return log;
          return { ...log, previewPhotoUrl: updated };
        }),
      );
    }
    hydrateSeedImages();
    return () => {
      cancelled = true;
    };
  }, []);

  const addLog = (input: NewLogInput) => {
    const {
      userName,
      restaurantId,
      restaurantName,
      cuisine,
      neighborhood,
      state,
      address,
      rating,
      note,
      dishHighlight,
      photoUris,
      primaryPhotoIndex,
      previewPhotoUrl: inputPreviewPhotoUrl,
      userAvatar,
      foodRating,
      serviceRating,
      ambienceRating,
      valueRating,
      dishes,
      vibeTags,
    } = input;

    // Single source of truth: log.previewPhotoUrl. Order: user photo → API-resolved (inputPreviewPhotoUrl) → last-resort static fallback (rest_1–5 only).
    const chosenPhoto =
      photoUris && photoUris.length
        ? photoUris[Math.max(0, primaryPhotoIndex ?? 0)]
        : inputPreviewPhotoUrl ?? getFallbackRestaurantPhoto(restaurantId);

    const id = `${Date.now()}`;
    const createdAt = new Date().toISOString();

    const standoutDish =
      dishHighlight && dishHighlight.trim()
        ? { label: 'Standout', name: dishHighlight.trim() }
        : undefined;

    const newLog: FeedLog = {
      id,
      userName,
      restaurantId,
      restaurantName,
      score: rating,
      cuisine,
      neighborhood,
      state,
      address,
      note,
      dishHighlight,
      standoutDish,
      previewPhotoUrl: chosenPhoto,
      createdAt,
      userAvatar,
      foodRating,
      serviceRating,
      ambienceRating,
      valueRating,
      dishes,
      vibeTags,
    };

    setItems((prev) => [newLog, ...prev]);
  };

  const value = useMemo(
    () => ({
      items,
      addLog,
    }),
    [items],
  );

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function useFeedContext(): FeedContextValue {
  const ctx = useContext(FeedContext);
  if (!ctx) {
    throw new Error('useFeedContext must be used within a FeedProvider');
  }
  return ctx;
}

