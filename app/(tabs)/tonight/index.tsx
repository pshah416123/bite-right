import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityRole,
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import SwipeDeck from '~/src/components/SwipeDeck';
import { TN } from '~/src/components/SwipeCard';
import { colors } from '~/src/theme/colors';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { useTonightSession } from '~/src/context/TonightContext';
import {
  createTonightSession,
  updateSessionSettings,
  getTonightPool,
  postTonightSwipe,
  getSessionState,
} from '~/src/api/tonight';
import type { ParticipantProgress, PoolItem } from '~/src/api/tonight';
import type { TonightCardModel } from '~/src/components/TonightCard';
import { apiClient } from '~/src/api/client';

// ── Filter config ─────────────────────────────────────────────────────────────

const MOOD_CHIPS: { label: string; emoji: string }[] = [
  { label: 'Comfort', emoji: '🍲' },
  { label: 'Trendy', emoji: '✨' },
  { label: 'Fancy', emoji: '🥂' },
  { label: 'Casual', emoji: '😎' },
  { label: 'Quick bite', emoji: '⚡' },
];

const TOP_CUISINE_CHIPS = [
  'Italian', 'Sushi', 'Mexican', 'Thai', 'Pizza', 'Burgers',
];

const ALL_CUISINE_CHIPS = [
  'Italian', 'Mexican', 'American', 'Mediterranean', 'Asian', 'Indian',
  'Seafood', 'Sushi', 'Thai', 'Chinese', 'Greek', 'French',
  'Middle Eastern', 'BBQ', 'Burgers', 'Pizza', 'Dessert', 'Breakfast',
  'Vegetarian', 'Steakhouse',
];

