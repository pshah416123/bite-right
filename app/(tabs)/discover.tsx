import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useDiscover } from '~/src/hooks/useDiscover';
import { RestaurantCard } from '~/src/components/RestaurantCard';
import { DiscoverLocationBar, type DiscoverSelectedLocation } from '~/src/components/DiscoverLocationBar';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { colors } from '~/src/theme/colors';
import { apiClient } from '~/src/api/client';
import { getDiscover, type DiscoverRecommendation, type DiscoverSections } from '~/src/api/discover';
import type { DiscoverItem } from '~/src/components/RestaurantCard';
import { resolveRestaurantDisplayImage } from '~/src/utils/restaurantImage';

function getSectionTitlesAndSubtitle(mode: 'trending' | 'blended' | 'clustered') {
  if (mode === 'trending') {
    return {
      topPicksForYou: 'Trending near you',
      topPicksSubtitle: 'Popular and highly rated nearby',
      becauseYouLiked: 'Because you liked',
      becauseYouLikedSubtitle: 'More like your favorites',
      trendingWithSimilarUsers: 'Top rated nearby',
      trendingSubtitle: 'Popular this week',
      allNearby: 'All nearby restaurants',
      allNearbySubtitle: 'Browse all within your radius',
    };
  }
  if (mode === 'blended') {
    return {
      topPicksForYou: 'For your taste',
      topPicksSubtitle: 'Blended with your preferences and nearby',
      becauseYouLiked: 'Because you liked',
      becauseYouLikedSubtitle: 'Restaurant-to-restaurant picks',
      trendingWithSimilarUsers: 'Popular nearby',
      trendingSubtitle: 'Saved by people with similar taste',
      allNearby: 'All nearby restaurants',
      allNearbySubtitle: 'More in your radius',
    };
  }
  return {
    topPicksForYou: 'Top picks for you',
    topPicksSubtitle: 'Generated from your taste and similar users',
    becauseYouLiked: 'More like your favorites',
    becauseYouLikedSubtitle: 'Restaurant-to-restaurant picks',
    trendingWithSimilarUsers: 'Trending with similar users',
    trendingSubtitle: 'Saved and liked by users like you',
    allNearby: 'All nearby restaurants',
    allNearbySubtitle: 'Browse all within your radius',
  };
}

type DiscoverSectionItems = {
  topPicksForYou: DiscoverItem[];
  becauseYouLiked: DiscoverItem[];
  trendingWithSimilarUsers: DiscoverItem[];
  allNearby: DiscoverItem[];
};

const EMPTY_DISCOVER_SECTIONS: DiscoverSectionItems = {
  topPicksForYou: [],
  becauseYouLiked: [],
  trendingWithSimilarUsers: [],
  allNearby: [],
};

type SelectedLocation = DiscoverSelectedLocation;

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
      placeId: rec.restaurant.placeId,
      previewPhotoUrl: ensureAbsoluteImageUrl(rec.restaurant.previewPhotoUrl),
      imageUrl: ensureAbsoluteImageUrl(rec.restaurant.imageUrl),
    },
    matchScore: rec.percentMatch / 100,
    reasonTags: rec.explanations,
    socialProofBadge: rec.socialProofBadge ?? null,
  };
}

function sectionsToItems(sections: DiscoverSections | undefined): DiscoverSectionItems {
  if (!sections) return EMPTY_DISCOVER_SECTIONS;
  return {
    topPicksForYou: (sections.topPicksForYou || []).map(recToItem),
    becauseYouLiked: (sections.becauseYouLiked || []).map(recToItem),
    trendingWithSimilarUsers: (sections.trendingWithSimilarUsers || []).map(recToItem),
    allNearby: (sections.allNearby || []).map(recToItem),
  };
}

