/**
 * Friend profile — view another user's profile + their logs.
 *
 * Sections (top → bottom):
 *   - Avatar + display name + @username + follower/following counts + Follow CTA
 *   - City filter pill (opens a search sheet, same UX as the own-profile city
 *     picker — geo autocomplete + the cities the friend actually has logs in)
 *   - List of FeedCards for their visible logs, post-filter
 *
 * Server-side: /api/users/:id/logs enforces the user's visibility setting
 * (public / friends / private). When it returns 0 logs, the empty state
 * shows instead of the filter UI.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '~/src/theme/colors';
import { apiClient } from '~/src/api/client';
import {
  blockUser,
  followUser,
  getFollowing,
  getUser,
  getUserLogs,
  unfollowUser,
  type UserSummary,
} from '~/src/api/users';
import { type FeedLog } from '~/src/components/FeedCard';
import { RestaurantImage } from '~/src/components/RestaurantImage';
import { useAuthContext } from '~/src/context/AuthContext';

// Mirrors getCuisineEmoji on the own-profile screen so a friend's Taste DNA
// chips look identical to your own. Kept in sync deliberately.
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

/** Format an ISO timestamp as "Mon YYYY" (e.g. "Mar 2026"). Returns empty
 *  string on parse failure so the row collapses cleanly. */
function formatJoinedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export default function FriendProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const userId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : undefined;
  const auth = useAuthContext();
  const myUserId = auth.user?.id ?? null;

  const [user, setUser] = useState<UserSummary | null>(null);
  const [logs, setLogs] = useState<FeedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  // null = unknown (initial fetch still in flight); true/false once known.
  // Used to keep the Follow button disabled until we know the real state so
  // we never render a stale "Follow" CTA on someone the user already follows.
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followInFlight, setFollowInFlight] = useState(false);

  const [cityFilter, setCityFilter] = useState<string | null>(null);
  // City picker — mirrors the own-profile city sheet so searching a city
  // (with geo autocomplete) works the same way on someone else's profile.
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [citySearch, setCitySearch] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<{ label: string }[]>([]);
  const [cityGeoLoading, setCityGeoLoading] = useState(false);
  const cityReqIdRef = useRef(0);
  const cityCacheRef = useRef<Record<string, { label: string }[]>>({});

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

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getUser(userId)
      .then((u) => { if (!cancelled) setUser(u); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLogsLoading(true);
    getUserLogs(userId)
      .then((rows) => { if (!cancelled) setLogs(rows); })
      .catch(() => { if (!cancelled) setLogs([]); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  // Resolve whether the logged-in user already follows this person. The
  // getUser response doesn't carry an isFollowing flag (it's the same
  // endpoint used in many list contexts), so we derive it by listing the
  // viewer's followings and checking membership. Without this the CTA
  // always read "Follow" even on people you had already followed.
  useEffect(() => {
    if (!userId || !myUserId) {
      setFollowing(null);
      return;
    }
    if (myUserId === userId) {
      setFollowing(false);
      return;
    }
    let cancelled = false;
    getFollowing(myUserId)
      .then((rows) => {
        if (cancelled) return;
        setFollowing(rows.some((r) => r.id === userId));
      })
      .catch(() => { if (!cancelled) setFollowing(false); });
    return () => { cancelled = true; };
  }, [userId, myUserId]);

  // Unique cities from this user's logs — used to populate the city chip row.
  const cities = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      const c = (l.city ?? '').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(
    () => (cityFilter
      ? logs.filter((l) => (l.city ?? '').toLowerCase() === cityFilter.toLowerCase())
      : logs),
    [logs, cityFilter],
  );

  const handleFollow = async () => {
    if (!userId || followInFlight || following === null) return;
    setFollowInFlight(true);
    try {
      const res = following
        ? await unfollowUser(userId)
        : await followUser(userId);
      setFollowing(!!res.following);
    } catch {
      // ignore
    } finally {
      setFollowInFlight(false);
    }
  };

  // Derived stats — mirrors what the user's own profile screen computes
  // so we render the same surface (Avg Score + Taste DNA) on someone
  // else's profile.
  const avgScore = useMemo(() => {
    if (logs.length === 0) return null;
    const total = logs.reduce((sum, l) => sum + (l.score ?? 0), 0);
    return total / logs.length;
  }, [logs]);
  const topCuisines = useMemo(
    () => getTopCuisines(logs.map((l) => ({ cuisine: l.cuisine ?? '', score: l.score ?? 0 }))),
    [logs],
  );

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={s.safe}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.headerBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={s.center}>
          <Text style={s.emptyTitle}>User not found</Text>
          <Text style={s.emptyBody}>They may have deleted their account.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const initial = (user.displayName || user.username || '?').charAt(0).toUpperCase();
  const hasAnyLogs = logs.length > 0;

  const renderHeader = () => (
    <View>
      <View style={s.headerBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              `Block @${user.username}?`,
              'They won’t see your logs and you won’t see theirs.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await blockUser(user.id);
                      router.back();
                    } catch (e: any) {
                      Alert.alert('Could not block', e?.response?.data?.error || e?.message || 'Try again.');
                    }
                  },
                },
              ],
            );
          }}
          hitSlop={8}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={s.profileHeader}>
        <View style={s.headerTop}>
          <LinearGradient
            colors={['#C4899A', '#8B3A4A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.avatar}
          >
            <Text style={s.avatarInitial}>{initial}</Text>
          </LinearGradient>
          <View style={s.headerInfo}>
            <Text style={s.displayName} numberOfLines={1}>{user.displayName}</Text>
            <Text style={s.handle} numberOfLines={1}>@{user.username}</Text>
            {user.createdAt ? (
              <Text style={s.joined}>Joined {formatJoinedDate(user.createdAt)}</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[s.followBtn, following && s.followBtnFollowing]}
            onPress={handleFollow}
            activeOpacity={0.85}
            // Disable while the membership check is in flight (following=null)
            // so we don't render a tappable "Follow" CTA on someone the user
            // already follows.
            disabled={followInFlight || following === null}
          >
            <Text style={[s.followBtnText, following && s.followBtnTextFollowing]}>
              {following === null ? '…' : following ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        </View>

        {user.bio ? <Text style={s.bio}>{user.bio}</Text> : null}

        <View style={s.statsCard}>
          <View style={s.stat}>
            <View style={s.statValueRow}>
              <Ionicons name="star" size={14} color={colors.accent} style={s.statIcon} />
              <Text style={[s.statValue, s.statValueAccent]}>
                {avgScore != null ? avgScore.toFixed(1) : '—'}
              </Text>
            </View>
            <Text style={s.statLabel}>Avg Score</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statValue}>{logs.length}</Text>
            <Text style={s.statLabel}>Logs</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statValue}>{user.followerCount ?? 0}</Text>
            <Text style={s.statLabel}>Followers</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statValue}>{user.followingCount ?? 0}</Text>
            <Text style={s.statLabel}>Following</Text>
          </View>
        </View>
      </View>

      {/* Taste DNA — mirrors the own-profile layout so a friend's flavor
          profile reads the same way as your own. Hidden until they have
          at least 3 logs so the chip row isn't built on a single visit. */}
      {topCuisines.length > 0 && logs.length >= 3 ? (
        <View style={s.dnaSection}>
          <Text style={s.dnaLabel}>✨ Taste DNA</Text>
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
        </View>
      ) : null}

      {hasAnyLogs && cities.length > 0 ? (
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
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      {logsLoading ? (
        <>
          {renderHeader()}
          <View style={s.center}><ActivityIndicator size="large" color={colors.accent} /></View>
        </>
      ) : !hasAnyLogs ? (
        <>
          {renderHeader()}
          <View style={s.emptyLogs}>
            <Ionicons name="restaurant-outline" size={40} color={colors.textFaint} />
            <Text style={s.emptyTitle}>No public logs yet</Text>
            <Text style={s.emptyBody}>
              When {user.displayName.split(' ')[0]} logs a visit, it’ll show up here.
            </Text>
          </View>
        </>
      ) : (
        <FlatList
          data={filteredLogs}
          keyExtractor={(l) => l.id}
          ListHeaderComponent={renderHeader()}
          ListEmptyComponent={
            <View style={s.emptyFilter}>
              <Text style={s.emptyTitle}>No matches</Text>
              <Text style={s.emptyBody}>Try a different city filter.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = [item.cuisine, item.neighborhood].filter(Boolean).join(' · ');
            const note = item.note?.trim() || null;
            const highScore = (item.score ?? 0) >= 8.0;
            return (
              <TouchableOpacity
                style={s.logRow}
                onPress={() => router.push(`/restaurant/${encodeURIComponent(item.restaurantId)}?logId=${encodeURIComponent(item.id)}`)}
                activeOpacity={0.8}
              >
                <View style={s.logThumbWrap}>
                  <RestaurantImage
                    restaurant={{
                      id: item.restaurantId,
                      name: item.restaurantName,
                      displayImageUrl: item.photo_url ?? null,
                      previewPhotoUrl: item.previewPhotoUrl ?? null,
                    }}
                    aspectRatio={1}
                    fallbackType="icon"
                    borderRadius={12}
                    style={s.logThumb}
                  />
                </View>
                <View style={s.logInfo}>
                  <Text style={s.logName} numberOfLines={1}>{item.restaurantName}</Text>
                  {meta ? <Text style={s.logMeta} numberOfLines={1}>{meta}</Text> : null}
                  {note ? <Text style={s.logNote} numberOfLines={1}>{note}</Text> : null}
                </View>
                <View style={[s.logScorePill, highScore && s.logScorePillHigh]}>
                  <Text style={[s.logScoreText, highScore && s.logScoreTextHigh]}>
                    {(item.score ?? 0).toFixed(1)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

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

            {citySearch.trim().length > 0 && citySuggestions.length > 0 ? (
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
            ) : null}

            {citySearch.trim().length > 0 && cityGeoLoading ? (
              <View style={s.citySuggestionsCard}>
                <View style={s.citySuggestionRow}>
                  <Text style={[s.citySuggestionText, { color: colors.textFaint }]}>Searching…</Text>
                </View>
              </View>
            ) : null}

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

            {cities
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
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  // Header — matches the compact own-profile layout: avatar on left,
  // name/handle stacked beside it, Follow CTA on the right, stats card
  // below. Friend profiles used to use a tall centered layout with a
  // 96×96 avatar that felt outsized vs the user's own profile screen.
  profileHeader: {
    paddingTop: 4,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerInfo: {
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 22, fontWeight: '700', color: '#fff' },
  displayName: { fontSize: 18, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  handle: { fontSize: 13, color: colors.textMuted, marginTop: 1, fontWeight: '500' },
  bio: {
    marginTop: 12,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.text,
  },
  joined: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 14,
    shadowColor: 'rgba(180,120,80,0.10)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  statValueAccent: { color: colors.accent },
  statIcon: { marginTop: -1 },
  statLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border, marginHorizontal: 8 },

  dnaSection: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
  },
  dnaLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    letterSpacing: -0.1,
  },
  dnaScroll: { gap: 8, paddingRight: 16 },
  dnaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  dnaEmoji: { fontSize: 14 },
  dnaChipText: { fontSize: 13, fontWeight: '700', letterSpacing: -0.1 },
  followBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  followBtnFollowing: { backgroundColor: colors.surfaceSoft },
  followBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  followBtnTextFollowing: { color: colors.text },

  locationPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
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
  locationPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  locationPillIcon: { fontSize: 13 },
  locationPillText: { fontSize: 13, fontWeight: '700', color: colors.text },
  locationPillTextActive: { color: '#fff' },
  locationClear: { fontSize: 13, fontWeight: '600', color: colors.accent },

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
  citySheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 12 },
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
  citySheetRowText: { fontSize: 15, fontWeight: '600', color: colors.text },
  citySheetRowTextActive: { color: colors.accent },
  citySuggestionsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.surfaceSoft,
    overflow: 'hidden',
  },
  citySuggestionRow: { paddingVertical: 14, paddingHorizontal: 14 },
  citySuggestionRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.surfaceSoft },
  citySuggestionText: { fontSize: 15, fontWeight: '700', color: colors.text },
  citySheetDoneBtn: {
    marginTop: 20,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  citySheetDoneBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },

  emptyLogs: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyFilter: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 32,
    gap: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 6 },
  emptyBody: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  listContent: { paddingBottom: 32, paddingHorizontal: 16 },

  // Compact log row — mirrors the EatsListRow on the own-profile screen
  // so a friend's logs render in the same visual style as the user's own.
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  logThumbWrap: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden' },
  logThumb: { width: 48, height: 48 },
  logInfo: { flex: 1, minWidth: 0 },
  logName: { fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  logMeta: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  logNote: { fontSize: 12, fontWeight: '500', color: colors.textFaint, fontStyle: 'italic', marginTop: 2 },
  logScorePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  logScorePillHigh: {
    backgroundColor: colors.accent,
  },
  logScoreText: { fontSize: 13, fontWeight: '800', color: colors.text },
  logScoreTextHigh: { color: '#fff' },
});
