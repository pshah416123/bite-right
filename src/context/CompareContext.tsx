import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// ── Unified shape for any restaurant added to compare ─────────────────────────

export interface CompareRestaurant {
  id: string;
  name: string;
  cuisine: string;
  neighborhood?: string | null;
  priceLevel?: number | null;
  score?: number | null;
  matchScore?: number | null;
  dishes?: string[];
  standoutDish?: string | null;
  standoutDishes?: string[];
  vibeTags?: string[];
  note?: string | null;
  imageUrl?: string | null;
  distanceLabel?: string | null;
  reasonTags?: string[];
  cardTags?: string[];
  friendCount?: number;
}

const MAX_COMPARE = 5;

interface CompareState {
  selected: CompareRestaurant[];
  /** True when 1+ restaurants are selected — cards intercept taps to add. */
  compareMode: boolean;
  sheetOpen: boolean;
  isSelected: (id: string) => boolean;
  toggle: (restaurant: CompareRestaurant) => void;
  remove: (id: string) => void;
  clear: () => void;
  openSheet: () => void;
  closeSheet: () => void;
}

const CompareContext = createContext<CompareState | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<CompareRestaurant[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const compareMode = selected.length > 0;

  const isSelected = useCallback(
    (id: string) => selected.some((r) => r.id === id),
    [selected],
  );

  const toggle = useCallback((restaurant: CompareRestaurant) => {
    setSelected((prev) => {
      const exists = prev.some((r) => r.id === restaurant.id);
      if (exists) return prev.filter((r) => r.id !== restaurant.id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, restaurant];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setSelected((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clear = useCallback(() => {
    setSelected([]);
    setSheetOpen(false);
  }, []);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const value = useMemo(
    () => ({ selected, compareMode, sheetOpen, isSelected, toggle, remove, clear, openSheet, closeSheet }),
    [selected, compareMode, sheetOpen, isSelected, toggle, remove, clear, openSheet, closeSheet],
  );

  return (
    <CompareContext.Provider value={value}>
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare(): CompareState {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error('useCompare must be used within CompareProvider');
  return ctx;
}
