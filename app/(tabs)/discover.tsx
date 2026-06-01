import { Ionicons } from '@expo/vector-icons';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiscover, type DiscoverSectionItems } from '~/src/hooks/useDiscover';
import { RestaurantCard } from '~/src/components/RestaurantCard';
import { POPULAR_LOCATIONS, type DiscoverSelectedLocation } from '~/src/components/DiscoverLocationBar';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { useFeedContext } from '~/src/context/FeedContext';
import { colors } from '~/src/theme/colors';
import { apiClient } from '~/src/api/client';
import { getDiscover, type DiscoverRecommendation, type DiscoverSections, type DiscoverSortMode, type DiscoverOccasion } from '~/src/api/discover';
import type { DiscoverItem } from '~/src/components/RestaurantCard';
import Slider from '@react-native-community/slider';

// ─── Cuisine chips (dynamically ordered — "For you" first, then by popularity) ─
// \u2500\u2500\u2500 Personalized chip ordering \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Builds a chip list from the user's logs, weighted by rating, padded with
// popular defaults. Used in place of the static CUISINE_CHIPS at render time.

interface CuisineChip { label: string; emoji: string }

const CHIP_CATALOG: Record<string, CuisineChip> = {
  Ramen:         { label: 'Ramen',         emoji: '\u{1F35C}' },
  Sushi:         { label: 'Sushi',         emoji: '\u{1F363}' },
  Tacos:         { label: 'Tacos',         emoji: '\u{1F32E}' },
  Pizza:         { label: 'Pizza',         emoji: '\u{1F355}' },
  Coffee:        { label: 'Coffee',        emoji: '\u2615' },
  Burgers:       { label: 'Burgers',       emoji: '\u{1F354}' },
  Dessert:       { label: 'Dessert',       emoji: '\u{1F370}' },
  Thai:          { label: 'Thai',          emoji: '\u{1F966}' },
  Indian:        { label: 'Indian',        emoji: '\u{1F35B}' },
  Italian:       { label: 'Italian',       emoji: '\u{1F35D}' },
  Mexican:       { label: 'Mexican',       emoji: '\u{1F32E}' },
  Korean:        { label: 'Korean',        emoji: '\u{1F372}' },
  Japanese:      { label: 'Japanese',      emoji: '\u{1F363}' },
  Chinese:       { label: 'Chinese',       emoji: '\u{1F961}' },
  Vietnamese:    { label: 'Vietnamese',    emoji: '\u{1F35C}' },
  Mediterranean: { label: 'Mediterranean', emoji: '\u{1F957}' },
  Greek:         { label: 'Greek',         emoji: '\u{1F957}' },
  BBQ:           { label: 'BBQ',           emoji: '\u{1F356}' },
  Steakhouse:    { label: 'Steakhouse',    emoji: '\u{1F969}' },
  Seafood:       { label: 'Seafood',       emoji: '\u{1F99E}' },
  Brunch:        { label: 'Brunch',        emoji: '\u{1F95E}' },
};

const DEFAULT_CHIP_LABELS = ['Ramen', 'Sushi', 'Tacos', 'Pizza', 'Coffee', 'Burgers', 'Dessert', 'Thai', 'Indian'];

// First match wins. Specific terms before general ones.
const CUISINE_TO_CHIP_PATTERNS: { pattern: RegExp; chip: string }[] = [
  { pattern: /\b(ramen|udon|soba|noodle)\b/i,                  chip: 'Ramen' },
  { pattern: /\b(sushi|nigiri|sashimi|omakase|maki)\b/i,       chip: 'Sushi' },
  { pattern: /\b(taco|taqueria|burrito|quesadilla)\b/i,        chip: 'Tacos' },
  { pattern: /\b(pizza|pizzeria|deep dish)\b/i,                chip: 'Pizza' },
  { pattern: /\b(burger|smash|patty)\b/i,                      chip: 'Burgers' },
  { pattern: /\b(coffee|cafe|caf[e\u00e9]|espresso|latte)\b/i,      chip: 'Coffee' },
  { pattern: /\b(bakery|pastry|donut|doughnut)\b/i,            chip: 'Dessert' },
  { pattern: /\b(ice cream|gelato|dessert|cake|cookie)\b/i,    chip: 'Dessert' },
  { pattern: /\b(thai|pad thai|tom yum)\b/i,                   chip: 'Thai' },
  { pattern: /\b(indian|tandoori|curry|biryani)\b/i,           chip: 'Indian' },
  { pattern: /\b(italian|pasta|cacio|carbonara|trattoria)\b/i, chip: 'Italian' },
  { pattern: /\b(mexican)\b/i,                                 chip: 'Mexican' },
  { pattern: /\b(korean|bulgogi|kimchi|bibimbap)\b/i,          chip: 'Korean' },
  { pattern: /\b(japanese)\b/i,                                chip: 'Japanese' },
  { pattern: /\b(chinese|dim sum|dumpling)\b/i,                chip: 'Chinese' },
  { pattern: /\b(vietnamese|pho|banh mi)\b/i,                  chip: 'Vietnamese' },
  { pattern: /\b(greek)\b/i,                                   chip: 'Greek' },
  { pattern: /\b(mediterranean|falafel|hummus|kebab)\b/i,      chip: 'Mediterranean' },
  { pattern: /\b(bbq|barbecue|smokehouse|brisket)\b/i,         chip: 'BBQ' },
  { pattern: /\b(steakhouse|steak|ribeye|wagyu)\b/i,           chip: 'Steakhouse' },
  { pattern: /\b(seafood|oyster|lobster|crab)\b/i,             chip: 'Seafood' },
  { pattern: /\b(brunch|breakfast|pancake|waffle)\b/i,         chip: 'Brunch' },
];