const PRICE_CHIPS: { label: string; value: number }[] = [
  { label: '$', value: 1 },
  { label: '$$', value: 2 },
  { label: '$$$', value: 3 },
  { label: '$$$$', value: 4 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureAbsolutePhotoUrl(url: string | undefined | null): string | undefined {
  if (!url || url.startsWith('http')) return url ?? undefined;
  const base = apiClient.defaults.baseURL || '';
  return base ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url;
}

function poolItemToCard(item: PoolItem): TonightCardModel {
  const resolved = ensureAbsolutePhotoUrl(
    item.displayImageUrl ?? item.imageUrl ?? item.previewPhotoUrl,
  );
  return {
    restaurant: {
      id: item.restaurantId,
      name: item.name,
      cuisine: item.cuisine ?? '',
      neighborhood: item.neighborhood ?? item.address,
      priceLevel: item.priceLevel ?? undefined,
      googlePlaceId: item.googlePlaceId ?? item.placeId ?? null,
      displayImageUrl: resolved,
      displayImageSourceType: item.displayImageSourceType ?? null,
      displayImageLastResolvedAt: item.displayImageLastResolvedAt ?? null,
    },
    matchScore: 0,
    imageUrl: resolved,
    reasonTags: [],
    socialProofBadge: item.socialProofBadge ?? null,
    groupSignal: null,
    distanceMi: item.distanceMi ?? null,
    whyLine: item.whyLine ?? null,
    recommendedDishes: item.recommendedDishes ?? null,
    isOpenNow: item.isOpenNow ?? null,
  };
}

// ── Cross-session memory: IDs the user has already swiped on (persists across
//    tab visits within the same app session, cleared on app restart). ──────────
const globalSeenIds = new Set<string>();

/** Fisher-Yates shuffle (in-place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TonightScreen() {
  const { saveRestaurant, isSaved } = useSavedRestaurants();
  const { session, setSession, clearSession } = useTonightSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Solo session — created silently on mount to back the swipe deck
  const soloSessionRef = useRef<{ code: string; participantId: string } | null>(null);
  const [cards, setCards] = useState<TonightCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  // ── Live group progress ──────────────────────────────────────────────────
  // Poll the session state every 5s while the user is on the Tonight tab
  // AND has an active group session. Drives the progress strip + "everyone
  // done" banner. Tab navigation is unaffected — polling pauses when the
  // tab loses focus, so this is cheap.
  const [groupParticipants, setGroupParticipants] = useState<ParticipantProgress[]>([]);
  const [groupDeckSize, setGroupDeckSize] = useState<number>(15);
  useEffect(() => {
    if (!session?.code) {
      setGroupParticipants([]);
      return;
    }
    let cancelled = false;
    const poll = () => {
      if (!session?.code) return;
      getSessionState(session.code)
        .then((state) => {
          if (cancelled) return;
          setGroupParticipants(state.participants);
        })
        .catch(() => { /* server cleanup or transient error — leave last-known state */ });
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.code]);
  const groupAllDone = useMemo(
    () => groupParticipants.length > 0 && groupParticipants.every((p) => p.doneSwiping),
    [groupParticipants],
  );
  const groupDoneCount = useMemo(
    () => groupParticipants.filter((p) => p.doneSwiping).length,
    [groupParticipants],
  );

  // ── Toast (lightweight swipe feedback) ───────────────────────────────────
  const [toastText, setToastText] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToastText(text);
    toastOpacity.setValue(0);
    Animated.timing(toastOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() =>
        setToastText(null),
      );
    }, 1400);
  }, [toastOpacity]);

  // ── Shortlist (session-level craved places, max 5) ─────────────────────
  const MAX_SHORTLIST = 5;
  const [shortlist, setShortlist] = useState<TonightCardModel[]>([]);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [decisionPromptShown, setDecisionPromptShown] = useState(false);

  // ── Active filters (applied to deck) ──────────────────────────────────────
  const [moodFilter, setMoodFilter] = useState<string | null>(null);
  const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
  const [priceFilter, setPriceFilter] = useState<number | null>(null);
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [deckKey, setDeckKey] = useState(0);

  // ── Endless deck state ────────────────────────────────────────────────────
  const nextPageRef = useRef(1);
  const prefetchingRef = useRef(false);
  const seenIdsRef = useRef(new Set<string>());
  // Session swipe signals — used to lightly re-rank future batches
  const likedCuisinesRef = useRef<Record<string, number>>({});
  const passedCuisinesRef = useRef<Record<string, number>>({});

  // ── Pending filters (inside the sheet before Apply) ───────────────────────
  const [filterOpen, setFilterOpen] = useState(false);
  const [pendingMood, setPendingMood] = useState<string | null>(null);
  const [pendingCuisine, setPendingCuisine] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<string | null>(null);
  const [pendingPrice, setPendingPrice] = useState<number | null>(null);
  const [cuisineExpanded, setCuisineExpanded] = useState(false);

  // Slide-up animation for bottom sheet
  const slideAnim = useRef(new Animated.Value(0)).current;

  // ── Create solo session + fetch pool ────────────────────────────────────────

  /** Fetch a page from the pool, dedup against this-session seen IDs,
   *  prioritize restaurants the user hasn't seen in prior tab visits,
   *  shuffle for variety, and lightly re-rank by cuisine signals. */
  const fetchPool = useCallback(async (
    code: string,
    participantId: string,
    page = 0,
    pageSize = 30,
  ) => {
    const res = await getTonightPool(code, page, pageSize, participantId);
    const sessionSeen = seenIdsRef.current;

    // Snapshot globalSeenIds *before* marking new results so we can separate
    // "never seen" from "seen in a previous tab visit"
    const previouslySeenSnapshot = new Set(globalSeenIds);

    const fresh = res.pool
      .filter((item) => !sessionSeen.has(item.restaurantId))
      .map(poolItemToCard);

    // Mark as seen (this session + global)
    fresh.forEach((c) => {
      sessionSeen.add(c.restaurant.id);
      globalSeenIds.add(c.restaurant.id);
    });

    // Partition: never-seen-before first, then previously-seen
    const neverSeen: TonightCardModel[] = [];
    const seenBefore: TonightCardModel[] = [];
    for (const card of fresh) {
      if (previouslySeenSnapshot.has(card.restaurant.id)) {
        seenBefore.push(card);
      } else {
        neverSeen.push(card);
      }
    }

    // Shuffle each group independently for a fresh order every visit
    shuffle(neverSeen);
    shuffle(seenBefore);
    const ordered = [...neverSeen, ...seenBefore];

    // Light re-ranking: boost cuisines the user liked, suppress those they passed
    const liked = likedCuisinesRef.current;
    const passed = passedCuisinesRef.current;
    const hasSignals = Object.keys(liked).length > 0 || Object.keys(passed).length > 0;
    if (hasSignals && ordered.length > 1) {
      ordered.sort((a, b) => {
        const scoreA = (liked[a.restaurant.cuisine] ?? 0) - (passed[a.restaurant.cuisine] ?? 0);
        const scoreB = (liked[b.restaurant.cuisine] ?? 0) - (passed[b.restaurant.cuisine] ?? 0);
        return scoreB - scoreA;
      });
    }

    return { cards: ordered, hasMore: res.pool.length >= pageSize };
  }, []);

  // Every time the Tonight tab gains focus: create a fresh solo session so the
  // order is different and the deck feels new. Session-level state is reset but
  // globalSeenIds persists so previously-swiped restaurants sort to the back.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      // Reset session-level state
      seenIdsRef.current = new Set();
      likedCuisinesRef.current = {};
      passedCuisinesRef.current = {};
      nextPageRef.current = 1;
      prefetchingRef.current = false;
      setShortlist([]);
      setDecisionPromptShown(false);
      setDeckKey((k) => k + 1);

      (async () => {
        try {
          setLoading(true);
          setLoadError(null);

          // Get user location for nearby-first results
          let locationLat: number | undefined;
          let locationLng: number | undefined;
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
              const pos = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              locationLat = pos.coords.latitude;
              locationLng = pos.coords.longitude;
            }
          } catch {
            // Location unavailable — proceed without it
          }
          if (cancelled) return;

          const sessionSettings: Record<string, unknown> = {};
          if (locationLat != null && locationLng != null) {
            sessionSettings.locationLat = locationLat;
            sessionSettings.locationLng = locationLng;
          }

          const res = await createTonightSession({
            settings: Object.keys(sessionSettings).length > 0 ? sessionSettings as any : undefined,
          });
          if (cancelled) return;
          soloSessionRef.current = { code: res.code, participantId: res.participantId };
          const { cards: poolCards } = await fetchPool(res.code, res.participantId, 0, 30);
          if (cancelled) return;
          setCards(poolCards);
        } catch (err: any) {
          if (cancelled) return;
          setLoadError(err?.message || 'Failed to load restaurants');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => { cancelled = true; };
    }, [fetchPool]),
  );

  // ── Endless prefetch — triggered by SwipeDeck's onRunningLow ──────────────
  const handleRunningLow = useCallback(async () => {
    const solo = soloSessionRef.current;
    if (!solo || prefetchingRef.current) return;
    prefetchingRef.current = true;

    try {
      const page = nextPageRef.current;
      const { cards: newCards, hasMore } = await fetchPool(
        solo.code, solo.participantId, page, 30,
      );
      if (newCards.length > 0) {
        setCards((prev) => [...prev, ...newCards]);
      }
      nextPageRef.current = page + 1;
      // If the server returned a full page there may be more; if not, wrap to page 0
      // (server may have new results after earlier ones were consumed)
      if (!hasMore && page > 0) {
        nextPageRef.current = 0;
      }
    } catch {
      // Silently fail — user keeps swiping what's left
    } finally {
      prefetchingRef.current = false;
    }
  }, [fetchPool]);

  // ── Filter sheet ───────────────────────────────────────────────────────────

  const openFilterSheet = () => {
    setPendingMood(moodFilter);
    setPendingCuisine(cuisineFilter);
    setPendingLocation(locationFilter);
    setPendingPrice(priceFilter);
    setCuisineExpanded(false);
    setFilterOpen(true);
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };

  const closeFilterSheet = () => {
    Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
      setFilterOpen(false),
    );
  };

  const applyFilters = async () => {
    const moodChanged = pendingMood !== moodFilter;
    const cuisineChanged = pendingCuisine !== cuisineFilter;
    const priceChanged = pendingPrice !== priceFilter;
    const locationChanged = pendingLocation !== locationFilter;

    // Update local state
    if (moodChanged) setMoodFilter(pendingMood);
    if (cuisineChanged) setCuisineFilter(pendingCuisine);
    if (priceChanged) setPriceFilter(pendingPrice);
    if (locationChanged) setLocationFilter(pendingLocation);
    closeFilterSheet();

    if (!moodChanged && !cuisineChanged && !priceChanged && !locationChanged) return;

    const solo = soloSessionRef.current;
    if (!solo) return;

    // Push new settings to the server, then re-fetch the pool
    try {
      setLoading(true);
      // Reset endless state on filter change
      seenIdsRef.current = new Set();
      likedCuisinesRef.current = {};
      passedCuisinesRef.current = {};
      nextPageRef.current = 1;

      await updateSessionSettings(solo.code, {
        cuisines: pendingCuisine ? [pendingCuisine] : [],
        priceRange: pendingPrice ? [pendingPrice] : [],
      });

      const { cards: poolCards } = await fetchPool(solo.code, solo.participantId, 0, 30);
      setCards(poolCards);
      setDeckKey((k) => k + 1);
    } catch (err: any) {
      if (__DEV__) console.warn('[Tonight] filter apply error:', err?.message);
    } finally {
      setLoading(false);
    }
  };

  const clearPending = () => {
    setPendingMood(null);
    setPendingCuisine(null);
    setPendingLocation(null);
    setPendingPrice(null);
  };

  const hasFilters = !!(moodFilter || cuisineFilter || locationFilter || priceFilter);
  const hasPendingFilters = !!(pendingMood || pendingCuisine || pendingPrice);
  const pendingCount = cards.length; // approximate count for CTA

  const clearFilters = async () => {
    setMoodFilter(null);
    setCuisineFilter(null);
    setLocationFilter(null);
    setPriceFilter(null);

    const solo = soloSessionRef.current;
    if (!solo) return;

    try {
      setLoading(true);
      seenIdsRef.current = new Set();
      likedCuisinesRef.current = {};
      passedCuisinesRef.current = {};
      nextPageRef.current = 1;

      await updateSessionSettings(solo.code, { cuisines: [], priceRange: [] });
      const { cards: poolCards } = await fetchPool(solo.code, solo.participantId, 0, 30);
      setCards(poolCards);
      setDeckKey((k) => k + 1);
    } catch (err: any) {
      if (__DEV__) console.warn('[Tonight] clear filters error:', err?.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Swipe handlers ────────────────────────────────────────────────────────

  /** Track a cuisine signal from a swipe action. */
  const trackCuisineSignal = useCallback((cuisine: string, action: 'LIKE' | 'PASS') => {
    if (!cuisine) return;
    const target = action === 'LIKE' ? likedCuisinesRef.current : passedCuisinesRef.current;
    target[cuisine] = (target[cuisine] ?? 0) + 1;
  }, []);

  /** Add to shortlist + show toast. If shortlist reaches threshold, nudge. */
  const addToShortlist = useCallback((card: TonightCardModel) => {
    setShortlist((prev) => {
      if (prev.some((c) => c.restaurant.id === card.restaurant.id)) return prev;
      const next = [...prev, card].slice(-MAX_SHORTLIST);
      // Nudge decision after 3+ craves (only once per session)
      if (next.length >= 3 && !decisionPromptShown) {
        setDecisionPromptShown(true);
        // Slight delay so it doesn't overlap the toast
        setTimeout(() => setShortlistOpen(true), 1800);
      }
      return next;
    });
  }, [decisionPromptShown]);

  const handleSwipeRight = useCallback((card: TonightCardModel) => {
    trackCuisineSignal(card.restaurant.cuisine, 'LIKE');
    saveRestaurant(
      {
        place_id: card.restaurant.id,
        name: card.restaurant.name,
        cuisine: card.restaurant.cuisine || undefined,
        neighborhood: card.restaurant.neighborhood ?? undefined,
        price_level: card.restaurant.priceLevel ?? undefined,
      },
      'swipe',
    );
    const solo = soloSessionRef.current;
    if (solo) {
      postTonightSwipe(solo.code, {
        participantId: solo.participantId,
        restaurantId: card.restaurant.id,
        action: 'LIKE',
      }).catch(() => {});
    }
    addToShortlist(card);
    showToast(`\u{1F525} ${card.restaurant.name} saved`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [saveRestaurant, trackCuisineSignal, addToShortlist, showToast]);

  const handleSwipeLeft = useCallback((card: TonightCardModel) => {
    trackCuisineSignal(card.restaurant.cuisine, 'PASS');
    const solo = soloSessionRef.current;
    if (solo) {
      postTonightSwipe(solo.code, {
        participantId: solo.participantId,
        restaurantId: card.restaurant.id,
        action: 'PASS',
      }).catch(() => {});
    }
  }, [trackCuisineSignal]);

  const handleSwipeTop = useCallback((card: TonightCardModel) => {
    trackCuisineSignal(card.restaurant.cuisine, 'LIKE');
    saveRestaurant(
      {
        place_id: card.restaurant.id,
        name: card.restaurant.name,
        cuisine: card.restaurant.cuisine || undefined,
        neighborhood: card.restaurant.neighborhood ?? undefined,
        price_level: card.restaurant.priceLevel ?? undefined,
      },
      'swipe',
    );
    const solo = soloSessionRef.current;
    if (solo) {
      postTonightSwipe(solo.code, {
        participantId: solo.participantId,
        restaurantId: card.restaurant.id,
        action: 'LIKE',
      }).catch(() => {});
    }
    addToShortlist(card);
    showToast(`\u2B50 ${card.restaurant.name} saved`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [saveRestaurant, trackCuisineSignal, addToShortlist, showToast]);

  // ── Group session ─────────────────────────────────────────────────────────

  const handleCreateGroup = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createTonightSession({ settings: { priceRange: [2] } });
      setSession({ sessionId: res.sessionId, code: res.code, participantId: res.participantId });
      setInviteLink(`biteright://tonight/join?code=${res.code}`);
      router.push('/(tabs)/tonight/setup');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      setCreateError(msg || (err instanceof Error ? err.message : 'Failed to create session'));
    } finally {
      setCreating(false);
    }
  };

  /** User picks a place from the shortlist → navigate to detail (the real "decision" moment). */
  const handlePickFromShortlist = useCallback((card: TonightCardModel) => {
    setShortlistOpen(false);
    router.push(`/(tabs)/restaurant/${encodeURIComponent(card.restaurant.id)}`);
  }, [router]);

  const removeFromShortlist = useCallback((id: string) => {
    setShortlist((prev) => prev.filter((c) => c.restaurant.id !== id));
  }, []);

  // Bottom sheet translate
  const sheetTranslate = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={s.header}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.title}>Tonight</Text>
          <Text style={s.subtitle}>
            {session ? 'Swipe — your group is matching with you' : 'Pick a place to eat — together or solo'}
          </Text>
        </View>

        <View style={s.headerRight}>
          {/* Shortlist pill — visible once user has craved at least 1 */}
          {shortlist.length > 0 && (
            <TouchableOpacity
              style={s.shortlistPill}
              onPress={() => setShortlistOpen(true)}
              activeOpacity={0.8}
              accessibilityLabel={`${shortlist.length} saved tonight — tap to pick`}
              accessibilityRole={"button" as AccessibilityRole}
            >
              <Text style={s.shortlistPillEmoji}>{'\u{1F525}'}</Text>
              <Text style={s.shortlistPillCount}>{shortlist.length}</Text>
            </TouchableOpacity>
          )}

          {/* Filter icon button */}
          <View style={s.filterIconWrap}>
            <TouchableOpacity
              style={s.filterIconBtn}
              onPress={openFilterSheet}
              activeOpacity={0.8}
              accessibilityLabel="Filter restaurants"
              accessibilityRole={"button" as AccessibilityRole}
            >
              <Ionicons name="options-outline" size={17} color={colors.textMuted} />
            </TouchableOpacity>
            {hasFilters && <View style={s.filterDot} />}
          </View>

          {session ? (
            <>
              <TouchableOpacity
                style={s.groupPill}
                onPress={() => router.navigate('/(tabs)/tonight/swipe')}
                activeOpacity={0.8}
                accessibilityLabel="Group active — tap to open"
                accessibilityRole={"button" as AccessibilityRole}
              >
                <Ionicons name="people-outline" size={14} color={TN.accent} />
                <Text style={s.groupPillText}>Group active</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.iconBtn}
                onPress={() => {
                  const options = ['Invite friends', 'See matches', 'Leave group', 'Cancel'];
                  const cancelIndex = 3;
                  if (Platform.OS === 'ios') {
                    ActionSheetIOS.showActionSheetWithOptions(
                      { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: 2 },
                      (i) => {
                        if (i === 0) setInviteOpen(true);
                        else if (i === 1) router.navigate('/(tabs)/tonight/matches');
                        else if (i === 2) clearSession();
                      },
                    );
                  } else {
                    Alert.alert('Group', undefined, [
                      { text: 'Invite friends', onPress: () => setInviteOpen(true) },
                      { text: 'See matches', onPress: () => router.navigate('/(tabs)/tonight/matches') },
                      { text: 'Leave group', style: 'destructive', onPress: clearSession },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }
                }}
                activeOpacity={0.8}
                accessibilityLabel="More options"
                accessibilityRole={"button" as AccessibilityRole}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textFaint} />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={s.createGroupBtn}
              onPress={handleCreateGroup}
              disabled={creating}
              activeOpacity={0.8}
              accessibilityLabel="Create group session"
              accessibilityRole={"button" as AccessibilityRole}
            >
              {creating ? (
                <ActivityIndicator size="small" color={TN.accent} />
              ) : (
                <>
                  <Ionicons name="people-outline" size={14} color={colors.textFaint} />
                  <Text style={s.createGroupText}>Group</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {createError ? <Text style={s.errorText}>{createError}</Text> : null}

      {/* Group-swipe primary CTA — shown only when there's no active session
          so first-time users immediately see that the main point of Tonight
          is matching on a place with friends. Solo swipe deck stays below
          as the fallback / "I'll just look on my own" mode. */}
      {!session && !creating ? (
        <TouchableOpacity
          style={s.groupHeroBanner}
          onPress={handleCreateGroup}
          activeOpacity={0.88}
          accessibilityLabel="Start a group swipe session"
          accessibilityRole={"button" as AccessibilityRole}
        >
          <View style={s.groupHeroIcon}>
            <Ionicons name="people" size={20} color="#fff" />
          </View>
          <View style={s.groupHeroBody}>
            <Text style={s.groupHeroTitle}>Eating with friends?</Text>
            <Text style={s.groupHeroSub}>Start a group swipe — match on a spot together</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </TouchableOpacity>
      ) : null}

      {/* Live group progress strip — visible whenever a session is active.
          Two visual modes: an "everyone done" call-to-action when all
          participants finished, and an in-progress chip row otherwise.
          Tapping always takes the user where they want to go (matches if
          done, swipe deck if mid-session). */}
      {session ? (
        groupAllDone ? (
          <TouchableOpacity
            style={s.groupDoneBanner}
            onPress={() => router.navigate('/(tabs)/tonight/matches')}
            activeOpacity={0.88}
            accessibilityLabel="Everyone is done swiping — see matches"
            accessibilityRole={"button" as AccessibilityRole}
          >
            <Text style={s.groupDoneEmoji}>{'\u{1F389}'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.groupDoneTitle}>Everyone's done swiping!</Text>
              <Text style={s.groupDoneSub}>Tap to see your group's matches</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={s.groupProgressStrip}>
            <View style={s.groupProgressHeaderRow}>
              <View style={s.groupProgressTitleWrap}>
                <Ionicons name="people" size={14} color={TN.accent} />
                <Text style={s.groupProgressTitle}>
                  {groupDoneCount} of {groupParticipants.length || 1} done
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => router.navigate('/(tabs)/tonight/matches')}
                activeOpacity={0.7}
                hitSlop={6}
              >
                <Text style={s.groupProgressLink}>Matches so far</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.groupProgressChipsRow}
            >
              {groupParticipants.map((p) => (
                <View
                  key={p.participantId}
                  style={[s.groupProgressChip, p.doneSwiping && s.groupProgressChipDone]}
                >
                  <View style={[s.groupProgressDot, p.doneSwiping && s.groupProgressDotDone]} />
                  <Text style={[s.groupProgressChipText, p.doneSwiping && s.groupProgressChipTextDone]} numberOfLines={1}>
                    {p.displayName}
                  </Text>
                  <Text style={s.groupProgressChipCount}>
                    {p.doneSwiping ? '✓' : `${p.swipeCount}/${groupDeckSize}`}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={s.groupProgressCta}
              onPress={() => router.navigate('/(tabs)/tonight/swipe')}
              activeOpacity={0.85}
            >
              <Text style={s.groupProgressCtaText}>
                {groupDoneCount > 0 ? 'Keep swiping' : 'Start swiping'}
              </Text>
            </TouchableOpacity>
          </View>
        )
      ) : null}

      {/* ── Deck ────────────────────────────────────────────────────── */}
      <View style={s.body}>
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={TN.accent} />
            <Text style={s.loadingText}>Curating tonight's picks…</Text>
          </View>
        ) : loadError ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>Couldn't load restaurants</Text>
            <Text style={s.emptySub}>{loadError}</Text>
          </View>
        ) : cards.length === 0 && hasFilters ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyEmoji}>🍽</Text>
            <Text style={s.emptyTitle}>Nothing matching tonight</Text>
            <Text style={s.emptySub}>Try broadening your filters</Text>
            <TouchableOpacity onPress={clearFilters} activeOpacity={0.7}>
              <Text style={s.clearFilters}>Clear filters</Text>
            </TouchableOpacity>
          </View>
        ) : cards.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyEmoji}>🍽</Text>
            <Text style={s.emptyTitle}>No restaurants nearby</Text>
            <Text style={s.emptySub}>Try adjusting your location or filters</Text>
          </View>
        ) : (
          <SwipeDeck
            key={deckKey}
            cards={cards}
            onSwipedRight={handleSwipeRight}
            onSwipedLeft={handleSwipeLeft}
            onSwipedTop={handleSwipeTop}
            onRunningLow={handleRunningLow}
            runningLowThreshold={5}
            isSaved={isSaved}
          />
        )}
      </View>

      {/* ── Filter bottom sheet ──────────────────────────────────────── */}
      <Modal
        visible={filterOpen}
        transparent
        animationType="none"
        onRequestClose={closeFilterSheet}
      >
        <View style={s.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeFilterSheet} />
          <Animated.View
            style={[s.sheet, { transform: [{ translateY: sheetTranslate }], paddingBottom: Math.max(insets.bottom, 20) }]}
          >
            {/* Handle */}
            <View style={s.sheetHandle} />

            {/* Sheet header */}
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Filter Tonight</Text>
              {hasPendingFilters && (
                <TouchableOpacity onPress={clearPending} activeOpacity={0.7}>
                  <Text style={s.sheetClear}>Reset</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Mood */}
            <Text style={s.sheetSection}>What's the vibe?</Text>
            <View style={s.sheetPillsWrap}>
              {MOOD_CHIPS.map(({ label, emoji }) => {
                const active = pendingMood === label;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[s.sheetPill, active && s.sheetPillActive]}
                    onPress={() => setPendingMood(active ? null : label)}
                    activeOpacity={0.8}
                  >
                    <Text style={s.sheetPillEmoji}>{emoji}</Text>
                    <Text style={[s.sheetPillText, active && s.sheetPillTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Cuisine */}
            <Text style={s.sheetSection}>Craving something?</Text>
            <View style={s.sheetPillsWrap}>
              {(cuisineExpanded ? ALL_CUISINE_CHIPS : TOP_CUISINE_CHIPS).map((c) => {
                const active = pendingCuisine === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[s.sheetPill, active && s.sheetPillActive]}
                    onPress={() => setPendingCuisine(active ? null : c)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.sheetPillText, active && s.sheetPillTextActive]}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
              {!cuisineExpanded && (
                <TouchableOpacity
                  style={s.sheetPillMore}
                  onPress={() => setCuisineExpanded(true)}
                  activeOpacity={0.7}
                >
                  <Text style={s.sheetPillMoreText}>More…</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Price */}
            <Text style={s.sheetSection}>Budget</Text>
            <View style={s.sheetPillsWrap}>
              {PRICE_CHIPS.map(({ label, value }) => {
                const active = pendingPrice === value;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[s.sheetPricePill, active && s.sheetPillActive]}
                    onPress={() => setPendingPrice(active ? null : value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.sheetPricePillText, active && s.sheetPillTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* CTA */}
            <TouchableOpacity style={s.applyBtn} onPress={applyFilters} activeOpacity={0.85}>
              <Text style={s.applyBtnText}>
                {hasPendingFilters ? `Show ${pendingCount} spots` : 'Show all spots'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Invite modal ─────────────────────────────────────────────── */}
      <Modal
        visible={inviteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteOpen(false)}
      >
        <TouchableOpacity
          style={s.modalBackdrop}
          activeOpacity={1}
          onPress={() => setInviteOpen(false)}
        >
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Invite friends</Text>
            <Text style={s.modalCode}>{session?.code ?? ''}</Text>
            <Text style={s.modalLink} numberOfLines={1}>
              {inviteLink ?? (session?.code ? `biteright://tonight/join?code=${session.code}` : '')}
            </Text>
            <View style={s.modalBtns}>
              <TouchableOpacity
                style={s.modalBtn}
                activeOpacity={0.85}
                accessibilityLabel="Copy invite link"
                onPress={async () => {
                  const link = inviteLink ?? (session?.code ? `biteright://tonight/join?code=${session.code}` : null);
                  if (!link) return;
                  await Clipboard.setStringAsync(link);
                  Alert.alert('Copied', 'Invite link copied.');
                }}
              >
                <Text style={s.modalBtnText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.modalBtn}
                activeOpacity={0.85}
                accessibilityLabel="Share invite link"
                onPress={() => {
                  const link = inviteLink ?? (session?.code ? `biteright://tonight/join?code=${session.code}` : null);
                  if (!link) return;
                  Share.share({ message: link }).catch(() => {});
                }}
              >
                <Text style={s.modalBtnText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { borderColor: 'transparent', backgroundColor: 'transparent' }]}
                activeOpacity={0.85}
                accessibilityLabel="Close"
                onPress={() => setInviteOpen(false)}
              >
                <Text style={[s.modalBtnText, { color: TN.textMuted }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Toast (inline swipe feedback) ─────────────────────────────── */}
      {toastText ? (
        <Animated.View style={[s.toast, { opacity: toastOpacity }]} pointerEvents="none">
          <Text style={s.toastText}>{toastText}</Text>
        </Animated.View>
      ) : null}

      {/* ── Shortlist decision sheet ──────────────────────────────────── */}
      <Modal
        visible={shortlistOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setShortlistOpen(false)}
      >
        <Pressable style={s.shortlistBackdrop} onPress={() => setShortlistOpen(false)}>
          <Pressable style={[s.shortlistSheet, { paddingBottom: Math.max(insets.bottom, 20) }]} onPress={() => {}}>
            <View style={s.shortlistHandle} />
            <Text style={s.shortlistTitle}>
              {shortlist.length >= 3
                ? 'You\u2019ve got great options tonight'
                : 'Tonight\u2019s shortlist'}
            </Text>
            <Text style={s.shortlistSub}>Tap a place to see details and decide</Text>

            <FlatList
              data={shortlist}
              keyExtractor={(item) => item.restaurant.id}
              scrollEnabled={shortlist.length > 3}
              showsVerticalScrollIndicator={false}
              style={s.shortlistList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.shortlistRow}
                  onPress={() => handlePickFromShortlist(item)}
                  activeOpacity={0.8}
                >
                  <View style={s.shortlistRowLeft}>
                    <Text style={s.shortlistEmoji}>{'\u{1F525}'}</Text>
                    <View style={s.shortlistRowText}>
                      <Text style={s.shortlistName} numberOfLines={1}>{item.restaurant.name}</Text>
                      <Text style={s.shortlistMeta} numberOfLines={1}>
                        {[item.restaurant.cuisine, item.restaurant.neighborhood].filter(Boolean).join(' \u00B7 ')}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeFromShortlist(item.restaurant.id)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={0.6}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.textFaint} />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity
              style={s.shortlistKeepBtn}
              onPress={() => setShortlistOpen(false)}
              activeOpacity={0.8}
            >
              <Text style={s.shortlistKeepText}>Keep swiping</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.textMuted,
    letterSpacing: -0.1,
  },
  groupHeroBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.accent,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  groupHeroIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupHeroBody: { flex: 1, gap: 1 },
  groupHeroTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
  },
  groupHeroSub: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: -0.1,
  },
  groupProgressStrip: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  groupProgressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupProgressTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupProgressTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  groupProgressLink: {
    fontSize: 13,
    fontWeight: '700',
    color: TN.accent,
  },
  groupProgressChipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  groupProgressChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  groupProgressChipDone: {
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderColor: 'rgba(34,197,94,0.45)',
  },
  groupProgressDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.border,
  },
  groupProgressDotDone: {
    backgroundColor: '#22c55e',
  },
  groupProgressChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.text,
    maxWidth: 90,
  },
  groupProgressChipTextDone: {
    color: '#15803d',
  },
  groupProgressChipCount: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  groupProgressCta: {
    backgroundColor: TN.accent,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  groupProgressCtaText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
  },
  groupDoneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.accent,
    shadowColor: 'rgba(0,0,0,0.12)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  groupDoneEmoji: { fontSize: 28 },
  groupDoneTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
  },
  groupDoneSub: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.9)',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterIconWrap: {
    position: 'relative',
  },
  filterIconBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TN.accent,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  groupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,107,53,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.35)',
  },
  groupPillText: { fontSize: 12, fontWeight: '600', color: TN.accent },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  createGroupText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  errorText: {
    marginHorizontal: 20,
    marginBottom: 4,
    fontSize: 12,
    color: TN.nope,
  },

  // ── Body ──
  body: { flex: 1, alignItems: 'center', paddingTop: 2 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: colors.textMuted },

  // ── Empty state ──
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 6,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 8 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 4,
  },
  clearFilters: {
    fontSize: 14,
    fontWeight: '700',
    color: TN.accent,
    marginTop: 4,
  },

  // ── Filter bottom sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  sheetClear: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
  },
  sheetSection: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  sheetPillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  sheetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  sheetPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  sheetPillEmoji: {
    fontSize: 15,
  },
  sheetPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sheetPillTextActive: {
    color: '#fff',
  },
  sheetPillMore: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  sheetPillMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  sheetPricePill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  sheetPricePillText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  applyBtn: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  applyBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },

  // ── Invite modal ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopColor: TN.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TN.text,
    marginBottom: 10,
  },
  modalCode: {
    fontSize: 28,
    fontWeight: '900',
    color: TN.accent,
    letterSpacing: 3,
    marginBottom: 6,
  },
  modalLink: {
    fontSize: 12,
    color: TN.textMuted,
    marginBottom: 20,
  },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderColor: TN.border,
    alignItems: 'center',
  },
  modalBtnText: { fontSize: 13, fontWeight: '700', color: TN.text },

  // ── Toast ──
  toast: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.text,
    borderWidth: 1,
    borderColor: colors.text,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.bg,
  },

  // ── Shortlist pill (header) ──
  shortlistPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,107,53,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.35)',
  },
  shortlistPillEmoji: { fontSize: 13 },
  shortlistPillCount: { fontSize: 13, fontWeight: '800', color: TN.accent },

  // ── Shortlist decision sheet ──
  shortlistBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  shortlistSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '65%',
  },
  shortlistHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  shortlistTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
  },
  shortlistSub: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 16,
  },
  shortlistList: {
    maxHeight: 280,
  },
  shortlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.bgSoft,
    marginBottom: 8,
  },
  shortlistRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 12,
  },
  shortlistEmoji: { fontSize: 18 },
  shortlistRowText: { flex: 1 },
  shortlistName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  shortlistMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  shortlistKeepBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  shortlistKeepText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
