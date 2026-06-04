import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeedLog } from '../components/FeedCard';
import { getRestaurantDetail, searchRestaurantImageByName } from '../api/restaurants';
import { setRestaurantPhotoCache } from '../utils/restaurantPhoto';
import { normalizeRestaurantName } from '../utils/nameNormalize';
import { useTestMode } from './TestModeContext';
import { TEST_FEED_LOGS } from '../data/testMockData';
import { SOCIAL_PROFILES } from '../data/socialProfiles';
import { useAuthContext } from './AuthContext';
import { createLog as apiCreateLog, deleteLog as apiDeleteLog, getFeed as apiGetFeed } from '../api/logs';

// Derive a friendly display name from a Supabase auth user. Falls back to
// the email prefix capitalized when no metadata is set. Skipped entirely
// when there's no session (dev mode / mocks).
function deriveDisplayName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined): string {
  if (!user) return 'You';
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fromMeta = typeof meta.displayName === 'string' && meta.displayName.trim();
  if (fromMeta) return fromMeta;
  const email = user.email ?? '';
  const prefix = email.split('@')[0] || '';
  if (!prefix) return 'Someone';
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

// Resolves tagged userNames to feed-friendly profile objects. Returns
// undefined when the input has no names so callers can fall back to existing.
function resolveTaggedUsers(
  names?: string[],
): { userName: string; displayName?: string; userAvatar?: string | null }[] | undefined {
  if (!names || names.length === 0) return undefined;
  return names.map((userName) => {
    const profile = SOCIAL_PROFILES[userName];
    return {
      userName,
      displayName: profile?.displayName,
      userAvatar: null,
    };
  });
}

export interface NewLogInput {
  userName: string;
  restaurantId: string;
  restaurantName: string;
  cuisine: string;
  neighborhood?: string;
  city?: string;
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
  highlight?: 'food' | 'vibe' | 'service' | 'value' | null;
  dishes?: string[];
  standoutDishes?: string[];
  vibeTags?: import('../components/FeedCard').VibeTag[];
  quickTip?: string;
  bestTime?: string;
  /** Friends tagged on this visit. Stored on the resulting FeedLog as
   *  `taggedUsers` after resolving each userName to a display profile. */
  taggedUserNames?: string[];
}

// ── Restaurant Log (canonical per-user-per-restaurant record) ───────────────

export interface RestaurantLog {
  restaurantId: string;
  userId: string;
  rating: number;
  standoutDish?: string;
  tags?: import('../components/FeedCard').VibeTag[];
  visitCount: number;
}

// ── Visit (one per trip) ────────────────────────────────────────────────────

export interface Visit {
  id: string;
  restaurantLogId: string;
  timestamp: string;
  note?: string;
  photo?: string;
  ratingSnapshot: number;
}

// ── Context value ───────────────────────────────────────────────────────────

interface FeedContextValue {
  items: FeedLog[];
  addLog: (input: NewLogInput) => void;
  updateLog: (id: string, input: NewLogInput) => void;
  /** Delete a log the current user authored. Optimistically removes from
   *  state, then calls the server. */
  deleteLog: (logId: string) => Promise<void>;
  /** Look up the canonical restaurant_log for a given restaurantId (current user only). */
  getRestaurantLog: (restaurantId: string) => RestaurantLog | undefined;
  /** Get all visits for a given restaurantId (current user only), newest first. */
  getVisits: (restaurantId: string) => Visit[];
}

const CURRENT_USER = 'You';

const FeedContext = createContext<FeedContextValue | undefined>(undefined);

// Seed feed shown to brand-new accounts before they (and their friends)
// have generated organic activity. No "You" posts here — testers were
// confused by a fake "You went to Lou Malnati's" entry they hadn't
// actually logged. The mock now reads as social proof from named
// friends across a variety of well-known Chicago restaurants.
const INITIAL_LOGS: FeedLog[] = [
  {
    id: '2',
    userName: 'Maya',
    userAvatar: 'https://i.pravatar.cc/120?img=32',
    restaurantName: 'Girl & the Goat',
    restaurantId: 'rest_2',
    score: 8.7,
    cuisine: 'American · Small plates',
    neighborhood: 'West Loop',
    city: 'Chicago',
    state: 'IL',
    dishHighlight: 'Goat belly & lobster',
    standoutDish: { label: 'Standout', name: 'Goat belly & lobster' },
    note: 'Everything we ordered was great. Make a res.',
    dishes: ['Goat empanadas', 'Goat belly', 'Wood oven pig face'],
    quickTip: 'Sit at the bar for the best view of the kitchen',
    bestTime: 'Date night',
    createdAt: '2026-05-28T18:00:00.000Z',
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
    city: 'Chicago',
    state: 'IL',
    dishHighlight: 'Chicago dog & chocolate cake',
    standoutDish: { label: 'Standout', name: 'Chicago dog & chocolate cake' },
    note: 'Iconic. The cake shake is a must.',
    createdAt: '2026-05-26T17:00:00.000Z',
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
    city: 'Chicago',
    state: 'IL',
    dishHighlight: 'Classic deep dish',
    standoutDish: { label: 'Standout', name: 'Classic deep dish' },
    note: 'Solid as always. Crisp edges and great sauce balance.',
    dishes: ['Classic deep dish', 'Chopped salad'],
    quickTip: 'Ask for extra crispy edges',
    bestTime: 'Weekday lunch',
    createdAt: '2026-05-25T19:00:00.000Z',
  },
  {
    id: '5',
    userName: 'Sam',
    userAvatar: 'https://i.pravatar.cc/120?img=51',
    restaurantName: 'Au Cheval',
    restaurantId: 'rest_5',
    score: 9.3,
    cuisine: 'Burgers · American',
    neighborhood: 'West Loop',
    city: 'Chicago',
    state: 'IL',
    dishHighlight: 'Single cheeseburger',
    standoutDish: { label: 'Standout', name: 'Single cheeseburger' },
    note: 'The single is more than enough. Get the egg on top.',
    dishes: ['Single cheeseburger', 'Bone marrow', 'Duck fat fries'],
    quickTip: 'Long wait — put your name in and grab a drink across the street.',
    createdAt: '2026-05-23T20:30:00.000Z',
  },
  {
    id: '6',
    userName: 'Riley',
    userAvatar: 'https://i.pravatar.cc/120?img=68',
    restaurantName: 'The Purple Pig',
    restaurantId: 'rest_4',
    score: 8.6,
    cuisine: 'Mediterranean · Shared plates',
    neighborhood: 'Magnificent Mile',
    city: 'Chicago',
    state: 'IL',
    dishHighlight: 'Milk-braised pork shoulder',
    standoutDish: { label: 'Standout', name: 'Milk-braised pork shoulder' },
    note: 'Pork shoulder is the move. Lots of small plates — go with a group.',
    dishes: ['Milk-braised pork shoulder', 'Bone marrow', 'JLT sandwich'],
    bestTime: 'Group dinner',
    createdAt: '2026-05-21T19:30:00.000Z',
  },
  {
    id: '7',
    userName: 'Taylor',
    userAvatar: 'https://i.pravatar.cc/120?img=5',
    restaurantName: 'Girl & the Goat',
    restaurantId: 'rest_2',
    score: 9.1,
    cuisine: 'American · Small plates',
    neighborhood: 'West Loop',
    city: 'Chicago',
    state: 'IL',
    note: 'Best meal I had this year. Pig face is mandatory.',
    dishes: ['Wood oven pig face', 'Pan-seared scallops'],
    createdAt: '2026-05-19T20:00:00.000Z',
  },
  {
    id: '8',
    userName: 'Casey',
    userAvatar: 'https://i.pravatar.cc/120?img=9',
    restaurantName: "Portillo's",
    restaurantId: 'rest_3',
    score: 8.4,
    cuisine: 'Hot dogs · Chicago classics',
    neighborhood: 'River North',
    city: 'Chicago',
    state: 'IL',
    note: 'Quick lunch fix. Italian beef dipped is the way.',
    createdAt: '2026-05-17T13:00:00.000Z',
  },
];

// Build initial restaurantLogs from seed data (current user only)
function buildInitialRestaurantLogs(logs: FeedLog[]): Map<string, RestaurantLog> {
  const map = new Map<string, RestaurantLog>();
  const userLogs = logs.filter((l) => l.userName === CURRENT_USER);
  for (const log of userLogs) {
    map.set(log.restaurantId, {
      restaurantId: log.restaurantId,
      userId: CURRENT_USER,
      rating: log.score,
      standoutDish: log.standoutDish?.name ?? log.dishHighlight,
      tags: log.vibeTags,
      visitCount: log.visitCount ?? 1,
    });
  }
  return map;
}

function buildInitialVisits(logs: FeedLog[]): Visit[] {
  return logs
    .filter((l) => l.userName === CURRENT_USER)
    .map((l) => ({
      id: l.id,
      restaurantLogId: l.restaurantId,
      timestamp: l.createdAt ?? new Date().toISOString(),
      note: l.note,
      photo: l.photo_url ?? l.previewPhotoUrl ?? undefined,
      ratingSnapshot: l.score,
    }));
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const { isTestMode } = useTestMode();
  const auth = useAuthContext();
  const ownUserId = auth.user?.id ?? null;
  const ownDisplayName = useMemo(() => deriveDisplayName(auth.user), [auth.user]);
  const [items, setItems] = useState<FeedLog[]>(INITIAL_LOGS);
  const restaurantLogsRef = useRef<Map<string, RestaurantLog>>(buildInitialRestaurantLogs(INITIAL_LOGS));
  const visitsRef = useRef<Visit[]>(buildInitialVisits(INITIAL_LOGS));

  // Swap feed data when test mode toggles
  useEffect(() => {
    if (isTestMode) {
      setItems(TEST_FEED_LOGS);
    }
  }, [isTestMode]);

  // Fetch the live feed from the server. Own logs are relabeled to "You" so
  // the existing UI heuristics (which key on userName === 'You') keep working
  // without a deeper refactor.
  //
  // Real logs go first; the seeded INITIAL_LOGS is appended below as ambient
  // social proof until there's enough organic activity to fill the feed
  // (TestFlight starts empty otherwise). Once real activity threshold is hit,
  // the mock seed drops away.
  const SEED_THRESHOLD = 20;
  const fetchFeed = useCallback(async () => {
    if (isTestMode) return;
    try {
      const serverFeed = await apiGetFeed();
      const relabeled = serverFeed.map((log) =>
        ownUserId && log.userId === ownUserId ? { ...log, userName: CURRENT_USER } : log,
      );
      const merged = relabeled.length >= SEED_THRESHOLD
        ? relabeled
        : [...relabeled, ...INITIAL_LOGS];
      setItems(merged);
    } catch {
      // Server unavailable — keep whatever we have (mock seed or last fetch)
    }
  }, [isTestMode, ownUserId]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const buildLog = (input: NewLogInput, existing?: FeedLog): FeedLog => {
    const {
      userName,
      restaurantId,
      restaurantName,
      cuisine,
      neighborhood,
      city,
      state,
      address,
      rating,
      note,
      dishHighlight,
      photoUris,
      primaryPhotoIndex,
      previewPhotoUrl: inputPreviewPhotoUrl,
      userAvatar,
      highlight,
      dishes,
      vibeTags,
    } = input;

    const userSelectedPhoto =
      photoUris && photoUris.length
        ? photoUris[Math.max(0, primaryPhotoIndex ?? 0)] ?? photoUris[0]
        : undefined;
    // Single source of truth: log.previewPhotoUrl. Order: user photo → API-resolved → existing image → fallback.
    const chosenPhoto = inputPreviewPhotoUrl ?? existing?.previewPhotoUrl;

    const id = existing?.id ?? `${Date.now()}`;
    const createdAt = existing?.createdAt ?? new Date().toISOString();

    const standoutDish =
      dishHighlight && dishHighlight.trim()
        ? { label: 'Standout', name: dishHighlight.trim() }
        : undefined;

    return {
      id,
      userName,
      restaurantId,
      restaurantName,
      score: rating,
      cuisine,
      neighborhood,
      city,
      state,
      address,
      note,
      dishHighlight,
      standoutDish,
      photo_url: userSelectedPhoto ?? existing?.photo_url,
      previewPhotoUrl: chosenPhoto,
      createdAt,
      userAvatar,
      highlight,
      dishes,
      standoutDishes: input.standoutDishes ?? existing?.standoutDishes,
      vibeTags,
      quickTip: input.quickTip ?? existing?.quickTip ?? null,
      bestTime: input.bestTime ?? existing?.bestTime ?? null,
      taggedUsers: resolveTaggedUsers(input.taggedUserNames) ?? existing?.taggedUsers,
    };
  };

  const addLog = useCallback((input: NewLogInput) => {
    const isCurrentUser = input.userName === CURRENT_USER;
    const existingRL = isCurrentUser ? restaurantLogsRef.current.get(input.restaurantId) : undefined;

    const newVisitCount = existingRL ? existingRL.visitCount + 1 : 1;
    const previousRating = existingRL ? existingRL.rating : undefined;
    const visitNumber = newVisitCount;

    // Build the feed log
    const base = buildLog(input);
    const newLog: FeedLog = {
      ...base,
      userId: isCurrentUser ? ownUserId : base.userId ?? null,
      visitNumber,
      visitCount: newVisitCount,
      previousRating,
    };

    // Persist to server for the current user. Send the real display name (not
    // the literal "You") so other testers see it as the right author. The
    // local optimistic entry keeps userName === "You" so the current user's
    // UI stays consistent. Fire-and-forget: failures are logged but don't
    // block the optimistic add — the next fetchFeed will reconcile state.
    if (isCurrentUser && !isTestMode) {
      apiCreateLog({
        restaurantId: input.restaurantId,
        rating: input.rating,
        notes: input.note,
        photos: input.photoUris,
        userId: ownUserId ?? undefined,
        userName: ownDisplayName,
        standoutDish: input.dishHighlight?.trim() || undefined,
        dishes: input.dishes,
        vibeTags: input.vibeTags,
        quickTip: input.quickTip,
        highlight: input.highlight,
      }).catch((e) => {
        if (__DEV__) console.log('[BiteRight][feed] createLog failed', e?.message);
      });
    }

    // Update restaurant_log (canonical record)
    if (isCurrentUser) {
      restaurantLogsRef.current.set(input.restaurantId, {
        restaurantId: input.restaurantId,
        userId: CURRENT_USER,
        rating: input.rating,
        standoutDish: input.dishHighlight?.trim() || existingRL?.standoutDish,
        tags: input.vibeTags ?? existingRL?.tags,
        visitCount: newVisitCount,
      });

      // Create visit record
      const visit: Visit = {
        id: newLog.id,
        restaurantLogId: input.restaurantId,
        timestamp: newLog.createdAt ?? new Date().toISOString(),
        note: input.note,
        photo: newLog.photo_url ?? newLog.previewPhotoUrl ?? undefined,
        ratingSnapshot: input.rating,
      };
      visitsRef.current = [visit, ...visitsRef.current];

      // Backfill visitCount on older feed items for this restaurant
      setItems((prev) => {
        const updated = prev.map((log) => {
          if (log.userName === CURRENT_USER && log.restaurantId === input.restaurantId) {
            return { ...log, visitCount: newVisitCount };
          }
          return log;
        });
        return [newLog, ...updated];
      });
    } else {
      setItems((prev) => [newLog, ...prev]);
    }
  }, [isTestMode, ownDisplayName, ownUserId]);

  const updateLog = useCallback((id: string, input: NewLogInput) => {
    setItems((prev) => {
      const existing = prev.find((log) => log.id === id);
      if (!existing) return prev;
      const updated = buildLog(input, existing);
      // Preserve visit metadata on edit
      const patched: FeedLog = {
        ...updated,
        visitNumber: existing.visitNumber,
        visitCount: existing.visitCount,
        previousRating: existing.previousRating,
      };

      // Update canonical restaurant_log rating if current user
      if (input.userName === CURRENT_USER) {
        const rl = restaurantLogsRef.current.get(input.restaurantId);
        if (rl) {
          restaurantLogsRef.current.set(input.restaurantId, {
            ...rl,
            rating: input.rating,
            standoutDish: input.dishHighlight?.trim() || rl.standoutDish,
            tags: input.vibeTags ?? rl.tags,
          });
        }
        // Update visit snapshot
        visitsRef.current = visitsRef.current.map((v) =>
          v.id === id ? { ...v, ratingSnapshot: input.rating, note: input.note } : v,
        );
      }

      return prev.map((log) => (log.id === id ? patched : log));
    });
  }, []);

  const deleteLog = useCallback(async (logId: string) => {
    // Optimistic — remove from state first, then call the server. On failure
    // we don't roll back (rare; the next fetchFeed will reconcile if the
    // server still has it).
    setItems((prev) => prev.filter((l) => l.id !== logId));
    try {
      await apiDeleteLog(logId);
    } catch {
      // ignore — next fetchFeed reconciles
    }
  }, []);

  const getRestaurantLog = useCallback((restaurantId: string): RestaurantLog | undefined => {
    return restaurantLogsRef.current.get(restaurantId);
  }, []);

  const getVisits = useCallback((restaurantId: string): Visit[] => {
    return visitsRef.current
      .filter((v) => v.restaurantLogId === restaurantId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, []);

  // ── Image enrichment: two-stage pipeline with retry ──────────────────────
  // Stage 1: getRestaurantDetail by ID (fast, works for known restaurants)
  // Stage 2: searchRestaurantImageByName (fallback for unmatched restaurants)
  // Retries after RETRY_DELAY_MS if items still missing images.
  const enrichRetryRef = useRef(0);
  const MAX_ENRICHMENT_RETRIES = 3;
  const RETRY_DELAY_MS = 15_000;

  useEffect(() => {
    if (isTestMode) return; // Skip enrichment in test mode
    let cancelled = false;

    const enrichMissing = async () => {
      const missing = items.filter(
        (log) => !log.photo_url && !log.previewPhotoUrl && log.restaurantId,
      );
      if (missing.length === 0) return;

      // Deduplicate by restaurantId, keep name + location for fallback search
      const uniqueMap = new Map<string, { id: string; name: string; neighborhood?: string; city?: string; state?: string }>();
      for (const log of missing) {
        if (!uniqueMap.has(log.restaurantId)) {
          uniqueMap.set(log.restaurantId, {
            id: log.restaurantId,
            name: log.restaurantName,
            neighborhood: log.neighborhood,
            city: log.city,
            state: log.state,
          });
        }
      }

      const urlMap = new Map<string, string>();

      // Also build a normalized-name → url map so we can match across name variants
      const nameUrlMap = new Map<string, string>();

      for (const [rid, info] of uniqueMap) {
        if (cancelled) return;

        // ── Stage 1: detail lookup by ID ──
        const detail = await getRestaurantDetail(rid).catch(() => null);
        const detailUrl = detail?.displayImageUrl ?? detail?.imageUrl ?? null;
        if (detailUrl) {
          urlMap.set(rid, detailUrl);
          nameUrlMap.set(normalizeRestaurantName(info.name), detailUrl);
          if (__DEV__) console.log('[BiteRight][Enrich] stage1-hit', rid, info.name);
          continue;
        }

        if (__DEV__) console.log('[BiteRight][Enrich] stage1-miss, trying name search', rid, info.name);

        // ── Stage 1.5: check if another feed item with normalized-matching name already resolved ──
        const normName = normalizeRestaurantName(info.name);
        const cachedByName = nameUrlMap.get(normName);
        if (cachedByName) {
          urlMap.set(rid, cachedByName);
          if (__DEV__) console.log('[BiteRight][Enrich] name-cache-hit', rid, info.name);
          continue;
        }

        // ── Stage 2: search by restaurant name via autocomplete + select ──
        const searchResult = await searchRestaurantImageByName(
          info.name,
          null, // no coords for now; autocomplete still works without them
        ).catch(() => ({ imageUrl: null, placeId: null }));

        if (searchResult.imageUrl) {
          urlMap.set(rid, searchResult.imageUrl);
          nameUrlMap.set(normName, searchResult.imageUrl);
          // Prime the photo cache so RestaurantImage component picks it up too
          setRestaurantPhotoCache({ id: rid, name: info.name }, searchResult.imageUrl);
          if (__DEV__) console.log('[BiteRight][Enrich] stage2-hit', rid, info.name, searchResult.imageUrl);
          continue;
        }

        if (__DEV__) console.log('[BiteRight][Enrich] all-stages-failed', rid, info.name);
      }

      if (cancelled || urlMap.size === 0) {
        // Schedule retry if we still have unresolved items and haven't exceeded max retries
        if (!cancelled && urlMap.size === 0 && enrichRetryRef.current < MAX_ENRICHMENT_RETRIES) {
          enrichRetryRef.current += 1;
          if (__DEV__) console.log('[BiteRight][Enrich] scheduling retry', enrichRetryRef.current);
          retryTimer = setTimeout(enrichMissing, RETRY_DELAY_MS);
        }
        return;
      }

      setItems((prev) =>
        prev.map((log) => {
          if (log.photo_url || log.previewPhotoUrl) return log;
          const resolved = urlMap.get(log.restaurantId);
          if (!resolved) return log;
          return { ...log, previewPhotoUrl: resolved };
        }),
      );

      // Check if there are still unresolved items after this pass
      if (!cancelled && enrichRetryRef.current < MAX_ENRICHMENT_RETRIES) {
        const stillMissing = items.filter(
          (log) =>
            !log.photo_url &&
            !log.previewPhotoUrl &&
            log.restaurantId &&
            !urlMap.has(log.restaurantId),
        );
        if (stillMissing.length > 0) {
          enrichRetryRef.current += 1;
          if (__DEV__) console.log('[BiteRight][Enrich] scheduling retry for remaining', stillMissing.length);
          retryTimer = setTimeout(enrichMissing, RETRY_DELAY_MS);
        }
      }
    };

    // Initial delay to let health check and first render finish
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const initialTimer = setTimeout(enrichMissing, 2000);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [items]); // Re-run when items change (e.g., new log added)

  const deduplicatedItems = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((log) => {
      if (seen.has(log.id)) return false;
      seen.add(log.id);
      return true;
    });
  }, [items]);

  const value = useMemo(
    () => ({
      items: deduplicatedItems,
      addLog,
      updateLog,
      deleteLog,
      getRestaurantLog,
      getVisits,
    }),
    [deduplicatedItems, addLog, updateLog, deleteLog, getRestaurantLog, getVisits],
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
