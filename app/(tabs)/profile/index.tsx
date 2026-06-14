import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFeedContext } from '~/src/context/FeedContext';
import { useSavedRestaurants } from '~/src/context/SavedRestaurantsContext';
import { getMe, type UserSummary } from '~/src/api/users';
import { useAuthContext } from '~/src/context/AuthContext';
import type { SavedRestaurantItem } from '~/src/api/saved';
import { getSocialProfile } from '~/src/data/socialProfiles';
import { RestaurantImage } from '~/src/components/RestaurantImage';
import { apiClient } from '~/src/api/client';
import { colors } from '~/src/theme/colors';

const MY_USER_NAME = 'You';
const { width: SW } = Dimensions.get('window');
const GRID_GAP = 12;
const GRID_PADDING = 18;
const GRID_CARD_W = (SW - GRID_PADDING * 2 - GRID_GAP) / 2;

// ── Cuisine identity ──────────────────────────────────────────────────────────

const CUISINE_EMOJIS: Record<string, string> = {
  Pizza: '🍕', Italian: '🍝', Japanese: '🍱', Sushi: '🍣',
  Mexican: '🌮', American: '🍔', Chinese: '🥟', Indian: '🍛',
  Thai: '🍜', Korean: '🥩', Brunch: '🥞', Seafood: '🦞',
  BBQ: '🔥', Coffee: '☕', Bakery: '🥐', Mediterranean: '🫒',
  Vegan: '🥗', Vegetarian: '🥦',
};

const DNA_COLORS = [
  { bg: '#FFF0E8', text: '#FF6B35' },
  { bg: '#FFFBE8', text: '#D97706' },
  { bg: '#FFF0F4', text: '#C2185B' },
  { bg: '#EEF6F0', text: '#2E7D32' },
];

function getCuisineEmoji(cuisine: string): string {
  const lower = cuisine.toLowerCase();
  for (const [key, emoji] of Object.entries(CUISINE_EMOJIS)) {
    if (lower.includes(key.toLowerCase())) return emoji;
  }
  return '🍽';
}

function getCuisineTag(cuisine: string): string {
  const raw = cuisine?.trim() || '';
  return raw.split(/[·•\-]/)[0]?.trim() || raw;
}

function getTopCuisines(logs: { cuisine: string; score: number }[]): string[] {
  const map: Record<string, { count: number; sum: number }> = {};
  for (const log of logs) {
    const tag = getCuisineTag(log.cuisine);
    if (!tag) continue;
    map[tag] = map[tag] ?? { count: 0, sum: 0 };
    map[tag].count += 1;
    map[tag].sum += log.score ?? 0;
  }
  return Object.entries(map)
    .sort((a, b) => b[1].count - a[1].count || b[1].sum / b[1].count - a[1].sum / a[1].count)
    .slice(0, 4)
    .map(([name]) => name);
}

