import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SavedRestaurantListCard } from '~/src/components/SavedRestaurantListCard';
import { useFeedContext } from '~/src/context/FeedContext';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { inferVibeTags, type VibeTag } from '~/src/utils/vibeTags';
import { followUser, getMe, unfollowUser, type UserSummary } from '~/src/api/users';
import { colors } from '~/src/theme/colors';

const MY_USER_NAME = 'You';
const RECENT_LOGS_MAX = 10;
const TOP_PLACES_MAX = 5;
const TOP_CUISINES_MAX = 6;
const TOP_AREAS_MAX = 5;

const VIBE_OPTIONS: { value: VibeTag; label: string }[] = [
  { value: 'solo dining', label: 'Solo dining' },
  { value: 'casual', label: 'Casual' },
  { value: 'fine dining', label: 'Fine dining' },
  { value: 'date night', label: 'Date night' },
  { value: 'group dinner', label: 'Group dinner' },
  { value: 'brunch', label: 'Brunch' },
  { value: 'drinks', label: 'Drinks' },
  { value: 'quick bite', label: 'Quick bite' },
  { value: 'special occasion', label: 'Special occasion' },
];

/** Parse cuisine string (e.g. "Pizza · Deep dish" or "Japanese") into a single tag for grouping */
function getCuisineTag(cuisine: string): string {
  const trimmed = cuisine?.trim() || '';
  if (!trimmed) return '';
  const first = trimmed.split(/[·•\-]/)[0]?.trim() || trimmed;
  return first;
}

/** Derive top cuisines from logs by frequency */
function getTopCuisines(logs: { cuisine: string; score: number }[]): string[] {
  const byCuisine: Record<string, { count: number; sumScore: number }> = {};
  for (const log of logs) {
    const tag = getCuisineTag(log.cuisine);
    if (!tag) continue;
    byCuisine[tag] = byCuisine[tag] ?? { count: 0, sumScore: 0 };
    byCuisine[tag].count += 1;
    byCuisine[tag].sumScore += log.score ?? 0;
  }

  return Object.entries(byCuisine)
    .sort((a, b) => {
      // Primary: frequency. Secondary: higher average score.
      const aCount = a[1].count;
      const bCount = b[1].count;
      if (bCount !== aCount) return bCount - aCount;
      const aAvg = a[1].sumScore / Math.max(1, aCount);
      const bAvg = b[1].sumScore / Math.max(1, bCount);
      return bAvg - aAvg;
    })
    .slice(0, TOP_CUISINES_MAX)
    .map(([name]) => name);
}

function getTopAreas(
  logs: { neighborhood?: string; state?: string; score: number }[],
): string[] {
  const byArea: Record<string, { count: number; sumScore: number }> = {};
  for (const log of logs) {
    const neighborhood = log.neighborhood?.trim();
    const state = log.state?.trim();
    const key = neighborhood || state;
    if (!key) continue;
    byArea[key] = byArea[key] ?? { count: 0, sumScore: 0 };
    byArea[key].count += 1;
    byArea[key].sumScore += log.score ?? 0;
  }

  return Object.entries(byArea)
    .sort((a, b) => {
      const aCount = a[1].count;
      const bCount = b[1].count;
      if (bCount !== aCount) return bCount - aCount;
      const aAvg = a[1].sumScore / Math.max(1, aCount);
      const bAvg = b[1].sumScore / Math.max(1, bCount);
      return bAvg - aAvg;
    })
    .slice(0, TOP_AREAS_MAX)
    .map(([name]) => name);
}