export default function DiscoverScreen() {
  const [selectedCuisine, setSelectedCuisine] = useState<string | null>(null);
  const {
    sections,
    loading,
    error,
    filterMode,
    setFilterMode,
    isColdStart,
    discoverMode,
  } = useDiscover('you', { cuisine: selectedCuisine });
  const { isSaved } = useSavedRestaurants();
  const sectionLabels = getSectionTitlesAndSubtitle(discoverMode);
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null);

  const [locationResultsLoading, setLocationResultsLoading] = useState(false);
  const [locationResultsError, setLocationResultsError] = useState<string | null>(null);
  // Location "source of truth": full dataset for the selected location (cached).
  const [allRestaurants, setAllRestaurants] = useState<DiscoverSectionItems>(EMPTY_DISCOVER_SECTIONS);
  const [visibleRestaurants, setVisibleRestaurants] = useState<DiscoverSectionItems>(EMPTY_DISCOVER_SECTIONS);
  const locationCacheRef = useRef<Record<string, DiscoverSectionItems>>({});

  /** Last nearby sections without a cuisine filter — keeps chip row stable while a chip is active. */
  const baselineNearbySectionsRef: MutableRefObject<DiscoverSectionItems> = useRef(EMPTY_DISCOVER_SECTIONS);

  const getLocationCacheKey = (loc: SelectedLocation, cuisine: string | null) => {
    const labelKey = (loc.label || '').trim().toLowerCase();
    // Round coords so the "same" location doesn't produce new cache entries due to tiny jitter.
    const latKey = Number.isFinite(loc.lat) ? loc.lat.toFixed(3) : '0';
    const lngKey = Number.isFinite(loc.lng) ? loc.lng.toFixed(3) : '0';
    const c = (cuisine || '').trim().toLowerCase();
    return `${labelKey}|${latKey}|${lngKey}|${c}`;
  };

  const showLoading = filterMode === 'location' ? locationResultsLoading : loading;

  useEffect(() => {
    if (filterMode === 'nearby' && !selectedCuisine) {
      baselineNearbySectionsRef.current = sections;
    }
  }, [filterMode, selectedCuisine, sections]);

  // Chips are built from the broad list (not the cuisine-filtered API subset).
  const cuisineChipsSource =
    filterMode === 'location' ? allRestaurants : selectedCuisine ? baselineNearbySectionsRef.current : sections;

  function extractCuisineLabel(cuisine: string): string {
    // "Sushi · Omakase" -> "Sushi"
    const raw = (cuisine || '').trim();
    if (!raw) return '';
    return raw.split(/[·•]/)[0]?.trim() || raw;
  }

  const FOOD_CHIP_ALLOWLIST = new Set([
    'Italian',
    'Mexican',
    'Chinese',
    'Indian',
    'Thai',
    'Japanese',
    'Korean',
    'Mediterranean',
    'American',
    'Pizza',
    'Burgers',
    'Sushi',
    'Bakery',
    'Dessert',
    'Coffee',
    'Vegetarian',
    'Vegan',
    'Brunch',
    'Seafood',
    'BBQ',
  ]);

  const DEFAULT_FOOD_CHIPS = [
    'Italian',
    'Mexican',
    'Chinese',
    'Japanese',
    'Indian',
    'Thai',
    'Korean',
    'Mediterranean',
    'American',
    'Sushi',
    'Pizza',
    'Burgers',
    'Seafood',
    'BBQ',
    'Brunch',
    'Vegan',
    'Vegetarian',
    'Bakery',
    'Coffee',
    'Dessert',
  ];

  const CUISINE_KEYWORDS: Array<{ re: RegExp; label: string }> = [
    { re: /\bitalian|pasta|trattoria|ristorante\b/i, label: 'Italian' },
    { re: /\bmexican|taco|taqueria|burrito\b/i, label: 'Mexican' },
    { re: /\bchinese|dim\s*sum|szechuan|sichuan\b/i, label: 'Chinese' },
    { re: /\bindian|curry\b/i, label: 'Indian' },
    { re: /\bthai\b/i, label: 'Thai' },
    { re: /\bjapanese|ramen|izakaya\b/i, label: 'Japanese' },
    { re: /\bkorean\b/i, label: 'Korean' },
    { re: /\bmediterranean|greek|falafel\b/i, label: 'Mediterranean' },
    { re: /\bamerican|diner|grill\b/i, label: 'American' },
    { re: /\bsushi|omakase\b/i, label: 'Sushi' },
    { re: /\bburger|hamburger\b/i, label: 'Burgers' },
    { re: /\bpizza|pizzeria\b/i, label: 'Pizza' },
    { re: /\bbakery|boulangerie\b/i, label: 'Bakery' },
    { re: /\bcoffee|cafe|espresso|roast\b/i, label: 'Coffee' },
    { re: /\bdessert|gelato|ice cream|boba|tea|juice\b/i, label: 'Dessert' },
    { re: /\bvegan\b/i, label: 'Vegan' },
    { re: /\bvegetarian\b/i, label: 'Vegetarian' },
    { re: /\bbrunch|breakfast\b/i, label: 'Brunch' },
    { re: /\bseafood|oyster|fish\b/i, label: 'Seafood' },
    { re: /\bbbq|barbecue|smokehouse\b/i, label: 'BBQ' },
  ];

  function inferCuisineCandidates(item: DiscoverItem): string[] {
    const out = new Set<string>();
    const cuisineText = `${item.restaurant.cuisine || ''}`;
    const nameText = `${item.restaurant.name || ''}`;
    const combined = `${cuisineText} ${nameText}`;

    // Use category text from backend first if it already matches a curated cuisine.
    const explicit = extractCuisineLabel(cuisineText);
    if (explicit && FOOD_CHIP_ALLOWLIST.has(explicit) && explicit !== 'Restaurant') {
      out.add(explicit);
    }

    // Infer from name + category text keywords (secondary signal).
    for (const { re, label } of CUISINE_KEYWORDS) {
      if (re.test(combined) && FOOD_CHIP_ALLOWLIST.has(label)) {
        out.add(label);
      }
    }

    // Bakery places should also carry dessert intent.
    if (out.has('Bakery')) out.add('Dessert');

    return Array.from(out);
  }

  function getDerivedCuisines(item: DiscoverItem): string[] {
    const existing = Array.isArray(item.restaurant.cuisines) ? item.restaurant.cuisines : [];
    if (existing.length > 0) return existing;
    return inferCuisineCandidates(item);
  }

  function getLocationIdentityKey(loc: SelectedLocation) {
    const labelKey = (loc.label || '').trim().toLowerCase();
    const latKey = Number.isFinite(loc.lat) ? loc.lat.toFixed(3) : '0';
    const lngKey = Number.isFinite(loc.lng) ? loc.lng.toFixed(3) : '0';
    return `${labelKey}|${latKey}|${lngKey}`;
  }

  const selectedLocationLabel = selectedLocation?.label ?? null;
  const selectedLocationCacheKey = selectedLocation
    ? getLocationCacheKey(selectedLocation, selectedCuisine)
    : null;

  // Keep filtering consistent when switching modes/locations.
  useEffect(() => {
    setSelectedCuisine(null);
  }, [filterMode, selectedLocationLabel]);

  const cuisineChips = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of cuisineChipsSource.allNearby) {
      const candidates = getDerivedCuisines(item);
      for (const label of candidates) {
        // First inferred cuisine per item gets slightly higher weight.
        const weight = candidates[0] === label ? 2 : 1;
        counts[label] = (counts[label] || 0) + weight;
      }
    }

    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .filter(([label]) => FOOD_CHIP_ALLOWLIST.has(label))
      .slice(0, 10)
      .map(([label]) => label);

    // Keep a richer row: fill from curated defaults if detected cuisines are sparse.
    const MIN_CHIPS = 6;
    if (ranked.length >= MIN_CHIPS) return ranked;

    const filled = [...ranked];
    for (const label of DEFAULT_FOOD_CHIPS) {
      if (!FOOD_CHIP_ALLOWLIST.has(label)) continue;
      if (filled.includes(label)) continue;
      filled.push(label);
      if (filled.length >= MIN_CHIPS) break;
    }
    return filled.slice(0, 10);
  }, [cuisineChipsSource.allNearby]);

  // Lists come from the API with `cuisine` query applied (no client soft-fallback).
  const visibleSections = filterMode === 'location' ? visibleRestaurants : sections;

  useEffect(() => {
    if (filterMode !== 'location') return;
    setVisibleRestaurants(allRestaurants);
  }, [filterMode, allRestaurants]);

  const hasAnyCards =
    visibleSections.allNearby.length > 0 ||
    visibleSections.topPicksForYou.length > 0 ||
    visibleSections.becauseYouLiked.length > 0 ||
    visibleSections.trendingWithSimilarUsers.length > 0;

  const handleCommitLocation = useCallback(
    (loc: SelectedLocation) => {
      const trimmed = loc.label.trim();
      if (!trimmed) return;
      const nextLocation = { ...loc, label: trimmed };
      setLocationResultsError(null);
      if (filterMode === 'location') {
        const nextId = getLocationIdentityKey(nextLocation);
        const prevId = selectedLocation ? getLocationIdentityKey(selectedLocation) : null;
        if (nextId !== prevId) {
          setVisibleRestaurants(EMPTY_DISCOVER_SECTIONS);
        }
      }
      setSelectedLocation(nextLocation);
    },
    [filterMode, selectedLocation],
  );

  const handleLocationInputDiverged = useCallback(() => {
    setSelectedLocation(null);
    setAllRestaurants(EMPTY_DISCOVER_SECTIONS);
    setVisibleRestaurants(EMPTY_DISCOVER_SECTIONS);
    setLocationResultsError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLocationRestaurants(loc: SelectedLocation, cuisine: string | null) {
      const cacheKey = getLocationCacheKey(loc, cuisine);
      const cached = locationCacheRef.current[cacheKey];
      console.log('[DiscoverLocation] discover fetch state', {
        label: loc.label,
        placeId: loc.placeId ?? null,
        lat: loc.lat,
        lng: loc.lng,
        selectedCuisine: cuisine,
        cacheKey,
        cacheHit: !!cached,
      });

      setLocationResultsLoading(true);
      // Avoid showing a mixed list while the new dataset is loading.
      setVisibleRestaurants(EMPTY_DISCOVER_SECTIONS);

      if (cached) {
        if (cancelled) return;
        setAllRestaurants(cached);
        setLocationResultsLoading(false);
        return;
      }

      try {
        // Fetch real backend Discover sections for this location.
        // Images come from the backend resolver (photo URLs / fallbacks).
        console.log('[DiscoverLocation] request params sent to /api/discover', {
          mode: 'location',
          userId: 'default',
          query: loc.label,
          lat: loc.lat,
          lng: loc.lng,
          radiusMiles: 10,
          cuisine: cuisine || null,
        });
        const res = await getDiscover({
          mode: 'location',
          userId: 'default',
          query: loc.label,
          radiusMiles: 10,
          lat: loc.lat,
          lng: loc.lng,
          cuisine,
        });
        console.log('[DiscoverLocation] backend response summary', {
          discoverMode: res.discoverMode ?? null,
          responseLat: res.location?.lat ?? null,
          responseLng: res.location?.lng ?? null,
          topPicks: res.sections?.topPicksForYou?.length ?? 0,
          trending: res.sections?.trendingWithSimilarUsers?.length ?? 0,
          allNearby: res.sections?.allNearby?.length ?? 0,
          sampleNames: (res.sections?.allNearby || []).slice(0, 3).map((r) => r.restaurant?.name),
        });

        if (cancelled) return;
        const sectionsItems = sectionsToItems(res.sections);
        // Normalize so cards always share Feed's preferred resolved image field.
        const normalize = (item: DiscoverItem): DiscoverItem => {
          const resolved = resolveRestaurantDisplayImage({
            previewPhotoUrl: item.restaurant.previewPhotoUrl,
            imageUrl: item.restaurant.imageUrl,
          }).url;
          const derivedCuisines =
            item.restaurant.cuisines && item.restaurant.cuisines.length > 0
              ? item.restaurant.cuisines
              : inferCuisineCandidates(item);
          return {
            ...item,
            restaurant: {
              ...item.restaurant,
              cuisines: derivedCuisines,
              previewPhotoUrl: resolved,
              imageUrl: resolved,
            },
          };
        };
        const normalizedSections: DiscoverSectionItems = {
          topPicksForYou: sectionsItems.topPicksForYou.map(normalize),
          becauseYouLiked: sectionsItems.becauseYouLiked.map(normalize),
          trendingWithSimilarUsers: sectionsItems.trendingWithSimilarUsers.map(normalize),
          allNearby: sectionsItems.allNearby.map(normalize),
        };
        locationCacheRef.current[cacheKey] = normalizedSections;
        setAllRestaurants(normalizedSections);
        setLocationResultsError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Could not load restaurants for this location.';
        setLocationResultsError(message);
        setAllRestaurants(EMPTY_DISCOVER_SECTIONS);
      } finally {
        if (cancelled) return;
        setLocationResultsLoading(false);
      }
    }

    if (filterMode !== 'location') {
      setAllRestaurants(EMPTY_DISCOVER_SECTIONS);
      setVisibleRestaurants(EMPTY_DISCOVER_SECTIONS);
      setLocationResultsError(null);
      setLocationResultsLoading(false);
      return;
    }

    if (!selectedLocation || !selectedLocationCacheKey) {
      setAllRestaurants(EMPTY_DISCOVER_SECTIONS);
      setVisibleRestaurants(EMPTY_DISCOVER_SECTIONS);
      setLocationResultsError(null);
      setLocationResultsLoading(false);
      return;
    }

    loadLocationRestaurants(selectedLocation, selectedCuisine);

    return () => {
      cancelled = true;
    };
  }, [filterMode, selectedLocationCacheKey, selectedCuisine]);

  const cuisineHeading = selectedCuisine ? `${selectedCuisine}` : null;

  const topPicksTitle =
    filterMode === 'location' && selectedLocation
      ? cuisineHeading
        ? `Trending ${cuisineHeading} in ${selectedLocation.label}`
        : `Trending in ${selectedLocation.label}`
      : cuisineHeading
        ? `Trending ${cuisineHeading}`
        : sectionLabels.topPicksForYou;

  const topPicksSubtitle =
    filterMode === 'location' && selectedLocation
      ? cuisineHeading
        ? `Popular and highly rated ${cuisineHeading} in this area`
        : 'Popular and highly rated in this area'
      : cuisineHeading
        ? `Popular picks for ${cuisineHeading}`
        : sectionLabels.topPicksSubtitle;

  const locationHeading = filterMode === 'location' && selectedLocation ? selectedLocation.label : null;
  const trendingTitle = locationHeading
    ? cuisineHeading
      ? `Top rated ${cuisineHeading} in ${locationHeading}`
      : `Top rated in ${locationHeading}`
    : cuisineHeading
      ? `Top rated ${cuisineHeading}`
      : sectionLabels.trendingWithSimilarUsers;

  const trendingSubtitle = locationHeading
    ? cuisineHeading
      ? `Popular ${cuisineHeading} in this area`
      : 'Popular in this area'
    : cuisineHeading
      ? `Popular ${cuisineHeading} picks`
      : sectionLabels.trendingSubtitle;

  const allLocationsTitle = locationHeading
    ? cuisineHeading
      ? `Top picks for ${cuisineHeading} in ${locationHeading}`
      : `Top picks in ${locationHeading}`
    : cuisineHeading
      ? `Top picks for ${cuisineHeading}`
      : sectionLabels.allNearby;

  const allLocationsSubtitle = locationHeading
    ? cuisineHeading
      ? `Browse ${cuisineHeading} restaurants in ${locationHeading}`
      : `Browse restaurants in ${locationHeading}`
    : cuisineHeading
      ? `Browse ${cuisineHeading} restaurants`
      : sectionLabels.allNearbySubtitle;

  const cuisineFilterRow =
    cuisineChips.length > 0 ? (
      <View style={styles.cuisineFilterRowWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cuisineFilterRowScroll}
        >
          {cuisineChips.map((c) => {
            const active = selectedCuisine === c;
            return (
              <TouchableOpacity
                key={c}
                style={[styles.cuisineChip, active && styles.cuisineChipActive]}
                onPress={() =>
                  setSelectedCuisine((prev) => {
                    const next = prev === c ? null : c;
                    if (__DEV__) console.log('[Discover] cuisine chip selected', { chip: c, next });
                    return next;
                  })
                }
                activeOpacity={0.85}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.cuisineChipText, active && styles.cuisineChipTextActive]}>
                  {c}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Discover</Text>
        <Text style={styles.subtitle}>
          {filterMode === 'location'
            ? selectedLocation
              ? `Popular picks for ${selectedLocation.label}`
              : 'Find restaurants for a neighborhood or city'
            : isColdStart
              ? 'Popular picks while we learn your taste'
              : 'People who like what you like also liked these'}
        </Text>
        <DiscoverLocationBar
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          selectedLocation={selectedLocation}
          onCommitLocation={handleCommitLocation}
          onLocationInputDiverged={handleLocationInputDiverged}
          cuisineRow={cuisineFilterRow}
        />
      </View>
      {showLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          ) : null}
          {filterMode === 'location' && locationResultsError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>
                {`Could not load location results. ${locationResultsError}`}
              </Text>
            </View>
          ) : null}
          {hasAnyCards ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {visibleSections.topPicksForYou.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{topPicksTitle}</Text>
              <Text style={styles.sectionSubtitle}>{topPicksSubtitle}</Text>
              {visibleSections.topPicksForYou.map((item) => (
                <RestaurantCard
                  key={item.restaurant.id}
                  item={item}
                  saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)}
                />
              ))}
            </View>
          )}
          {visibleSections.becauseYouLiked.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{sectionLabels.becauseYouLiked}</Text>
              <Text style={styles.sectionSubtitle}>{sectionLabels.becauseYouLikedSubtitle}</Text>
              {visibleSections.becauseYouLiked.map((item) => (
                <RestaurantCard
                  key={item.restaurant.id}
                  item={item}
                  saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)}
                />
              ))}
            </View>
          )}
          {visibleSections.trendingWithSimilarUsers.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{trendingTitle}</Text>
              <Text style={styles.sectionSubtitle}>{trendingSubtitle}</Text>
              {visibleSections.trendingWithSimilarUsers.map((item) => (
                <RestaurantCard
                  key={item.restaurant.id}
                  item={item}
                  saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)}
                />
              ))}
            </View>
          )}
          {(() => {
            const seenIds = new Set([
              ...visibleSections.topPicksForYou.map((i) => i.restaurant.id),
              ...visibleSections.becauseYouLiked.map((i) => i.restaurant.id),
              ...visibleSections.trendingWithSimilarUsers.map((i) => i.restaurant.id),
            ]);
            const remainingNearby = visibleSections.allNearby.filter((item) => !seenIds.has(item.restaurant.id));
            if (remainingNearby.length === 0 && visibleSections.allNearby.length > 0) return null;
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{allLocationsTitle}</Text>
                <Text style={styles.sectionSubtitle}>
                  {remainingNearby.length < visibleSections.allNearby.length
                    ? locationHeading
                      ? cuisineHeading
                        ? `More top picks for ${cuisineHeading} in ${locationHeading}`
                        : `More top picks in ${locationHeading}`
                      : 'More in your radius'
                    : allLocationsSubtitle}
                </Text>
                {(remainingNearby.length > 0 ? remainingNearby : visibleSections.allNearby).map((item) => (
                  <RestaurantCard
                    key={item.restaurant.id}
                    item={item}
                    saved={isSaved(item.restaurant.placeId ?? item.restaurant.id)}
                  />
                ))}
              </View>
            );
          })()}
        </ScrollView>
          ) : (
            <View style={styles.centered}>
              {filterMode === 'location' ? (
                selectedLocation ? (
                  <Text style={styles.emptyMessage}>
                    {selectedCuisine
                      ? `No ${selectedCuisine} restaurants found for ${selectedLocation.label}.`
                      : `No restaurants found for ${selectedLocation.label}.`}
                  </Text>
                ) : (
                  <Text style={styles.emptyMessage}>Type to search locations above.</Text>
                )
              ) : (
                <Text style={styles.emptyMessage}>
                  {selectedCuisine ? `No ${selectedCuisine} restaurants found nearby.` : 'No restaurants found nearby.'}
                </Text>
              )}
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 100 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 2 },
  sectionSubtitle: { fontSize: 12, color: colors.textMuted, marginBottom: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  error: { color: colors.textMuted, textAlign: 'center' },
  errorBanner: { backgroundColor: colors.surface, paddingVertical: 8, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  errorBannerText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  emptyMessage: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  cuisineFilterRowWrap: {
    marginTop: 10,
  },
  cuisineFilterRowScroll: {
    gap: 8,
    paddingRight: 10,
  },
  cuisineChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cuisineChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  cuisineChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  cuisineChipTextActive: {
    color: '#fff',
  },
});