const CURRENT_USER_NAME_DISCOVER = 'You';
const MIN_LOG_SCORE_FOR_PREFERENCE = 7; // one-off mediocre visits don't pollute taste signal
const MAX_PERSONALIZED_CHIPS = 6;
const TOTAL_CHIPS_TARGET = 9;

function mapCuisineToChip(cuisine: string | null | undefined): string | null {
  if (!cuisine) return null;
  for (const { pattern, chip } of CUISINE_TO_CHIP_PATTERNS) {
    if (pattern.test(cuisine)) return chip;
  }
  return null;
}

/** "For you" + personalized cuisines (weighted by rating) + default padding. */
function buildPersonalizedChips(myLogs: { cuisine?: string; score?: number }[]): CuisineChip[] {
  const weights = new Map<string, number>();
  for (const log of myLogs) {
    if ((log.score ?? 0) < MIN_LOG_SCORE_FOR_PREFERENCE) continue;
    const chipLabel = mapCuisineToChip(log.cuisine);
    if (!chipLabel || !CHIP_CATALOG[chipLabel]) continue;
    // Smooth weight: 7\u21921, 8\u21922, 9\u21923, 10\u21924
    const weight = 1 + Math.max(0, (log.score ?? 7) - MIN_LOG_SCORE_FOR_PREFERENCE);
    weights.set(chipLabel, (weights.get(chipLabel) || 0) + weight);
  }
  const personalized = Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PERSONALIZED_CHIPS)
    .map(([label]) => label);

  const order: string[] = [...personalized];
  for (const def of DEFAULT_CHIP_LABELS) {
    if (order.length >= TOTAL_CHIPS_TARGET) break;
    if (!order.includes(def)) order.push(def);
  }

  return [
    { label: 'For you', emoji: '\u2728' },
    ...order.map((label) => CHIP_CATALOG[label]).filter(Boolean),
  ];
}

const TRENDING_CATEGORIES = [
  { label: 'Ramen', icon: 'restaurant-outline' as const },
  { label: 'Pizza', icon: 'pizza-outline' as const },
  { label: 'Sushi', icon: 'fish-outline' as const },
  { label: 'Coffee', icon: 'cafe-outline' as const },
  { label: 'Tacos', icon: 'fast-food-outline' as const },
];

// ─── Filter chips (personality-driven, not dropdown-style) ──────────────────

const VIBE_CHIPS: { label: string; emoji: string; sort?: DiscoverSortMode; occasion?: DiscoverOccasion; prices?: number[] }[] = [
  { label: 'Popular', emoji: '\u{1F525}', sort: 'popular' },
  { label: 'Nearest', emoji: '\u{1F4CD}', sort: 'nearest' },
  { label: 'Top rated', emoji: '\u{2B50}', sort: 'rating' },
  { label: 'Budget', emoji: '\u{1F4B8}', prices: [1, 2] },
  { label: 'Date night', emoji: '\u{1F377}', occasion: 'dinner' },
  { label: 'New spots', emoji: '\u{1F195}', sort: 'new' },
  { label: 'Late night', emoji: '\u{1F319}', occasion: 'late_night' },
];

// Radius range: 1–30 mi (slider only, no presets)

// ─── Rotating search placeholders ──────────────────────────────────────────
// Single, explicit placeholder. Rotation through craving-style prompts
// made it ambiguous whether you could search by restaurant name \u2014 users
// were reading "What are you craving?" and not realizing they could type
// "Au Cheval" directly. The static line + the persistent helper text
// below the bar communicate the three searchable axes at all times.
const SEARCH_PLACEHOLDERS = [
  'Try \u201cAu Cheval\u201d, \u201ctacos\u201d, or \u201cItalian\u201d',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const EMPTY_SECTIONS: DiscoverSectionItems = {
  topPicksForYou: [],
  becauseYouLiked: [],
  trendingWithSimilarUsers: [],
  allNearby: [],
};

function ensureAbsoluteImageUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('http')) return url;
  const base = apiClient.defaults.baseURL || '';
  return base
    ? `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`
    : url;
}

