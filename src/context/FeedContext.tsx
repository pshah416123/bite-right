import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FeedLog } from '../components/FeedCard';
import { RESTAURANTS, getFallbackRestaurantPhoto } from '../data/restaurants';

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
    note: 'Buttery crust and that sausage layer. Worth the wait.',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_1'),
  },
  {
    id: '2',
    userName: 'Maya',
    restaurantName: 'Girl & the Goat',
    restaurantId: 'rest_2',
    score: 8.7,
    cuisine: 'American · Small plates',
    neighborhood: 'West Loop',
    state: 'IL',
    dishHighlight: 'Goat belly & lobster',
    note: 'Everything we ordered was great. Make a res.',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_2'),
  },
  {
    id: '3',
    userName: 'Alex',
    restaurantName: "Portillo's",
    restaurantId: 'rest_3',
    score: 9.4,
    cuisine: 'Hot dogs · Chicago classics',
    neighborhood: 'River North',
    state: 'IL',
    dishHighlight: 'Chicago dog & chocolate cake',
    note: 'Iconic. The cake shake is a must.',
    previewPhotoUrl: getFallbackRestaurantPhoto('rest_3'),
  },
];

export function FeedProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<FeedLog[]>(INITIAL_LOGS);

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
      previewPhotoUrl: chosenPhoto,
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