export default function ProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userName?: string }>();
  const profileUserNameRaw =
    typeof params.userName === 'string'
      ? params.userName
      : Array.isArray(params.userName)
        ? params.userName[0]
        : undefined;
  const profileUserName = profileUserNameRaw?.trim() ? profileUserNameRaw.trim() : MY_USER_NAME;
  const isSelf = profileUserName === MY_USER_NAME;
  const { items } = useFeedContext();
  const { savedRestaurants, loading: savedLoading, removeSaved } = useSavedRestaurants();
  const [me, setMe] = useState<UserSummary | null>(null);

  // Follow UI for social discovery.
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  // Inline filtering for the visit list.
  const [visitCuisineFilter, setVisitCuisineFilter] = useState<string | null>(null);
  const [visitLocationFilter, setVisitLocationFilter] = useState<string | null>(null);
  const [visitRatingFilter, setVisitRatingFilter] = useState<'any' | '8plus' | '9plus'>('any');
  const [activeVisitFilter, setActiveVisitFilter] = useState<'cuisine' | 'location' | 'rating' | null>(null);
  const closeVisitFilterPicker = () => setActiveVisitFilter(null);

  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
  const [vibeFilter, setVibeFilter] = useState<VibeTag | null>(null);
  const [sortMode, setSortMode] = useState<'recent' | 'alpha'>('recent');
  const [pickerOpen, setPickerOpen] = useState<'location' | 'cuisine' | 'type' | null>(null);

  const savedLocationOptions = useMemo(() => {
    const set = new Set<string>();
    savedRestaurants.forEach((r) => {
      if (r.neighborhood?.trim()) set.add(r.neighborhood.trim());
    });
    return Array.from(set).sort();
  }, [savedRestaurants]);

  const savedCuisineOptions = useMemo(() => {
    const set = new Set<string>(['Pizza', 'Sushi', 'Mexican', 'American', 'Italian', 'Japanese']);
    savedRestaurants.forEach((item) => {
      const lowerName = item.name?.toLowerCase() ?? '';
      if (lowerName.includes('pizza')) set.add('Pizza');
      else if (lowerName.includes('sushi')) set.add('Sushi');
      else if (lowerName.includes('taco') || lowerName.includes('taquer')) set.add('Mexican');
    });
    return Array.from(set).sort();
  }, [savedRestaurants]);

  const profileLogs = items.filter((log) => log.userName === profileUserName);

  const groupedVisits = useMemo(() => {
    const byRestaurant: Record<
      string,
      {
        restaurantId: string;
        restaurantName: string;
        visits: typeof profileLogs;
        bestScore: number;
        lastVisitAt: string | null;
        previewPhotoUrl?: string;
      }
    > = {};

    for (const log of profileLogs) {
      const key = log.restaurantId;
      const existing = byRestaurant[key];
      const createdAt = log.createdAt ?? new Date().toISOString();
      if (!existing) {
        byRestaurant[key] = {
          restaurantId: log.restaurantId,
          restaurantName: log.restaurantName,
          visits: [log],
          bestScore: log.score,
          lastVisitAt: createdAt,
          previewPhotoUrl: log.previewPhotoUrl,
        };
      } else {
        existing.visits.push(log);
        if (log.score > existing.bestScore) existing.bestScore = log.score;
        if (new Date(createdAt).getTime() > new Date(existing.lastVisitAt ?? 0).getTime()) {
          existing.lastVisitAt = createdAt;
          if (log.previewPhotoUrl) existing.previewPhotoUrl = log.previewPhotoUrl;
        }
      }
    }

    const groups = Object.values(byRestaurant).map((g) => {
      const sortedVisits = [...g.visits].sort((a, b) => {
        const aTime = new Date(a.createdAt ?? 0).getTime();
        const bTime = new Date(b.createdAt ?? 0).getTime();
        return bTime - aTime;
      });
      return {
        ...g,
        visits: sortedVisits,
        visitCount: sortedVisits.length,
      };
    });

    groups.sort((a, b) => {
      const aTime = new Date(a.lastVisitAt ?? 0).getTime();
      const bTime = new Date(b.lastVisitAt ?? 0).getTime();
      return bTime - aTime;
    });

    return groups;
  }, [profileLogs]);

  const recentGroupedVisits = groupedVisits;

  const topPlaces = useMemo(
    () =>
      [...groupedVisits]
        .sort((a, b) => b.bestScore - a.bestScore)
        .slice(0, TOP_PLACES_MAX),
    [groupedVisits],
  );
  const topCuisines = getTopCuisines(profileLogs);

  const favoriteAreas = useMemo(() => getTopAreas(profileLogs), [profileLogs]);

  const visitRatingThreshold = useMemo(() => {
    if (visitRatingFilter === '9plus') return 9;
    if (visitRatingFilter === '8plus') return 8;
    return null;
  }, [visitRatingFilter]);

  const filteredVisitGroups = useMemo(() => {
    if (!visitCuisineFilter && !visitLocationFilter && visitRatingThreshold == null) {
      return groupedVisits;
    }

    return groupedVisits.filter((g) => {
      if (visitRatingThreshold != null && g.bestScore < visitRatingThreshold) return false;

      if (visitCuisineFilter) {
        const matchesCuisine = g.visits.some((v) => getCuisineTag(v.cuisine) === visitCuisineFilter);
        if (!matchesCuisine) return false;
      }

      if (visitLocationFilter) {
        const matchesLocation = g.visits.some(
          (v) => (v.neighborhood?.trim() || v.state?.trim()) === visitLocationFilter,
        );
        if (!matchesLocation) return false;
      }

      return true;
    });
  }, [groupedVisits, visitCuisineFilter, visitLocationFilter, visitRatingThreshold]);

  useEffect(() => {
    if (!isSelf) return;
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, [isSelf]);

  const displayName = isSelf ? me?.displayName || MY_USER_NAME : profileUserName;
  const username = me?.username ? `@${me.username}` : '';
  const location = 'Chicago, IL'; // Placeholder until API supports location
  const logCount = profileLogs.length;
  const followerCount = me?.followerCount ?? 0;
  const followingCount = me?.followingCount ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile header */}
        <View style={styles.headerRow}>
          <View style={styles.headerMain}>
            <View style={styles.avatarWrap}>
              {me?.avatarUrl ? (
                <Image source={{ uri: me.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>{displayName[0] ?? '·'}</Text>
                </View>
              )}
            </View>
            <View style={styles.headerMeta}>
              <Text style={styles.displayName}>{displayName}</Text>
              {username ? <Text style={styles.username}>{username}</Text> : null}
              {location ? (
                <View style={styles.locationRow}>
                  <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.location}>{location}</Text>
                </View>
              ) : null}
              <View style={styles.statsRow}>
                <Text style={styles.statValue}>{logCount}</Text>
                <Text style={styles.statLabel}>Logs</Text>
                <View style={styles.statDivider} />
                <TouchableOpacity
                  style={styles.statTouch}
                  onPress={() => router.push('/(tabs)/profile/followers')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.statValue}>{followerCount}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </TouchableOpacity>
                <View style={styles.statDivider} />
                <TouchableOpacity
                  style={styles.statTouch}
                  onPress={() => router.push('/(tabs)/profile/following')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.statValue}>{followingCount}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          {isSelf ? (
            <Link href="/(tabs)/profile/settings" asChild>
              <TouchableOpacity style={styles.settingsBtn} activeOpacity={0.7}>
                <Ionicons name="settings-outline" size={24} color={colors.text} />
              </TouchableOpacity>
            </Link>
          ) : (
            <TouchableOpacity
              style={[styles.followBtn, following && styles.followBtnActive]}
              onPress={async () => {
                if (followBusy) return;
                setFollowBusy(true);
                try {
                  const next = !following;
                  if (next) await followUser(profileUserName);
                  else await unfollowUser(profileUserName);
                  setFollowing(next);
                } catch {
                  // Demo mode: ignore API failures.
                } finally {
                  setFollowBusy(false);
                }
              }}
              activeOpacity={0.85}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={following ? 'checkmark-circle' : 'person-add-outline'}
                size={18}
                color={following ? colors.accent : colors.text}
              />
              <Text style={[styles.followBtnText, following && styles.followBtnTextActive]}>
                {followBusy ? 'Please wait…' : following ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Top cuisines */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top cuisines</Text>
          <Text style={styles.sectionSubtitle}>Most frequent + highest rated</Text>
          {topCuisines.length > 0 ? (
            <View style={styles.chipRow}>
              {topCuisines.map((c) => {
                const active = visitCuisineFilter === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[styles.cuisineChip, active && styles.cuisineChipActive]}
                    onPress={() => {
                      setVisitCuisineFilter((prev) => (prev === c ? null : c));
                      closeVisitFilterPicker();
                    }}
                    activeOpacity={0.8}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={[styles.cuisineChipText, active && styles.cuisineChipTextActive]}>
                      {c}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyHint}>Log visits to see top cuisines here.</Text>
          )}
        </View>

        {/* Favorite areas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Favorite areas</Text>
          <Text style={styles.sectionSubtitle}>Where you frequently eat</Text>
          {favoriteAreas.length > 0 ? (
            <View style={styles.chipRow}>
              {favoriteAreas.map((area) => {
                const active = visitLocationFilter === area;
                return (
                  <TouchableOpacity
                    key={area}
                    style={[styles.cuisineChip, active && styles.cuisineChipActive]}
                    onPress={() => {
                      setVisitLocationFilter((prev) => (prev === area ? null : area));
                      closeVisitFilterPicker();
                    }}
                    activeOpacity={0.8}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={[styles.cuisineChipText, active && styles.cuisineChipTextActive]}>
                      {area}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyHint}>Your visit neighborhoods will show up here.</Text>
          )}
        </View>

        {/* Top places — horizontal cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top places</Text>
          <Text style={styles.sectionSubtitle}>Top-rated spots</Text>
          {topPlaces.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.topPlacesScroll}
            >
              {topPlaces.map((place) => {
                const photo =
                  place.previewPhotoUrl && place.previewPhotoUrl.startsWith('http')
                    ? place.previewPhotoUrl
                    : 'https://placehold.co/400x300/e5e7eb/6b7280?text=No+photo';
                return (
                  <TouchableOpacity
                    key={place.restaurantId}
                    style={styles.topPlaceCard}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/restaurant/${place.restaurantId}`)}
                  >
                    <Image source={{ uri: photo }} style={styles.topPlacePhoto} />
                    <Text style={styles.topPlaceName} numberOfLines={1}>
                      {place.restaurantName}
                    </Text>
                    <View style={styles.topPlaceScore}>
                      <Ionicons name="star" size={12} color={colors.accent} />
                      <Text style={styles.topPlaceScoreText}>{place.bestScore.toFixed(1)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={styles.emptyHint}>Your top rated restaurants will appear here.</Text>
          )}
        </View>

        {/* Saved restaurants / Want to try */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Want to try</Text>
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, locationFilter && styles.filterChipActive]}
              onPress={() => setPickerOpen('location')}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  locationFilter && styles.filterChipTextActive,
                ]}
              >
                {locationFilter ?? 'Location'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, cuisineFilter && styles.filterChipActive]}
              onPress={() => setPickerOpen('cuisine')}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  cuisineFilter && styles.filterChipTextActive,
                ]}
              >
                {cuisineFilter ?? 'Cuisine'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, vibeFilter && styles.filterChipActive]}
              onPress={() => setPickerOpen('type')}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  vibeFilter && styles.filterChipTextActive,
                ]}
              >
                {vibeFilter ?? 'Type'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.filterChip,
                sortMode !== 'recent' && styles.filterChipActive,
              ]}
              onPress={() =>
                setSortMode((prev) => (prev === 'recent' ? 'alpha' : 'recent'))
              }
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  sortMode !== 'recent' && styles.filterChipTextActive,
                ]}
              >
                {sortMode === 'recent' ? 'Newest' : 'A–Z'}
              </Text>
            </TouchableOpacity>
            {(locationFilter || cuisineFilter || vibeFilter) && (
              <TouchableOpacity
                style={[styles.filterChip, styles.filterChipClear]}
                onPress={() => {
                  setLocationFilter(null);
                  setCuisineFilter(null);
                  setVibeFilter(null);
                }}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.filterChipText, styles.filterChipTextClear]}>
                  Clear
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Filter option picker modal */}
          <Modal
            visible={pickerOpen !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setPickerOpen(null)}
          >
            <TouchableOpacity
              style={styles.pickerBackdrop}
              activeOpacity={1}
              onPress={() => setPickerOpen(null)}
            >
              <View style={styles.pickerSheet}>
                <TouchableOpacity
                  activeOpacity={1}
                  onPress={(e) => e.stopPropagation()}
                  style={styles.pickerContent}
                >
                  <Text style={styles.pickerTitle}>
                    {pickerOpen === 'location' && 'Location'}
                    {pickerOpen === 'cuisine' && 'Cuisine'}
                    {pickerOpen === 'type' && 'Type'}
                  </Text>
                  <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
                    <TouchableOpacity
                      style={styles.pickerRow}
                      onPress={() => {
                        if (pickerOpen === 'location') setLocationFilter(null);
                        if (pickerOpen === 'cuisine') setCuisineFilter(null);
                        if (pickerOpen === 'type') setVibeFilter(null);
                        setPickerOpen(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.pickerRowTextClear}>Clear filter</Text>
                    </TouchableOpacity>
                    {pickerOpen === 'location' &&
                      savedLocationOptions.map((loc) => (
                        <TouchableOpacity
                          key={loc}
                          style={styles.pickerRow}
                          onPress={() => {
                            setLocationFilter(loc);
                            setPickerOpen(null);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.pickerRowText}>{loc}</Text>
                        </TouchableOpacity>
                      ))}
                    {pickerOpen === 'cuisine' &&
                      savedCuisineOptions.map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={styles.pickerRow}
                          onPress={() => {
                            setCuisineFilter(c);
                            setPickerOpen(null);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.pickerRowText}>{c}</Text>
                        </TouchableOpacity>
                      ))}
                    {pickerOpen === 'type' &&
                      VIBE_OPTIONS.map((opt) => (
                        <TouchableOpacity
                          key={opt.value}
                          style={styles.pickerRow}
                          onPress={() => {
                            setVibeFilter(opt.value);
                            setPickerOpen(null);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.pickerRowText}>{opt.label}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>
          {savedLoading ? (
            <Text style={styles.emptyHint}>Loading…</Text>
          ) : savedRestaurants.length > 0 ? (
            (() => {
              const enhanced = savedRestaurants.map((item) => {
                // Very small cuisine guess for demo: real implementation would come from metadata.
                const lowerName = item.name.toLowerCase();
                let cuisineGuess: string | null = null;
                if (lowerName.includes('pizza')) cuisineGuess = 'Pizza';
                else if (lowerName.includes('sushi')) cuisineGuess = 'Sushi';
                else if (lowerName.includes('taco') || lowerName.includes('taquer')) cuisineGuess = 'Mexican';
                const tags = inferVibeTags({
                  name: item.name,
                  cuisine: cuisineGuess,
                  priceLevel: item.price_level ?? null,
                });
                return { item, tags, cuisine: cuisineGuess };
              });

              const filtered = enhanced.filter(({ item, cuisine, tags }) => {
                if (locationFilter && item.neighborhood !== locationFilter) {
                  return false;
                }
                if (cuisineFilter && cuisine !== cuisineFilter) {
                  return false;
                }
                if (vibeFilter && !tags.includes(vibeFilter)) {
                  return false;
                }
                return true;
              });

              const sorted = [...filtered].sort((a, b) => {
                if (sortMode === 'alpha') {
                  return a.item.name.localeCompare(b.item.name);
                }
                return (
                  new Date(b.item.savedAt).getTime() -
                  new Date(a.item.savedAt).getTime()
                );
              });

              if (sorted.length === 0) {
                return (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateTitle}>No saved restaurants match these filters</Text>
                    <Text style={styles.emptyStateSub}>Clear a filter or save more from Discover or Tonight.</Text>
                  </View>
                );
              }

              return sorted.map(({ item, tags }) => (
                <SavedRestaurantListCard
                  key={item.place_id ?? item.restaurantId}
                  item={item}
                  tags={tags}
                  onRemove={removeSaved}
                />
              ));
            })()
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>No saved restaurants yet</Text>
              <Text style={styles.emptyStateSub}>Swipe right in Tonight or tap Save on a restaurant.</Text>
            </View>
          )}
        </View>

        {/* All visits (personal log history, grouped by restaurant) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>All visits</Text>
          <Text style={styles.sectionSubtitle}>Filter inline to explore their taste</Text>

          <View style={styles.visitFilterRow}>
            <TouchableOpacity
              style={[styles.visitFilterChip, visitCuisineFilter && styles.visitFilterChipActive]}
              onPress={() => setActiveVisitFilter((prev) => (prev === 'cuisine' ? null : 'cuisine'))}
              activeOpacity={0.85}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text
                style={[
                  styles.visitFilterChipText,
                  visitCuisineFilter && styles.visitFilterChipTextActive,
                ]}
              >
                {visitCuisineFilter ? `Cuisine: ${visitCuisineFilter}` : 'Cuisine'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.visitFilterChip, visitLocationFilter && styles.visitFilterChipActive]}
              onPress={() => setActiveVisitFilter((prev) => (prev === 'location' ? null : 'location'))}
              activeOpacity={0.85}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text
                style={[
                  styles.visitFilterChipText,
                  visitLocationFilter && styles.visitFilterChipTextActive,
                ]}
              >
                {visitLocationFilter ? `Location: ${visitLocationFilter}` : 'Location'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.visitFilterChip,
                visitRatingFilter !== 'any' && styles.visitFilterChipActive,
              ]}
              onPress={() => setActiveVisitFilter((prev) => (prev === 'rating' ? null : 'rating'))}
              activeOpacity={0.85}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text
                style={[
                  styles.visitFilterChipText,
                  visitRatingFilter !== 'any' && styles.visitFilterChipTextActive,
                ]}
              >
                {visitRatingFilter === 'any'
                  ? 'Rating'
                  : `Rating: ${visitRatingFilter === '9plus' ? '9+' : '8+'}`}
              </Text>
            </TouchableOpacity>
          </View>

          {activeVisitFilter === 'cuisine' ? (
            <View style={styles.visitOptionsWrap}>
              <TouchableOpacity
                style={[styles.visitOptionChip, visitCuisineFilter == null && styles.visitOptionChipActive]}
                onPress={() => setVisitCuisineFilter(null)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.visitOptionChipText,
                    visitCuisineFilter == null && styles.visitOptionChipTextActive,
                  ]}
                >
                  Any
                </Text>
              </TouchableOpacity>
              {topCuisines.map((c) => {
                const active = visitCuisineFilter === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[styles.visitOptionChip, active && styles.visitOptionChipActive]}
                    onPress={() => setVisitCuisineFilter((prev) => (prev === c ? null : c))}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.visitOptionChipText,
                        active && styles.visitOptionChipTextActive,
                      ]}
                    >
                      {c}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {activeVisitFilter === 'location' ? (
            <View style={styles.visitOptionsWrap}>
              <TouchableOpacity
                style={[
                  styles.visitOptionChip,
                  visitLocationFilter == null && styles.visitOptionChipActive,
                ]}
                onPress={() => setVisitLocationFilter(null)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.visitOptionChipText,
                    visitLocationFilter == null && styles.visitOptionChipTextActive,
                  ]}
                >
                  Any
                </Text>
              </TouchableOpacity>
              {favoriteAreas.map((area) => {
                const active = visitLocationFilter === area;
                return (
                  <TouchableOpacity
                    key={area}
                    style={[styles.visitOptionChip, active && styles.visitOptionChipActive]}
                    onPress={() => setVisitLocationFilter((prev) => (prev === area ? null : area))}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.visitOptionChipText,
                        active && styles.visitOptionChipTextActive,
                      ]}
                    >
                      {area}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {activeVisitFilter === 'rating' ? (
            <View style={styles.visitOptionsWrap}>
              <TouchableOpacity
                style={[
                  styles.visitOptionChip,
                  visitRatingFilter === 'any' && styles.visitOptionChipActive,
                ]}
                onPress={() => setVisitRatingFilter('any')}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.visitOptionChipText,
                    visitRatingFilter === 'any' && styles.visitOptionChipTextActive,
                  ]}
                >
                  Any
                </Text>
              </TouchableOpacity>
              {(['8plus', '9plus'] as const).map((opt) => {
                const active = visitRatingFilter === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.visitOptionChip, active && styles.visitOptionChipActive]}
                    onPress={() => setVisitRatingFilter(opt)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.visitOptionChipText,
                        active && styles.visitOptionChipTextActive,
                      ]}
                    >
                      {opt === '9plus' ? '9+' : '8+'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {filteredVisitGroups.length > 0 ? (
            <View style={styles.cardList}>
              {filteredVisitGroups.map((group) => (
                <ProfileVisitGroupCard key={group.restaurantId} group={group} />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyHint}>No visits match these filters.</Text>
          )}
        </View>

        {/* Find friends */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/(tabs)/profile/find-friends')}
            activeOpacity={0.7}
          >
            <Ionicons name="people-outline" size={24} color={colors.text} />
            <Text style={styles.rowText}>Find friends</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, paddingTop: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  avatarWrap: { marginRight: 12 },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarInitial: { fontSize: 22, fontWeight: '700', color: colors.text },
  headerMeta: { flex: 1 },
  displayName: { fontSize: 20, fontWeight: '700', color: colors.text },
  username: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 4 },
  location: { fontSize: 12, color: colors.textMuted },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  statTouch: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 13, color: colors.textMuted },
  statDivider: { width: 1, height: 14, backgroundColor: colors.border },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  followBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  followBtnTextActive: {
    color: '#111827',
  },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sectionSubtitle: { marginTop: 1, fontSize: 13, color: colors.textMuted, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cuisineChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cuisineChipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  cuisineChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  cuisineChipTextActive: {
    color: '#111827',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  placeName: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1 },
  ratingPill: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  ratingValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  topPlacesScroll: { gap: 12, paddingRight: 20 },
  topPlaceCard: {
    width: 120,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topPlacePhoto: { width: 120, height: 88, backgroundColor: colors.surfaceSoft },
  topPlaceName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
  },
  topPlaceScore: {
    alignSelf: 'flex-start',
    marginHorizontal: 8,
    marginBottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topPlaceScoreText: { fontSize: 12, fontWeight: '700', color: colors.text },
  visitFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
  },
  visitFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  visitFilterChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  visitFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  visitFilterChipTextActive: {
    color: '#111827',
  },
  visitOptionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  visitOptionChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  visitOptionChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  visitOptionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  visitOptionChipTextActive: {
    color: '#111827',
  },
  cardList: { gap: 8 },
  cardWrap: { marginBottom: 0 },
  emptyHint: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic', marginTop: 4 },
  emptyState: { marginTop: 8 },
  emptyStateTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  emptyStateSub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 10,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  filterChipTextActive: {
    color: '#111827',
  },
  filterChipClear: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  filterChipTextClear: {
    color: colors.textMuted,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    maxHeight: '50%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  pickerContent: {
    padding: 20,
    paddingBottom: 32,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  pickerList: {
    maxHeight: 280,
  },
  pickerRow: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerRowText: {
    fontSize: 16,
    color: colors.text,
  },
  pickerRowTextClear: {
    fontSize: 16,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  visitGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 10,
  },
  visitGroupPhoto: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  visitGroupMeta: {
    flex: 1,
  },
  visitGroupSummary: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  visitHistory: {
    marginTop: 6,
    marginLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingLeft: 10,
  },
  visitHistoryRow: {
    marginBottom: 6,
  },
  visitHistoryDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  visitHistoryScore: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  visitHistoryNote: {
    fontSize: 12,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, marginLeft: 12, fontSize: 16, color: colors.text },
  bottomPad: { height: 32 },
});

function formatVisitDate(dateString?: string | null): string {
  if (!dateString) return 'Most recent visit';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return 'Most recent visit';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ProfileVisitGroupCard({
  group,
}: {
  group: {
    restaurantId: string;
    restaurantName: string;
    visits: import('~/src/components/FeedCard').FeedLog[];
    visitCount: number;
    bestScore: number;
    lastVisitAt: string | null;
    previewPhotoUrl?: string;
  };
}) {
  const [expanded, setExpanded] = useState(false);
  const photo =
    group.previewPhotoUrl && group.previewPhotoUrl.startsWith('http')
      ? group.previewPhotoUrl
      : 'https://placehold.co/800x600/e5e7eb/6b7280?text=No+photo';

  const summaryLine = `${group.visitCount} visit${group.visitCount === 1 ? '' : 's'} • Best ${group.bestScore.toFixed(
    1,
  )} • ${formatVisitDate(group.lastVisitAt)}`;

  return (
    <View style={styles.cardWrap}>
      <TouchableOpacity
        style={styles.visitGroupRow}
        onPress={() => setExpanded((e) => !e)}
        activeOpacity={0.8}
      >
        <Image source={{ uri: photo }} style={styles.visitGroupPhoto} />
        <View style={styles.visitGroupMeta}>
          <Text style={styles.placeName} numberOfLines={1}>
            {group.restaurantName}
          </Text>
          <Text style={styles.visitGroupSummary}>{summaryLine}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.visitHistory}>
          {group.visits.map((v) => (
            <View key={v.id} style={styles.visitHistoryRow}>
              <Text style={styles.visitHistoryDate}>
                {formatVisitDate(v.createdAt)}
              </Text>
              <Text style={styles.visitHistoryScore}>
                {v.score.toFixed(1)}
              </Text>
              {v.note ? (
                <Text style={styles.visitHistoryNote} numberOfLines={2}>
                  “{v.note}”
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