function recToItem(rec: DiscoverRecommendation): DiscoverItem {
  return {
    restaurant: {
      id: rec.restaurant.id,
      name: rec.restaurant.name,
      cuisine: rec.restaurant.cuisine ?? '',
      cuisines: rec.restaurant.cuisines,
      neighborhood: rec.restaurant.neighborhood,
      priceLevel: rec.restaurant.priceLevel,
      lat: rec.restaurant.lat ?? null,
      lng: rec.restaurant.lng ?? null,
      placeId: rec.restaurant.placeId,
      googlePlaceId: rec.restaurant.googlePlaceId,
      displayImageUrl: ensureAbsoluteImageUrl(
        rec.restaurant.displayImageUrl ?? rec.restaurant.imageUrl ?? rec.restaurant.previewPhotoUrl,
      ),
      displayImageSourceType: rec.restaurant.displayImageSourceType ?? null,
      displayImageLastResolvedAt: rec.restaurant.displayImageLastResolvedAt ?? null,
      previewPhotoUrl: ensureAbsoluteImageUrl(rec.restaurant.previewPhotoUrl),
      imageUrl: ensureAbsoluteImageUrl(rec.restaurant.imageUrl),
      recommendedDishes: rec.restaurant.recommendedDishes ?? null,
    },
    matchScore: rec.percentMatch / 100,
    reasonTags: rec.explanations,
    socialProofBadge: rec.socialProofBadge ?? null,
  };
}

function sectionsToItems(sections: DiscoverSections | undefined): DiscoverSectionItems {
  if (!sections) return EMPTY_SECTIONS;
  return {
    topPicksForYou: (sections.topPicksForYou || []).map(recToItem),
    becauseYouLiked: (sections.becauseYouLiked || []).map(recToItem),
    trendingWithSimilarUsers: (sections.trendingWithSimilarUsers || []).map(recToItem),
    allNearby: (sections.allNearby || []).map(recToItem),
  };
}

type GeoSuggestion = { label: string; lat: number; lng: number };

function priceLabel(levels: number[]): string {
  if (levels.length === 0) return 'Price';
  return levels.map((l) => '$'.repeat(l)).join(', ');
}

function radiusLabel(mi: number): string {
  return mi < 1 ? `${mi} mi` : `${Math.round(mi)} mi`;
}

/** Simple urban heuristic: if we're in a dense area, default to smaller radius. */
function defaultRadius(lat?: number, lng?: number): number {
  // Major dense US cities (rough bbox checks)
  if (lat != null && lng != null) {
    const dense = (
      (lat > 40.5 && lat < 40.9 && lng > -74.1 && lng < -73.7) || // NYC
      (lat > 41.7 && lat < 42.0 && lng > -87.8 && lng < -87.5) || // Chicago
      (lat > 37.7 && lat < 37.85 && lng > -122.55 && lng < -122.35) || // SF
      (lat > 34.0 && lat < 34.1 && lng > -118.35 && lng < -118.15) || // LA Downtown
      (lat > 47.55 && lat < 47.7 && lng > -122.4 && lng < -122.25) || // Seattle
      (lat > 42.3 && lat < 42.4 && lng > -71.15 && lng < -71.0) // Boston
    );
    if (dense) return 1;
  }
  return 5;
}

