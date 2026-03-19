import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  addSavedRestaurant,
  getSavedRestaurants,
  removeSavedRestaurant as removeSavedRestaurantApi,
  type SavedRestaurantItem,
  type SaveRestaurantPayload,
} from '../api/saved';

const USER_ID = 'default';
const STORAGE_KEY = 'biteright_saved_restaurants';

interface SavedRestaurantsContextValue {
  /** All saved restaurants, most recently saved first. */
  savedRestaurants: SavedRestaurantItem[];
  loading: boolean;
  error: string | null;
  /** Add or update saved restaurant (no duplicate by place_id). */
  saveRestaurant: (payload: SaveRestaurantPayload, source: 'swipe' | 'manual') => Promise<void>;
  /** Remove from saved. */
  removeSaved: (placeId: string) => Promise<void>;
  /** Check if restaurant is saved. */
  isSaved: (placeId: string) => boolean;
  refreshSaved: () => Promise<void>;
}

const SavedRestaurantsContext = createContext<SavedRestaurantsContextValue | undefined>(undefined);

function sortBySavedAt(list: SavedRestaurantItem[]): SavedRestaurantItem[] {
  return [...list].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

export function SavedRestaurantsProvider({ children }: { children: ReactNode }) {
  const [savedRestaurants, setSavedRestaurants] = useState<SavedRestaurantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSaved = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getSavedRestaurants(USER_ID, { sort: 'recent' });
      setSavedRestaurants(sortBySavedAt(list));
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load saved restaurants';
      setError(msg);
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedRestaurantItem[];
          if (Array.isArray(parsed)) setSavedRestaurants(sortBySavedAt(parsed));
        }
      } catch {
        setSavedRestaurants([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedRestaurantItem[];
          if (Array.isArray(parsed) && parsed.length > 0) setSavedRestaurants(sortBySavedAt(parsed));
        }
      } catch {
        // ignore
      }
      await refreshSaved();
    })();
  }, [refreshSaved]);

  const saveRestaurant = useCallback(
    async (payload: SaveRestaurantPayload, source: 'swipe' | 'manual') => {
      const placeId = payload.place_id;
      const existing = savedRestaurants.find((s) => (s.place_id ?? s.restaurantId) === placeId);
      if (existing) {
        if (__DEV__) console.log('[SavedRestaurants] saveRestaurant skip — already in local list', { placeId });
        return;
      }

      try {
        if (__DEV__) console.log('[SavedRestaurants] saveRestaurant calling API', { placeId, name: payload.name });
        const result = await addSavedRestaurant(USER_ID, payload, source);
        if (__DEV__) {
          console.log('[SavedRestaurants] saveRestaurant API result', {
            saved: result.saved,
            alreadySaved: result.alreadySaved,
          });
        }
        if (result.saved || result.alreadySaved) {
          await refreshSaved();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[SavedRestaurants] saveRestaurant failed:', msg, e);
      }
    },
    [savedRestaurants, refreshSaved],
  );

  const removeSaved = useCallback(async (placeId: string) => {
    const next = savedRestaurants.filter((s) => (s.place_id ?? s.restaurantId) !== placeId);
    setSavedRestaurants(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    try {
      await removeSavedRestaurantApi(USER_ID, placeId);
    } catch (e) {
      if (__DEV__) console.warn('[SavedRestaurants] removeSaved API failed:', e);
    }
  }, [savedRestaurants]);

  const isSaved = useCallback(
    (placeId: string) => savedRestaurants.some((s) => (s.place_id ?? s.restaurantId) === placeId),
    [savedRestaurants],
  );

  const value = useMemo<SavedRestaurantsContextValue>(
    () => ({
      savedRestaurants,
      loading,
      error,
      saveRestaurant,
      removeSaved,
      isSaved,
      refreshSaved,
    }),
    [savedRestaurants, loading, error, saveRestaurant, removeSaved, isSaved, refreshSaved],
  );

  return (
    <SavedRestaurantsContext.Provider value={value}>
      {children}
    </SavedRestaurantsContext.Provider>
  );
}

export function useSavedRestaurants(): SavedRestaurantsContextValue {
  const ctx = useContext(SavedRestaurantsContext);
  if (ctx === undefined) throw new Error('useSavedRestaurants must be used within SavedRestaurantsProvider');
  return ctx;
}
