/**
 * Friend profile — view another user's profile + their logs.
 *
 * Sections (top → bottom):
 *   - Avatar + display name + @username + follower/following counts + Follow CTA
 *   - City filter chips (built from logs.city)
 *   - Search input (matches restaurant name, cuisine, dish, vibe tag, note)
 *   - List of FeedCards for their visible logs, post-filter
 *
 * Server-side: /api/users/:id/logs enforces the user's visibility setting
 * (public / friends / private). When it returns 0 logs, the empty state
 * shows instead of the filter UI.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { blockUser, followUser, getUser, getUserLogs, type UserSummary } from '~/src/api/users';
import { FeedCard, type FeedLog } from '~/src/components/FeedCard';

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

  const [user, setUser] = useState<UserSummary | null>(null);
  const [logs, setLogs] = useState<FeedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followInFlight, setFollowInFlight] = useState(false);

  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Unique cities from this user's logs — used to populate the city chip row.
  const cities = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      const c = (l.city ?? '').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [logs]);

  // Apply both filters. Search matches against restaurant name, cuisine,
  // standout dish / dishes, vibe tags, and the note text.
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((l) => {
      if (cityFilter && (l.city ?? '').toLowerCase() !== cityFilter.toLowerCase()) return false;
      if (!q) return true;
      const haystack = [
        l.restaurantName,
        l.cuisine,
        l.neighborhood,
        l.note,
        l.standoutDish?.name,
        ...(l.standoutDishes ?? []),
        ...(l.dishes ?? []),
        ...(l.vibeTags ?? []),
      ]
        .filter((s): s is string => typeof s === 'string')
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, cityFilter, searchQuery]);

  const handleFollow = async () => {
    if (!userId || followInFlight) return;
    setFollowInFlight(true);
    try {
      const res = await followUser(userId);
      setFollowing(!!res.following);
    } catch {
      // ignore
    } finally {
      setFollowInFlight(false);
    }
  };

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
            disabled={followInFlight}
          >
            <Text style={[s.followBtnText, following && s.followBtnTextFollowing]}>
              {following ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        </View>

        {user.bio ? <Text style={s.bio}>{user.bio}</Text> : null}

        <View style={s.statsCard}>
          <View style={s.stat}>
            <Text style={s.statValue}>{user.followerCount ?? 0}</Text>
            <Text style={s.statLabel}>Followers</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statValue}>{user.followingCount ?? 0}</Text>
            <Text style={s.statLabel}>Following</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statValue}>{logs.length}</Text>
            <Text style={s.statLabel}>Logs</Text>
          </View>
        </View>
      </View>

      {hasAnyLogs ? (
        <View style={s.filtersSection}>
          {/* Search input — matches name, cuisine, dish, tag, note */}
          <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={16} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search cuisine, dish, vibe…"
              placeholderTextColor={colors.textFaint}
              style={s.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textFaint} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* City filter chips */}
          {cities.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chipRow}
            >
              <TouchableOpacity
                style={[s.chip, !cityFilter && s.chipActive]}
                onPress={() => setCityFilter(null)}
                activeOpacity={0.7}
              >
                <Text style={[s.chipText, !cityFilter && s.chipTextActive]}>All cities</Text>
              </TouchableOpacity>
              {cities.map((c) => {
                const active = cityFilter === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => setCityFilter(active ? null : c)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>📍 {c}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}
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
          // Pass a React element (the result of renderHeader()) instead of
          // the function itself. Passing the function makes FlatList treat
          // it as a component type — and because renderHeader is recreated
          // on every parent render, FlatList sees a new "component type"
          // on every keystroke and remounts the entire header. That
          // remount blurs the TextInput inside the header, causing the
          // "glitchy" search experience the user reported (keyboard
          // dismissing, cursor jumping, etc.).
          ListHeaderComponent={renderHeader()}
          ListEmptyComponent={
            <View style={s.emptyFilter}>
              <Text style={s.emptyTitle}>No matches</Text>
              <Text style={s.emptyBody}>Try a different filter or clear the search.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <FeedCard log={item} socialLabel={null} isHero={false} />
          )}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  statValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border, marginHorizontal: 8 },
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

  filtersSection: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.text },
  chipRow: { gap: 8, paddingVertical: 2, paddingRight: 16 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  chipTextActive: { color: '#fff' },

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
  listContent: { paddingBottom: 32 },
});