// Apply client-side price filter to sections
function filterByPrice(sections: DiscoverSectionItems, prices: number[]): DiscoverSectionItems {
  if (prices.length === 0) return sections;
  const priceSet = new Set(prices);
  const filter = (items: DiscoverItem[]) =>
    items.filter((item) => {
      const pl = item.restaurant.priceLevel;
      return pl != null && priceSet.has(pl);
    });
  return {
    topPicksForYou: filter(sections.topPicksForYou),
    becauseYouLiked: filter(sections.becauseYouLiked),
    trendingWithSimilarUsers: filter(sections.trendingWithSimilarUsers),
    allNearby: filter(sections.allNearby),
  };
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { items: feedItems } = useFeedContext();

  // Personalized chip ordering — recomputes when the user logs a new visit.
  const cuisineChips = useMemo(() => {
    const myLogs = feedItems
      .filter((log) => log.userName === CURRENT_USER_NAME_DISCOVER)
      .map((log) => ({ cuisine: log.cuisine, score: log.score }));
    return buildPersonalizedChips(myLogs);
  }, [feedItems]);

  // ── Search ─────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const trimmed = searchInput.trim();
    searchDebounceRef.current = setTimeout(() => setActiveSearch(trimmed), 350);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchInput]);

  // ── Filters ────────────────────────────────────────────────────────────
  const [sortMode, setSortMode] = useState<DiscoverSortMode>('best');
  const [selectedPrices, setSelectedPrices] = useState<number[]>([]);
  const [radiusMiles, setRadiusMiles] = useState<number | null>(null); // null = use default
  const [selectedOccasion, setSelectedOccasion] = useState<DiscoverOccasion | null>(null);
  const [activeVibeIndex, setActiveVibeIndex] = useState<number | null>(null);
  const [pendingRadius, setPendingRadius] = useState(5);
  const radiusSlideAnim = useRef(new Animated.Value(0)).current;

  // Rotating placeholder
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % SEARCH_PLACEHOLDERS.length), 4000);
    return () => clearInterval(id);
  }, []);

  // ── Base hook: GPS + default nearby results ────────────────────────────
  const {
    sections: baseSections,
    loading: baseLoading,
    error: baseError,
    isColdStart,
    userCoords,
  } = useDiscover('you');
  const { isSaved } = useSavedRestaurants();

  // Initialize default radius from location
  useEffect(() => {
    if (radiusMiles == null && userCoords) {
      setRadiusMiles(defaultRadius(userCoords.lat, userCoords.lng));
    }
  }, [userCoords, radiusMiles]);

  const effectiveRadius = radiusMiles ?? defaultRadius(userCoords?.lat, userCoords?.lng);

  // ── Location override ──────────────────────────────────────────────────
  const [customLocation, setCustomLocation] = useState<DiscoverSelectedLocation | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [locationInput, setLocationInput] = useState('');
  const [geoSuggestions, setGeoSuggestions] = useState<GeoSuggestion[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const geoReqRef = useRef(0);

  const effectiveCoords = useMemo(() => {
    if (customLocation) return { lat: customLocation.lat, lng: customLocation.lng };
    return userCoords;
  }, [customLocation, userCoords]);

  const locationLabel = customLocation?.label ?? (userCoords ? 'Current location' : null);
  const locationName = customLocation?.label ?? null;

  // ── Overlay results (search and/or custom location) ────────────────────
  const [overlayResults, setOverlayResults] = useState<DiscoverSectionItems>(EMPTY_SECTIONS);
  const [overlayLoading, setOverlayLoading] = useState(false);

  const needsOverlay = Boolean(activeSearch || customLocation || sortMode !== 'best' || radiusMiles != null || selectedOccasion);

  // Single unified fetch when search, location, sort, or radius changes
  useEffect(() => {
    if (!needsOverlay) {
      setOverlayResults(EMPTY_SECTIONS);
      setOverlayLoading(false);
      return;
    }
    const coords = effectiveCoords;
    if (!coords) return;

    let cancelled = false;
    setOverlayLoading(true);

    getDiscover({
      mode: customLocation ? 'location' : 'nearby',
      userId: 'default',
      lat: coords.lat,
      lng: coords.lng,
      query: customLocation?.label,
      radiusMiles: effectiveRadius,
      search: activeSearch || undefined,
      sortMode,
      occasion: selectedOccasion,
    })
      .then((res) => {
        if (cancelled) return;
        setOverlayResults(sectionsToItems(res.sections));
      })
      .catch(() => {
        if (!cancelled) setOverlayResults(EMPTY_SECTIONS);
      })
      .finally(() => {
        if (!cancelled) setOverlayLoading(false);
      });

    return () => { cancelled = true; };
  }, [needsOverlay, activeSearch, effectiveCoords, customLocation, sortMode, effectiveRadius, selectedOccasion]);

  // ── Geo autocomplete ───────────────────────────────────────────────────
  useEffect(() => {
    if (!locationPickerOpen) return;
    const q = locationInput.trim();
    if (!q) { setGeoSuggestions([]); setGeoLoading(false); return; }
    setGeoLoading(true);
    const reqId = ++geoReqRef.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get<{ results: GeoSuggestion[] }>('/api/geo/autocomplete', {
          params: { query: q },
        });
        if (geoReqRef.current !== reqId) return;
        setGeoSuggestions(Array.isArray(data?.results) ? data.results : []);
      } catch {
        if (geoReqRef.current !== reqId) return;
        setGeoSuggestions([]);
      } finally {
        if (geoReqRef.current !== reqId) return;
        setGeoLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [locationPickerOpen, locationInput]);

  const selectLocation = useCallback((loc: DiscoverSelectedLocation) => {
    setCustomLocation(loc);
    setLocationInput('');
  }, []);

  // ── Unified location sheet ──────────────────────────────────────────────
  const openLocationSheet = () => {
    setPendingRadius(effectiveRadius);
    setLocationPickerOpen(true);
    Animated.spring(radiusSlideAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };

  const closeLocationSheet = () => {
    Animated.timing(radiusSlideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setLocationPickerOpen(false);
      setLocationInput('');
    });
  };

  const applyLocationSheet = () => {
    setRadiusMiles(pendingRadius);
    closeLocationSheet();
  };

  const radiusSheetTranslate = radiusSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  // ── Toggle vibe chip ─────────────────────────────────────────────────────
  const toggleVibeChip = (index: number) => {
    if (activeVibeIndex === index) {
      // Deactivate
      setActiveVibeIndex(null);
      setSortMode('best');
      setSelectedPrices([]);
      setSelectedOccasion(null);
    } else {
      // Activate this chip
      setActiveVibeIndex(index);
      const chip = VIBE_CHIPS[index];
      setSortMode(chip.sort ?? 'best');
      setSelectedPrices(chip.prices ?? []);
      setSelectedOccasion(chip.occasion ?? null);
    }
  };

  // ── Resolved display state ─────────────────────────────────────────────
  const rawSections = needsOverlay ? overlayResults : baseSections;
  const visibleSections = filterByPrice(rawSections, selectedPrices);
  const showLoading = needsOverlay ? overlayLoading : baseLoading;

  const hasAnyCards =
    visibleSections.topPicksForYou.length > 0 ||
    visibleSections.becauseYouLiked.length > 0 ||
    visibleSections.trendingWithSimilarUsers.length > 0 ||
    visibleSections.allNearby.length > 0;

  const hasActiveFilters = selectedPrices.length > 0 || sortMode !== 'best' || selectedOccasion != null || (radiusMiles != null && radiusMiles !== defaultRadius(userCoords?.lat, userCoords?.lng));

  const clearAllFilters = () => {
    setSortMode('best');
    setSelectedPrices([]);
    setRadiusMiles(null);
    setSelectedOccasion(null);
    setActiveVibeIndex(null);
  };

  // ── Dynamic headings (personality-driven) ─────────────────────────────
  const loc = locationName;
  const radiusStr = effectiveRadius < 1 ? `${effectiveRadius} miles` : `${Math.round(effectiveRadius)} miles`;
  const activeVibeLabel = activeVibeIndex != null ? VIBE_CHIPS[activeVibeIndex].label : null;

  // Build context-aware heading prefix
  const searchContext = activeSearch || null;

  const topPicksTitle = searchContext
    ? loc ? `${searchContext} in ${loc}` : `${searchContext} near you`
    : activeVibeLabel
    ? `${activeVibeLabel} spots`
    : loc ? `You\u2019ll love these` : 'You\u2019ll probably love these \u{1F440}';

  const topPicksSub = activeSearch
    ? `Showing results for \u201C${activeSearch}\u201D`
    : activeVibeLabel ? `${activeVibeLabel} picks curated for you`
    : isColdStart ? 'Popular picks while we learn your taste' : 'Handpicked based on your taste';

  const trendingTitle = searchContext
    ? loc ? `More ${searchContext} in ${loc}` : `More ${searchContext}`
    : 'Hot near you \u{1F525}';

  const trendingSub = activeSearch ? 'Top rated matches' : 'People like you are loving these';

  const allTitle = searchContext
    ? loc ? `All ${searchContext} in ${loc}` : `All ${searchContext} nearby`
    : 'More to explore';

  const allSub = activeSearch
    ? `Within ${radiusStr}`
    : `Everything within ${radiusStr}`;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {!searchFocused && (
          <View style={styles.topRow}>
            <Text style={styles.title}>Discover</Text>
            <TouchableOpacity
              style={styles.locationPill}
              onPress={openLocationSheet}
              activeOpacity={0.7}
            >
              <Ionicons name="location-sharp" size={13} color={colors.accent} />
              <Text style={styles.locationPillLabel} numberOfLines={1}>
                {customLocation?.label ?? (userCoords ? 'Near you' : 'Set location')}
              </Text>
              <View style={styles.locationPillDot} />
              <Text style={styles.locationPillRadius}>{radiusLabel(effectiveRadius)}</Text>
              <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Search bar — hero element with location merged in */}
        <View style={[styles.searchBarWrap, searchFocused && styles.searchBarFocused]}>
          <Ionicons name="search-outline" size={18} color={searchFocused ? colors.accent : colors.textMuted} />
          <TextInput
            ref={searchInputRef}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder={SEARCH_PLACEHOLDERS[placeholderIdx]}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            returnKeyType="search"
            onFocus={() => setSearchFocused(true)}
            onSubmitEditing={() => { setActiveSearch(searchInput.trim()); setSearchFocused(false); }}
          />
          {searchInput.length > 0 && (
            <TouchableOpacity
              onPress={() => { setSearchInput(''); setActiveSearch(''); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.searchClear}
            >
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {searchFocused && (
            <TouchableOpacity
              onPress={() => { setSearchFocused(false); searchInputRef.current?.blur(); }}
              hitSlop={8}
              style={styles.searchCancelBtn}
            >
              <Text style={styles.searchCancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Persistent helper text — always visible below the search bar,
            even when not focused. Rotating placeholders weren't sticky
            enough; this stays put so the three searchable axes (restaurant
            name / dish / cuisine) read at a glance. */}
        {!searchFocused && !activeSearch ? (
          <Text style={styles.searchAxisHelper}>
            Search restaurants, dishes, or cuisines
          </Text>
        ) : null}

        {/* ── Search focus panel ── */}
        {searchFocused && !searchInput.trim() && (
          <ScrollView style={styles.focusPanel} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Search-axis hint — surfaces what's typeable. The "Trending"
                / "Popular searches" sections below this hint at cuisines and
                vibes only; without this row, users wouldn't know they can
                type a restaurant name directly. */}
            <View style={styles.focusHintRow}>
              <Ionicons name="sparkles-outline" size={13} color={colors.accent} />
              <Text style={styles.focusHintText}>
                Search a restaurant, dish, or cuisine
              </Text>
            </View>

            {/* Change location */}
            <TouchableOpacity
              style={styles.focusLocationRow}
              onPress={() => { setSearchFocused(false); searchInputRef.current?.blur(); openLocationSheet(); }}
              activeOpacity={0.6}
            >
              <Ionicons name="location-sharp" size={14} color={colors.accent} />
              <Text style={styles.focusLocationText} numberOfLines={1}>
                {locationLabel ?? 'Set your location'}
              </Text>
              <Text style={styles.focusLocationChange}>Change</Text>
            </TouchableOpacity>

            {/* Trending categories */}
            <Text style={styles.focusSectionTitle}>Trending nearby</Text>
            <View style={styles.focusCategoryGrid}>
              {TRENDING_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.label}
                  style={styles.focusCategoryChip}
                  onPress={() => { setSearchInput(cat.label); setActiveSearch(cat.label); setSearchFocused(false); searchInputRef.current?.blur(); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name={cat.icon} size={16} color={colors.accent} />
                  <Text style={styles.focusCategoryText}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Popular searches */}
            <Text style={styles.focusSectionTitle}>Popular searches</Text>
            {['Best brunch', 'Date night', 'Late night eats', 'Cheap eats'].map((term) => (
              <TouchableOpacity
                key={term}
                style={styles.focusSearchRow}
                onPress={() => { setSearchInput(term); setActiveSearch(term); setSearchFocused(false); searchInputRef.current?.blur(); }}
                activeOpacity={0.6}
              >
                <Ionicons name="trending-up-outline" size={16} color={colors.textFaint} />
                <Text style={styles.focusSearchText}>{term}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Sorting tabs — lightweight text, secondary to cuisine chips */}
        {!searchFocused && (
          <View style={styles.sortRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortTabs}>
              {VIBE_CHIPS.map((chip, i) => {
                const active = activeVibeIndex === i;
                return (
                  <TouchableOpacity
                    key={chip.label}
                    style={[styles.sortTab, active && styles.sortTabActive]}
                    onPress={() => toggleVibeChip(i)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.sortTabText, active && styles.sortTabTextActive]}>
                      {chip.emoji} {chip.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {hasActiveFilters && (
              <TouchableOpacity onPress={clearAllFilters} activeOpacity={0.7} style={styles.clearAllBtn} hitSlop={8}>
                <Ionicons name="close-circle" size={14} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Cuisine chips with leading "For you" */}
        {!searchFocused && (
          <View style={styles.chipsRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
              {cuisineChips.map((chip) => {
                const isForYou = chip.label === 'For you';
                const active = isForYou
                  ? !activeSearch
                  : activeSearch.toLowerCase() === chip.label.toLowerCase();
                return (
                  <TouchableOpacity
                    key={chip.label}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => {
                      if (isForYou) { setSearchInput(''); setActiveSearch(''); }
                      else if (active) { setSearchInput(''); setActiveSearch(''); }
                      else { setSearchInput(chip.label); setActiveSearch(chip.label); }
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipEmoji, active && styles.chipEmojiActive]}>{chip.emoji}</Text>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {searchFocused ? null : showLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : !locationLabel ? (
        <View style={styles.centered}>
          <Ionicons name="location-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyMessage}>Set your location to start exploring</Text>
          <TouchableOpacity onPress={openLocationSheet} style={styles.setLocationBtn}>
            <Text style={styles.setLocationBtnText}>Set location</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {baseError && !activeSearch && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{baseError}</Text>
            </View>
          )}
          {hasAnyCards ? (
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {visibleSections.topPicksForYou.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{topPicksTitle}</Text>
                  <Text style={styles.sectionSubtitle}>{topPicksSub}</Text>
                  {visibleSections.topPicksForYou.map((item, i) => (
                    <RestaurantCard key={item.restaurant.id} item={item} saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)} userCoords={effectiveCoords} animDelay={i * 60} />
                  ))}
                </View>
              )}
              {visibleSections.becauseYouLiked.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Because you have taste {'\u{1F48E}'}</Text>
                  <Text style={styles.sectionSubtitle}>More like your favorites</Text>
                  {visibleSections.becauseYouLiked.map((item) => (
                    <RestaurantCard key={item.restaurant.id} item={item} saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)} userCoords={effectiveCoords} />
                  ))}
                </View>
              )}
              {visibleSections.trendingWithSimilarUsers.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{trendingTitle}</Text>
                  <Text style={styles.sectionSubtitle}>{trendingSub}</Text>
                  {visibleSections.trendingWithSimilarUsers.map((item) => (
                    <RestaurantCard key={item.restaurant.id} item={item} saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)} userCoords={effectiveCoords} />
                  ))}
                </View>
              )}
              {(() => {
                const seenIds = new Set([
                  ...visibleSections.topPicksForYou.map((i) => i.restaurant.id),
                  ...visibleSections.becauseYouLiked.map((i) => i.restaurant.id),
                  ...visibleSections.trendingWithSimilarUsers.map((i) => i.restaurant.id),
                ]);
                const remaining = visibleSections.allNearby.filter((item) => !seenIds.has(item.restaurant.id));
                if (remaining.length === 0 && visibleSections.allNearby.length > 0) return null;
                return (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{allTitle}</Text>
                    <Text style={styles.sectionSubtitle}>{allSub}</Text>
                    {(remaining.length > 0 ? remaining : visibleSections.allNearby).map((item) => (
                      <RestaurantCard key={item.restaurant.id} item={item} saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)} userCoords={effectiveCoords} />
                    ))}
                  </View>
                );
              })()}
            </ScrollView>
          ) : (
            <View style={styles.centered}>
              {activeSearch ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyMessage}>
                    {locationName ? `No "${activeSearch}" results in ${locationName}` : `No results for "${activeSearch}" nearby`}
                  </Text>
                  <Text style={styles.emptyHint}>Try a different search term or clear your search.</Text>
                  <TouchableOpacity onPress={() => { setSearchInput(''); setActiveSearch(''); }} style={styles.clearFilterBtn}>
                    <Text style={styles.clearFilterText}>Clear search</Text>
                  </TouchableOpacity>
                </View>
              ) : selectedPrices.length > 0 ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyMessage}>No restaurants match your price filter</Text>
                  <TouchableOpacity onPress={() => setSelectedPrices([])} style={styles.clearFilterBtn}>
                    <Text style={styles.clearFilterText}>Clear price filter</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.emptyMessage}>No restaurants found nearby.</Text>
              )}
            </View>
          )}
        </>
      )}

      {/* ── Unified location + radius bottom sheet ─────────────────────── */}
      <Modal
        visible={locationPickerOpen}
        transparent
        animationType="none"
        onRequestClose={closeLocationSheet}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeLocationSheet} />
          {/* KeyboardAvoidingView lifts the sheet when the keyboard opens
              so the location TextInput + suggestions stay visible above
              the keyboard instead of being covered by it. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheetKavWrap}
            pointerEvents="box-none"
          >
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY: radiusSheetTranslate }], paddingBottom: Math.max(insets.bottom, 20) }]}
          >
            {/* Handle */}
            <View style={styles.sheetHandle} />

            {/* ── Location section ── */}
            <Text style={styles.sheetSectionLabel}>Where are you exploring?</Text>

            {/* Current location option */}
            <TouchableOpacity
              style={[styles.sheetLocationRow, !customLocation && styles.sheetLocationRowActive]}
              onPress={() => { setCustomLocation(null); setLocationInput(''); }}
              activeOpacity={0.7}
            >
              <Ionicons name="navigate" size={16} color={!customLocation ? colors.accent : colors.textMuted} />
              <Text style={[styles.sheetLocationText, !customLocation && styles.sheetLocationTextActive]}>Near you</Text>
              {!customLocation && <Ionicons name="checkmark" size={16} color={colors.accent} />}
            </TouchableOpacity>

            {/* Location search */}
            <View style={styles.sheetLocationInputWrap}>
              <Ionicons name="search-outline" size={15} color={colors.textFaint} />
              <TextInput
                value={locationInput}
                onChangeText={setLocationInput}
                placeholder="Search a neighborhood or city..."
                placeholderTextColor={colors.textFaint}
                style={styles.sheetLocationInput}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {locationInput.length > 0 && (
                <TouchableOpacity onPress={() => setLocationInput('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textFaint} />
                </TouchableOpacity>
              )}
            </View>

            {/* Location suggestions */}
            {locationInput.trim().length > 0 ? (
              geoLoading ? (
                <View style={styles.sheetLocationHint}>
                  <Text style={styles.sheetLocationHintText}>Searching...</Text>
                </View>
              ) : geoSuggestions.length > 0 ? (
                <ScrollView style={styles.sheetSuggestionsScroll} keyboardShouldPersistTaps="always">
                  {geoSuggestions.map((sug) => (
                    <TouchableOpacity
                      key={sug.label}
                      style={styles.sheetLocationRow}
                      onPress={() => { setCustomLocation({ label: sug.label, placeId: null, lat: sug.lat, lng: sug.lng }); setLocationInput(''); }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="location-outline" size={15} color={colors.textMuted} />
                      <Text style={styles.sheetLocationText} numberOfLines={1}>{sug.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.sheetLocationHint}>
                  <Text style={styles.sheetLocationHintText}>No locations found</Text>
                </View>
              )
            ) : (
              <ScrollView style={styles.sheetSuggestionsScroll} keyboardShouldPersistTaps="always">
                {POPULAR_LOCATIONS.map((loc) => {
                  const active = customLocation?.label === loc.label;
                  return (
                    <TouchableOpacity
                      key={loc.label}
                      style={[styles.sheetLocationRow, active && styles.sheetLocationRowActive]}
                      onPress={() => { setCustomLocation(loc); setLocationInput(''); }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="location-outline" size={15} color={active ? colors.accent : colors.textMuted} />
                      <Text style={[styles.sheetLocationText, active && styles.sheetLocationTextActive]} numberOfLines={1}>{loc.label}</Text>
                      {active && <Ionicons name="checkmark" size={16} color={colors.accent} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* ── Distance section ── */}
            <View style={styles.sheetDivider} />
            <View style={styles.sheetDistanceHeader}>
              <Text style={styles.sheetSectionLabel}>How far?</Text>
              <Text style={styles.sheetDistanceValue}>{Math.round(pendingRadius)} mi</Text>
            </View>

            <Slider
              style={styles.radiusSlider}
              minimumValue={1}
              maximumValue={30}
              step={1}
              value={pendingRadius}
              onValueChange={(v: number) => setPendingRadius(Math.round(v))}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.accent}
            />

            <TouchableOpacity style={styles.applyBtn} onPress={applyLocationSheet} activeOpacity={0.85}>
              <Text style={styles.applyBtnText}>Let's eat</Text>
            </TouchableOpacity>
          </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowColor: 'rgba(43,33,24,0.06)',
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  locationPillLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    maxWidth: 120,
  },
  locationPillDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.textFaint,
  },
  locationPillRadius: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },

  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    shadowColor: 'rgba(43,33,24,0.08)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  searchBarFocused: {
    borderColor: colors.accent,
    shadowColor: 'rgba(232,105,42,0.15)',
    shadowRadius: 12,
  },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, paddingVertical: 13, fontSize: 15, fontWeight: '500', color: colors.text },
  searchClear: { marginLeft: 6 },
  searchCancelBtn: { marginLeft: 10 },
  searchCancelText: { fontSize: 15, fontWeight: '600', color: colors.accent },
  searchAxisHelper: {
    marginTop: 6,
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: -0.1,
  },

  // Focus panel (shown when search bar is active)
  focusPanel: { marginTop: 12, maxHeight: 400 },
  focusHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  focusHintText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: -0.1,
  },
  focusLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  focusLocationText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  focusLocationChange: { fontSize: 13, fontWeight: '600', color: colors.accent },
  focusSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
    marginLeft: 4,
  },
  focusCategoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  focusCategoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  focusCategoryText: { fontSize: 14, fontWeight: '600', color: colors.text },
  focusSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  focusSearchText: { fontSize: 15, fontWeight: '500', color: colors.text },

  // Old locationRow/dropdown removed — unified into bottom sheet

  // ── Sort tabs (lightweight text, secondary) ──
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sortTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 12,
  },
  sortTab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sortTabActive: {
    backgroundColor: colors.surfaceSoft,
  },
  sortTabText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.textFaint,
    letterSpacing: 0.1,
  },
  sortTabTextActive: {
    fontWeight: '700',
    color: colors.text,
  },
  clearAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  // ── Cuisine chips (primary interaction) ──
  chipsRow: { marginTop: 10 },
  chipsScroll: { gap: 6, paddingRight: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    height: 32,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipEmoji: { fontSize: 13, lineHeight: 16, marginRight: 3 },
  chipEmojiActive: { opacity: 1 },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textMuted, lineHeight: 16, letterSpacing: 0.1 },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  scrollContent: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 100 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, color: '#8A7060', marginBottom: 14 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 12 },
  errorBanner: { backgroundColor: colors.surface, paddingVertical: 8, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  errorBannerText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  emptyWrap: { alignItems: 'center', gap: 8 },
  emptyMessage: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  clearFilterBtn: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.accent },
  clearFilterText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  setLocationBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.accent },
  setLocationBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // ── Unified location + radius bottom sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  sheetKavWrap: {
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 10,
    maxHeight: '80%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  sheetSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  sheetLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetLocationRowActive: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 10,
    marginHorizontal: -4,
    paddingHorizontal: 8,
  },
  sheetLocationText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  sheetLocationTextActive: {
    color: colors.accent,
  },
  sheetLocationInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  sheetLocationInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    paddingVertical: 11,
  },
  sheetSuggestionsScroll: {
    maxHeight: 160,
  },
  sheetLocationHint: {
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  sheetLocationHintText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: 12,
    marginBottom: 16,
  },
  sheetDistanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sheetDistanceValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.accent,
  },
  radiusSlider: {
    width: '100%',
    height: 40,
    marginBottom: 16,
  },
  radiusPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  radiusPreset: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radiusPresetActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  radiusPresetText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  radiusPresetTextActive: {
    color: '#fff',
  },
  applyBtn: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  applyBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
});