function getTopArea(logs: { neighborhood?: string; state?: string }[]): string | null {
  const map: Record<string, number> = {};
  for (const log of logs) {
    const key = log.neighborhood?.trim() || log.state?.trim();
    if (key) map[key] = (map[key] ?? 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type VisitGroup = {
  restaurantId: string;
  restaurantName: string;
  bestScore: number;
  previewPhotoUrl?: string;
  visitCount: number;
  cuisine?: string;
  neighborhood?: string;
  note?: string;
};

// ── EatsCard ─────────────────────────────────────────────────────────────────

function EatsCard({ group, onPress }: { group: VisitGroup; onPress: () => void }) {
  const repeat = group.visitCount > 1;
  return (
    <TouchableOpacity style={eats.card} onPress={onPress} activeOpacity={0.88}>
      <RestaurantImage
        restaurant={{
          id: group.restaurantId,
          name: group.restaurantName,
        }}
        aspectRatio={GRID_CARD_W / 120}
        fallbackType="icon"
        borderRadius={0}
        style={eats.photo}
      />
      <View style={eats.scoreBadge}>
        <Text style={eats.scoreText}>{group.bestScore.toFixed(1)}</Text>
      </View>
      {repeat ? (
        <View style={eats.visitBadge}>
          <Ionicons name="repeat" size={10} color="#fff" />
          <Text style={eats.visitBadgeText}>{group.visitCount}</Text>
        </View>
      ) : null}
      <View style={eats.info}>
        <Text style={eats.name} numberOfLines={2}>{group.restaurantName}</Text>
        {repeat && (
          <Text style={eats.visits}>{group.visitCount} visits</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── EatsListRow ─────────────────────────────────────────────────────────────

function EatsListRow({ group, onPress }: { group: VisitGroup; onPress: () => void }) {
  const meta = [group.cuisine, group.neighborhood].filter(Boolean).join(' · ');
  const repeat = group.visitCount > 1;
  return (
    <TouchableOpacity style={elist.row} onPress={onPress} activeOpacity={0.8}>
      <View style={elist.thumbWrap}>
        <RestaurantImage
          restaurant={{ id: group.restaurantId, name: group.restaurantName }}
          aspectRatio={1}
          fallbackType="icon"
          borderRadius={12}
          style={elist.thumb}
        />
      </View>
      <View style={elist.info}>
        <View style={elist.nameRow}>
          <Text style={elist.name} numberOfLines={1}>{group.restaurantName}</Text>
          {repeat ? (
            <View style={elist.visitPill}>
              <Ionicons name="repeat" size={10} color={colors.accent} />
              <Text style={elist.visitPillText}>{group.visitCount}</Text>
            </View>
          ) : null}
        </View>
        {meta ? <Text style={elist.meta} numberOfLines={1}>{meta}</Text> : null}
        {group.note ? <Text style={elist.note} numberOfLines={1}>{group.note}</Text> : null}
      </View>
      <View style={[elist.scorePill, group.bestScore >= 8.0 && elist.scorePillHigh]}>
        <Text style={[elist.scoreText, group.bestScore >= 8.0 && elist.scoreTextHigh]}>
          {group.bestScore.toFixed(1)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const elist = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  thumbWrap: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden' },
  thumb: { width: 48, height: 48 },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: -0.2, flexShrink: 1 },
  visitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  visitPillText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  meta: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  note: { fontSize: 12, fontWeight: '500', color: colors.textFaint, fontStyle: 'italic', marginTop: 2 },
  scorePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  scorePillHigh: { backgroundColor: colors.accent },
  scoreText: { fontSize: 14, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  scoreTextHigh: { color: '#fff' },
});

const eats = StyleSheet.create({
  card: {
    width: GRID_CARD_W,
    borderRadius: 16,
    backgroundColor: '#fff',
    overflow: 'hidden',
    shadowColor: 'rgba(180,120,80,0.12)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  photo: { width: '100%', height: 120 },
  scoreBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  scoreText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  visitBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  visitBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  info: { padding: 10, paddingTop: 8 },
  name: { fontSize: 13, fontWeight: '700', color: colors.text, lineHeight: 18 },
  visits: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: '500' },
});

// ── SavedCard ────────────────────────────────────────────────────────────────

function SavedCard({ item, onPress }: { item: SavedRestaurantItem; onPress: () => void }) {
  const isSwipe = item.source === 'swipe';
  return (
    <TouchableOpacity style={sv.card} onPress={onPress} activeOpacity={0.88}>
      {/* Image props mirror what Discover (RestaurantCard) and Tonight pass
          so the resolver and cache hit identical paths — same id, same
          fallbacks, same retry chain. */}
      <RestaurantImage
        restaurant={{
          id: item.restaurantId,
          name: item.name,
          cuisine: item.cuisine ?? '',
          googlePlaceId: item.googlePlaceId ?? null,
          displayImageUrl: item.displayImageUrl ?? item.previewPhotoUrl ?? null,
          displayImageSourceType: item.displayImageSourceType ?? null,
          displayImageLastResolvedAt: item.displayImageLastResolvedAt ?? null,
          imageUrl: null,
          previewPhotoUrl: item.previewPhotoUrl ?? null,
        }}
        aspectRatio={1}
        fallbackType="icon"
        borderRadius={12}
        style={sv.photo}
      />
      <View style={sv.meta}>
        <Text style={sv.name} numberOfLines={1}>{item.name}</Text>
        {(item.neighborhood || item.city) ? (
          <View style={sv.locationRow}>
            <Ionicons name="location-outline" size={11} color={colors.accent} />
            <Text style={sv.location} numberOfLines={1}>
              {[item.neighborhood, item.city].filter(Boolean).join(', ')}
            </Text>
          </View>
        ) : null}
        <View style={sv.tag}>
          <Text style={sv.tagText}>{isSwipe ? 'Swiped 🔥' : 'Bookmarked 🔖'}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.border} />
    </TouchableOpacity>
  );
}

const sv = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    shadowColor: 'rgba(180,120,80,0.12)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  photo: { width: 60, height: 60, borderRadius: 12 },
  meta: { flex: 1, marginLeft: 12, marginRight: 8 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 3 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 5 },
  location: { fontSize: 12, color: colors.textMuted, flex: 1 },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontSize: 11, fontWeight: '600', color: colors.accent },
});

// ── Avatar with image-error fallback ──────────────────────────────────────────
// Renders the uploaded photo when present. If the Image fails to load
// (404, Supabase URL inaccessible, network blip), falls back to the
// gradient + initial so the slot never goes blank. Tap opens the photo
// editor for self.

function AvatarHeader({
  isSelf, avatarUrl, displayName, onPress,
}: {
  isSelf: boolean;
  avatarUrl: string | null;
  displayName: string;
  onPress: () => void;
}) {
  // Reset the errored flag when avatarUrl changes — without this, once
  // any URL failed to load, subsequent uploads stayed invisible because
  // errored stuck at true and the gradient fallback kept rendering even
  // when the new image was perfectly valid. This is the "I changed my
  // photo but the old initials/gradient still shows" bug.
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [avatarUrl]);
  const showImage = !!avatarUrl && !errored;
  const node = showImage ? (
    <Image
      // Cache-bust the URI when it includes a timestamp (our upload path
      // is <userId>/<Date.now()>.<ext> so each upload has a unique URL).
      // For overrides that reuse the same URL, the key prop forces React
      // Native to discard any cached image data tied to the old URI.
      key={avatarUrl}
      source={{ uri: avatarUrl as string }}
      style={s.avatar}
      onError={() => setErrored(true)}
    />
  ) : (
    <LinearGradient
      colors={['#C4899A', '#8B3A4A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.avatar}
    >
      <Text style={s.avatarInitial}>{displayName[0]?.toUpperCase() ?? '?'}</Text>
    </LinearGradient>
  );
  if (!isSelf) return node;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityLabel="Change profile photo"
      accessibilityRole="button"
    >
      {node}
    </TouchableOpacity>
  );
}

// ── ProfileScreen ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userName?: string }>();
  const profileUserName =
    (typeof params.userName === 'string' ? params.userName : params.userName?.[0])?.trim() ||
    MY_USER_NAME;
  const isSelf = profileUserName === MY_USER_NAME;
  const socialProfile = useMemo(
    () => (isSelf ? null : getSocialProfile(profileUserName)),
    [isSelf, profileUserName],
  );

  const { items } = useFeedContext();
  const { savedRestaurants } = useSavedRestaurants();
  const auth = useAuthContext();
  const myUserId = auth.user?.id ?? null;
  const [me, setMe] = useState<UserSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'eats' | 'saved'>('eats');
  const [eatsView, setEatsView] = useState<'grid' | 'list'>('list');
  const [savedFilter, setSavedFilter] = useState<'all' | 'swipe' | 'manual'>('all');
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [citySearch, setCitySearch] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<{ label: string }[]>([]);
  const [cityGeoLoading, setCityGeoLoading] = useState(false);
  const cityReqIdRef = useRef(0);
  const cityCacheRef = useRef<Record<string, { label: string }[]>>({});
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Refresh on every focus, not just mount — so returning from edit-name /
  // edit-username / profile-photo immediately reflects the new value
  // (avatarUrl in particular wouldn't update otherwise).
  useFocusEffect(
    useCallback(() => {
      if (!isSelf) return;
      let cancelled = false;
      getMe()
        .then((u) => { if (!cancelled) setMe(u); })
        .catch(() => { if (!cancelled) setMe(null); });
      return () => { cancelled = true; };
    }, [isSelf]),
  );


  // Match by userName AND require userId — INITIAL_LOGS (mock seed) has a
  // demo "You went to Lou Malnati's" entry with no userId, which inflated
  // the self-profile log count by 1. Real logs from /api/feed always carry
  // a userId; the seed never will.
  //
  // For the SELF profile, we also include logs where the current user was
  // tagged (`taggedUsers` contains their userId). Being tagged means they
  // were actually at that restaurant with the author, so the visit
  // belongs in "My Eats" alongside their authored logs. The visit-count
  // grouper below treats tagged and authored visits equally — exactly
  // what we want for "how many times have I been here?".
  const profileLogs = useMemo(() => {
    return items.filter((l) => {
      if (l.userName === profileUserName && (!isSelf || !!l.userId)) return true;
      if (isSelf && myUserId && Array.isArray(l.taggedUsers)) {
        return l.taggedUsers.some((t) => t.userId === myUserId);
      }
      return false;
    });
  }, [items, profileUserName, isSelf, myUserId]);

  const visitGroups = useMemo<VisitGroup[]>(() => {
    const byId: Record<string, VisitGroup> = {};
    for (const log of profileLogs) {
      const k = log.restaurantId;
      if (!byId[k]) {
        byId[k] = {
          restaurantId: k,
          restaurantName: log.restaurantName,
          bestScore: log.score,
          previewPhotoUrl: log.previewPhotoUrl,
          visitCount: 1,
          cuisine: log.cuisine,
          neighborhood: log.neighborhood,
          note: log.note,
        };
      } else {
        byId[k].visitCount += 1;
        if (log.score > byId[k].bestScore) {
          byId[k].bestScore = log.score;
          if (log.note) byId[k].note = log.note;
        }
        if (log.previewPhotoUrl) byId[k].previewPhotoUrl = log.previewPhotoUrl;
        if (!byId[k].cuisine && log.cuisine) byId[k].cuisine = log.cuisine;
        if (!byId[k].neighborhood && log.neighborhood) byId[k].neighborhood = log.neighborhood;
      }
    }
    return Object.values(byId).sort((a, b) => b.bestScore - a.bestScore);
  }, [profileLogs]);

  const topCuisines = useMemo(() => getTopCuisines(profileLogs), [profileLogs]);
  const topArea = useMemo(() => getTopArea(profileLogs), [profileLogs]);
  const avgScore = useMemo(() => {
    if (profileLogs.length === 0) return null;
    const total = profileLogs.reduce((sum, log) => sum + log.score, 0);
    return total / profileLogs.length;
  }, [profileLogs]);
  const visibleSavedRestaurants = isSelf ? savedRestaurants : socialProfile?.savedRestaurants ?? [];
  const wantsToTryCount = !isSelf ? visibleSavedRestaurants.length : null;

  // Geo autocomplete for city search
  useEffect(() => {
    if (!citySheetOpen) return;
    const q = citySearch.trim();
    if (!q) {
      setCitySuggestions([]);
      setCityGeoLoading(false);
      return;
    }
    const key = q.toLowerCase();
    const cached = cityCacheRef.current[key];
    if (cached) {
      setCitySuggestions(cached);
      setCityGeoLoading(false);
      return;
    }
    setCityGeoLoading(true);
    const reqId = ++cityReqIdRef.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get<{ results: { label: string }[] }>('/api/geo/autocomplete', {
          params: { query: q },
        });
        if (cityReqIdRef.current !== reqId) return;
        const results = Array.isArray(data?.results) ? data.results : [];
        cityCacheRef.current[key] = results;
        setCitySuggestions(results);
      } catch {
        if (cityReqIdRef.current !== reqId) return;
        setCitySuggestions([]);
      } finally {
        if (cityReqIdRef.current !== reqId) return;
        setCityGeoLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [citySheetOpen, citySearch]);

  // City filter — unique cities from both eats and saved data
  const availableCities = useMemo(() => {
    const seen = new Set<string>();
    profileLogs.forEach((l) => {
      const city = l.city?.trim();
      if (city) seen.add(city);
    });
    visibleSavedRestaurants.forEach((r) => {
      const city = r.city?.trim();
      if (city) seen.add(city);
    });
    return Array.from(seen).sort();
  }, [profileLogs, visibleSavedRestaurants]);

  const filteredSaved = useMemo(() => {
    let list = visibleSavedRestaurants;
    if (savedFilter !== 'all') list = list.filter((r) => r.source === savedFilter);
    if (cityFilter) {
      // Compare against the first meaningful token of the filter (e.g.
      // "Northville, MI, USA" → "northville") so an address from a different
      // city won't match. We require the address to contain that token.
      const cfFull = cityFilter.toLowerCase();
      const cfCityToken = cfFull.split(',')[0].trim();
      list = list.filter((r) => {
        const city = r.city?.trim().toLowerCase() || '';
        const addr = r.address?.toLowerCase() ?? '';
        // City-field match: must have a non-empty city and it must overlap.
        if (city && (city === cfFull || city === cfCityToken
                    || city.includes(cfCityToken) || cfCityToken.includes(city))) {
          return true;
        }
        // Address match: the city token must literally appear in the address.
        if (cfCityToken && addr.includes(cfCityToken)) return true;
        return false;
      });
    }
    return list;
  }, [visibleSavedRestaurants, savedFilter, cityFilter]);

  // Filtered eats by city — same matching rules as filteredSaved above.
  const filteredVisitGroups = useMemo(() => {
    if (!cityFilter) return visitGroups;
    const cfFull = cityFilter.toLowerCase();
    const cfCityToken = cfFull.split(',')[0].trim();
    const matchingRestaurantIds = new Set(
      profileLogs
        .filter((l) => {
          const city = l.city?.trim().toLowerCase() || '';
          const addr = l.address?.toLowerCase() ?? '';
          if (city && (city === cfFull || city === cfCityToken
                      || city.includes(cfCityToken) || cfCityToken.includes(city))) {
            return true;
          }
          if (cfCityToken && addr.includes(cfCityToken)) return true;
          return false;
        })
        .map((l) => l.restaurantId),
    );
    return visitGroups.filter((g) => matchingRestaurantIds.has(g.restaurantId));
  }, [visitGroups, profileLogs, cityFilter]);

  // Traveling banner: show when there's a non-primary city in saved restaurants
  const PRIMARY_CITY = 'Chicago';
  const travelCity = availableCities.find((c) => c !== PRIMARY_CITY);
  const travelCount = travelCity
    ? visibleSavedRestaurants.filter((r) => r.city?.trim() === travelCity).length
    : 0;
  const showTravelBanner =
    isSelf && !!travelCity && travelCount > 0 && !bannerDismissed && activeTab === 'saved';

  // Count line for active city filter
  const cityCountLabel = useMemo(() => {
    if (!cityFilter) return null;
    const eatsCount = filteredVisitGroups.length;
    const savedCount = filteredSaved.length;
    if (activeTab === 'eats') return `${eatsCount} restaurant${eatsCount !== 1 ? 's' : ''} in ${cityFilter}`;
    return `${savedCount} saved spot${savedCount !== 1 ? 's' : ''} in ${cityFilter}`;
  }, [cityFilter, activeTab, filteredVisitGroups.length, filteredSaved.length]);

  // Auto-dismiss travel banner after 5 seconds
  useEffect(() => {
    if (!showTravelBanner) return;
    const t = setTimeout(() => setBannerDismissed(true), 5000);
    return () => clearTimeout(t);
  }, [showTravelBanner]);

  const displayName = isSelf ? me?.displayName || MY_USER_NAME : socialProfile?.displayName || profileUserName;
  const followerCount = isSelf ? me?.followerCount ?? 0 : socialProfile?.followerCount ?? 0;
  const followingCount = isSelf ? me?.followingCount ?? 0 : socialProfile?.followingCount ?? 0;
  const stats = [
    {
      key: 'avg',
      label: 'Avg Score',
      value: avgScore != null ? avgScore.toFixed(1) : '—',
      accent: true,
      icon: 'star',
    },
    {
      key: 'logs',
      label: 'Logs',
      value: String(profileLogs.length),
      accent: false,
      icon: null,
    },
    ...(!isSelf
      ? [
          {
            key: 'saved',
            label: 'Wants to try',
            value: String(wantsToTryCount ?? 0),
            accent: false,
            icon: null,
          },
        ]
      : []),
    {
      key: 'followers',
      label: 'Followers',
      value: String(followerCount),
      accent: false,
      icon: null,
    },
    {
      key: 'following',
      label: 'Following',
      value: String(followingCount),
      accent: false,
      icon: null,
    },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={s.headerTop}>
            <AvatarHeader
              isSelf={isSelf}
              avatarUrl={isSelf ? me?.avatarUrl ?? null : null}
              displayName={displayName}
              onPress={() => router.push('/(tabs)/profile/profile-photo' as never)}
            />
            <View style={s.headerInfo}>
              <Text style={s.displayName}>{displayName}</Text>
              {isSelf && me?.username ? (
                <Text style={s.handle} numberOfLines={1}>@{me.username}</Text>
              ) : null}
              <View style={s.locationRow}>
                <Text style={s.locationPin}>📍</Text>
                <Text style={s.locationText}>Chicago, IL</Text>
              </View>
            </View>
            <View style={s.headerActions}>
              {isSelf ? (
                <TouchableOpacity
                  style={s.headerIconBtn}
                  onPress={() => router.push('/(tabs)/profile/find-friends')}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Ionicons name="person-add-outline" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={s.headerIconBtn}
                onPress={() => router.push('/(tabs)/profile/settings')}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.statsCard}>
            {stats.map((stat, index) => {
              const target =
                stat.key === 'followers'
                  ? '/(tabs)/profile/followers'
                  : stat.key === 'following'
                    ? '/(tabs)/profile/following'
                    : null;
              const content = (
                <View style={s.stat}>
                  <View style={s.statValueRow}>
                    {stat.icon ? (
                      <Ionicons
                        name={stat.icon as 'star'}
                        size={14}
                        color={stat.accent ? colors.accent : colors.text}
                        style={s.statIcon}
                      />
                    ) : null}
                    <Text style={[s.statValue, stat.accent && s.statValueAccent]}>{stat.value}</Text>
                  </View>
                  <Text style={s.statLabel}>{stat.label}</Text>
                </View>
              );
              return (
                <View key={stat.key} style={s.statBlock}>
                  {target ? (
                    <TouchableOpacity
                      onPress={() => router.push(target as never)}
                      activeOpacity={0.6}
                      style={s.statTouchable}
                    >
                      {content}
                    </TouchableOpacity>
                  ) : (
                    content
                  )}
                  {index < stats.length - 1 ? <View style={s.statDivider} /> : null}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Taste DNA ───────────────────────────────────────────────── */}
        {profileLogs.length >= 3 ? (
          <View style={s.dnaSection}>
            <Text style={s.dnaLabel}>✨ Your Taste DNA</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.dnaScroll}
            >
              {topCuisines.map((cuisine, i) => {
                const chip = DNA_COLORS[i % DNA_COLORS.length];
                return (
                  <View key={cuisine} style={[s.dnaChip, { backgroundColor: chip.bg }]}>
                    <Text style={s.dnaEmoji}>{getCuisineEmoji(cuisine)}</Text>
                    <Text style={[s.dnaChipText, { color: chip.text }]}>{cuisine}</Text>
                  </View>
                );
              })}
            </ScrollView>
            {topArea ? (
              <Text style={s.dnaArea}>Mostly eating in {topArea}</Text>
            ) : null}
          </View>
        ) : (
          <View style={s.dnaEncouragement}>
            <Text style={s.dnaEncTitle}>✨ Unlock Your Taste DNA</Text>
            <Text style={s.dnaEncSub}>
              Log {Math.max(0, 3 - profileLogs.length)} more visit{3 - profileLogs.length === 1 ? '' : 's'} to reveal your flavor profile
            </Text>
            <View style={s.dnaDotsRow}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[s.dnaDot, i < profileLogs.length && s.dnaDotFilled]} />
              ))}
            </View>
          </View>
        )}

        {/* ── Location pill ─────────────────────────────────────────── */}
        {availableCities.length > 0 && (
          <View style={s.locationPillRow}>
            <TouchableOpacity
              style={[s.locationPill, !!cityFilter && s.locationPillActive]}
              onPress={() => setCitySheetOpen(true)}
              activeOpacity={0.8}
            >
              <Text style={s.locationPillIcon}>📍</Text>
              <Text style={[s.locationPillText, !!cityFilter && s.locationPillTextActive]}>
                {cityFilter ?? 'All Cities'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={cityFilter ? '#fff' : colors.textMuted} />
            </TouchableOpacity>
            {!!cityFilter && (
              <TouchableOpacity onPress={() => setCityFilter(null)} activeOpacity={0.7}>
                <Text style={s.locationClear}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {cityCountLabel && (
          <Text style={s.cityCountLabel}>{cityCountLabel}</Text>
        )}

        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        <View style={s.tabBar}>
          {(['eats', 'saved'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[s.tab, activeTab === tab && s.tabActive]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.8}
            >
              <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                {tab === 'eats' ? 'My Eats' : 'Saved'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── My Eats ─────────────────────────────────────────────────── */}
        {activeTab === 'eats' && (
          filteredVisitGroups.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>🍽</Text>
              <Text style={s.emptyTitle}>
                {cityFilter ? `No eats in ${cityFilter} yet` : 'Start logging your visits!'}
              </Text>
              <Text style={s.emptySub}>
                {cityFilter
                  ? 'Try a different city or clear the filter.'
                  : 'Your restaurant history will appear here.'}
              </Text>
              {!cityFilter && (
                <TouchableOpacity
                  style={s.emptyBtn}
                  onPress={() => router.push('/(tabs)/log-visit')}
                  activeOpacity={0.85}
                >
                  <Text style={s.emptyBtnText}>Log a visit</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {/* View toggle */}
              <View style={s.viewToggle}>
                <TouchableOpacity
                  style={[s.viewToggleBtn, eatsView === 'list' && s.viewToggleBtnActive]}
                  onPress={() => setEatsView('list')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="list" size={16} color={eatsView === 'list' ? colors.accent : colors.textFaint} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.viewToggleBtn, eatsView === 'grid' && s.viewToggleBtnActive]}
                  onPress={() => setEatsView('grid')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="grid" size={16} color={eatsView === 'grid' ? colors.accent : colors.textFaint} />
                </TouchableOpacity>
              </View>

              {eatsView === 'grid' ? (
                <View style={s.grid}>
                  {filteredVisitGroups.map((group) => (
                    <EatsCard
                      key={group.restaurantId}
                      group={group}
                      onPress={() =>
                        router.push(`/restaurant/${encodeURIComponent(group.restaurantId)}`)
                      }
                    />
                  ))}
                  {filteredVisitGroups.length % 2 !== 0 && <View style={{ width: GRID_CARD_W }} />}
                </View>
              ) : (
                <View style={s.listView}>
                  {filteredVisitGroups.map((group) => (
                    <EatsListRow
                      key={group.restaurantId}
                      group={group}
                      onPress={() =>
                        router.push(`/restaurant/${encodeURIComponent(group.restaurantId)}`)
                      }
                    />
                  ))}
                </View>
              )}
            </>
          )
        )}

        {/* ── Saved ───────────────────────────────────────────────────── */}
        {activeTab === 'saved' && (
          <>
            {/* Type filter */}
            <View style={s.filterRow}>
              {(['all', 'swipe', 'manual'] as const).map((f) => {
                const label = f === 'all' ? 'All' : f === 'swipe' ? 'Swiped 🔥' : 'Bookmarked 🔖';
                const active = savedFilter === f;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[s.filterPill, active && s.filterPillActive]}
                    onPress={() => setSavedFilter(f)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.filterPillText, active && s.filterPillTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Traveling banner */}
            {showTravelBanner && (
              <TouchableOpacity
                style={s.travelBanner}
                activeOpacity={0.85}
                onPress={() => { setCityFilter(travelCity!); setBannerDismissed(true); }}
              >
                <Text style={s.travelBannerText}>
                  📍 You're in {travelCity} — you have {travelCount} saved spot{travelCount === 1 ? '' : 's'} here
                </Text>
                <Text style={s.travelBannerCta}>Show them</Text>
              </TouchableOpacity>
            )}

            {filteredSaved.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>🔖</Text>
                {cityFilter ? (
                  <>
                    <Text style={s.emptyTitle}>No saved spots in {cityFilter} yet</Text>
                    <Text style={s.emptySub}>
                      Explore Tonight or Discover to find some
                    </Text>
                    <TouchableOpacity
                      style={s.emptyBtn}
                      onPress={() => router.push('/(tabs)')}
                      activeOpacity={0.85}
                    >
                      <Text style={s.emptyBtnText}>Explore</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={s.emptyTitle}>
                      {isSelf ? 'Nothing saved yet' : 'Nothing on the wants-to-try list yet'}
                    </Text>
                    <Text style={s.emptySub}>
                      {isSelf
                        ? 'Swipe on Tonight or bookmark from Discover to save spots.'
                        : `${displayName} has not saved any places to try yet.`}
                    </Text>
                  </>
                )}
              </View>
            ) : (
              <View style={s.savedList}>
                {filteredSaved.map((item) => (
                  <SavedCard
                    key={`${item.place_id ?? item.restaurantId}-${item.savedAt}`}
                    item={item}
                    onPress={() =>
                      router.push(
                        `/restaurant/${encodeURIComponent(item.restaurantId ?? item.place_id)}`,
                      )
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* City picker modal */}
      <Modal
        visible={citySheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => { setCitySheetOpen(false); setCitySearch(''); }}
      >
        <TouchableOpacity
          style={s.citySheetBackdrop}
          activeOpacity={1}
          onPress={() => { setCitySheetOpen(false); setCitySearch(''); }}
        >
          <View style={s.citySheet} onStartShouldSetResponder={() => true}>
            <Text style={s.citySheetTitle}>Filter by City</Text>

            <TextInput
              style={s.citySheetSearch}
              placeholder="Search a city..."
              placeholderTextColor={colors.textFaint}
              value={citySearch}
              onChangeText={setCitySearch}
              autoCapitalize="words"
              autoCorrect={false}
            />

            {citySearch.trim().length > 0 && citySuggestions.length > 0 && (
              <View style={s.citySuggestionsCard}>
                {citySuggestions.map((sug, idx) => (
                  <TouchableOpacity
                    key={`${sug.label}-${idx}`}
                    style={[s.citySuggestionRow, idx < citySuggestions.length - 1 && s.citySuggestionRowBorder]}
                    onPress={() => {
                      setCityFilter(sug.label);
                      setCitySheetOpen(false);
                      setCitySearch('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.citySuggestionText}>{sug.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {citySearch.trim().length > 0 && cityGeoLoading && (
              <View style={s.citySuggestionsCard}>
                <View style={s.citySuggestionRow}>
                  <Text style={[s.citySuggestionText, { color: colors.textFaint }]}>Searching…</Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={s.citySheetRow}
              onPress={() => { setCityFilter(null); setCitySheetOpen(false); setCitySearch(''); }}
              activeOpacity={0.8}
            >
              <Text style={[s.citySheetRowText, !cityFilter && s.citySheetRowTextActive]}>
                All Cities
              </Text>
              {!cityFilter && <Ionicons name="checkmark" size={18} color={colors.accent} />}
            </TouchableOpacity>

            {availableCities
              .filter((c) => !citySearch.trim() || c.toLowerCase().includes(citySearch.trim().toLowerCase()))
              .map((city) => (
                <TouchableOpacity
                  key={city}
                  style={s.citySheetRow}
                  onPress={() => { setCityFilter(city); setCitySheetOpen(false); setCitySearch(''); }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.citySheetRowText, cityFilter === city && s.citySheetRowTextActive]}>
                    {city}
                  </Text>
                  {cityFilter === city && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                </TouchableOpacity>
              ))}

            <TouchableOpacity
              style={s.citySheetDoneBtn}
              onPress={() => { setCitySheetOpen(false); setCitySearch(''); }}
              activeOpacity={0.85}
            >
              <Text style={s.citySheetDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 40 },

  // ── Header ──
  header: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 14,
  },
  settingsBtn: {
    padding: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconBtn: {
    padding: 6,
  },
  statTouchable: {
    flex: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 22, fontWeight: '700', color: '#fff' },
  displayName: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 3,
  },
  handle: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  locationPin: { fontSize: 12 },
  locationText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: '100%',
    shadowColor: 'rgba(180,120,80,0.10)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: { flex: 1, alignItems: 'center' },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statIcon: {
    marginTop: 1,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  statValueAccent: { color: colors.accent },
  statLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border, marginHorizontal: 8 },

  // ── Taste DNA ──
  dnaSection: {
    marginHorizontal: GRID_PADDING,
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  dnaLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  dnaScroll: { gap: 8, paddingRight: GRID_PADDING },
  dnaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  dnaEmoji: { fontSize: 18 },
  dnaChipText: { fontSize: 14, fontWeight: '700' },
  dnaArea: { fontSize: 12, color: colors.textMuted, marginTop: 10, fontWeight: '500' },
  // Encouragement card (< 3 logs)
  dnaEncouragement: {
    marginHorizontal: GRID_PADDING,
    marginTop: 16,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  dnaEncTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
  },
  dnaEncSub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 18,
  },
  dnaDotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dnaDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
  },
  dnaDotFilled: {
    backgroundColor: colors.accent,
  },

  // ── Tabs ──
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: GRID_PADDING,
    marginTop: 20,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
    marginBottom: -1.5,
  },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.textFaint },
  tabTextActive: { fontWeight: '800', color: colors.accent },

  // ── My Eats grid ──
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GRID_PADDING,
    paddingTop: 12,
  },
  listView: {
    paddingHorizontal: GRID_PADDING,
  },
  viewToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    marginRight: GRID_PADDING,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  viewToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.accentSoft,
  },

  // ── Saved ──
  savedList: { paddingHorizontal: GRID_PADDING, paddingTop: 12 },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: GRID_PADDING,
    paddingTop: 14,
    flexWrap: 'wrap',
  },
  locationPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: GRID_PADDING,
    marginTop: 16,
    marginBottom: 2,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  locationPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  locationPillIcon: { fontSize: 13 },
  locationPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  locationPillTextActive: {
    color: '#fff',
  },
  locationClear: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  cityCountLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    paddingHorizontal: GRID_PADDING,
    marginTop: 6,
  },
  citySheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  citySheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
  },
  citySheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 12,
  },
  citySheetSearch: {
    backgroundColor: colors.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    marginBottom: 12,
  },
  citySheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSoft,
  },
  citySheetRowText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  citySheetRowTextActive: {
    color: colors.accent,
  },
  citySuggestionsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceSoft,
    overflow: 'hidden',
  },
  citySuggestionRow: {
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  citySuggestionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSoft,
  },
  citySuggestionText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  citySheetDoneBtn: {
    marginTop: 20,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  citySheetDoneBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  travelBanner: {
    marginHorizontal: GRID_PADDING,
    marginTop: 12,
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.2)',
  },
  travelBannerText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  travelBannerCta: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
    flexShrink: 0,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  filterPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterPillText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  filterPillTextActive: { color: '#fff' },

  // ── Empty states ──
  empty: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
    paddingBottom: 24,
  },
  emptyEmoji: { fontSize: 44, marginBottom: 12 },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  emptyBtn: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  emptyBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
