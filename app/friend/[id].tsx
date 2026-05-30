/**
 * Friend profile — view another user's public profile.
 *
 * v1 shows: avatar (initials), name, @username, follower/following counts,
 * and a Follow CTA. Future enhancement: their recent logs feed.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '~/src/theme/colors';
import { blockUser, followUser, getUser, type UserSummary } from '~/src/api/users';

export default function FriendProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const userId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : undefined;

  const [user, setUser] = useState<UserSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followInFlight, setFollowInFlight] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getUser(userId)
      .then((u) => { if (!cancelled) setUser(u); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
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
        <LinearGradient
          colors={['#C4899A', '#8B3A4A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.avatar}
        >
          <Text style={s.avatarInitial}>{initial}</Text>
        </LinearGradient>
        <Text style={s.displayName}>{user.displayName}</Text>
        <Text style={s.handle}>@{user.username}</Text>

        <View style={s.stats}>
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

      <View style={s.emptyLogs}>
        <Ionicons name="restaurant-outline" size={40} color={colors.textFaint} />
        <Text style={s.emptyTitle}>No public logs yet</Text>
        <Text style={s.emptyBody}>
          When {user.displayName.split(' ')[0]} logs a visit, it’ll show up here.
        </Text>
      </View>
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
  profileHeader: {
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: '800',
    color: '#fff',
  },
  displayName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  handle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginTop: 16,
    marginBottom: 18,
  },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },
  followBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    minWidth: 140,
    alignItems: 'center',
  },
  followBtnFollowing: {
    backgroundColor: colors.surfaceSoft,
  },
  followBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  followBtnTextFollowing: { color: colors.text },
  emptyLogs: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 6,
  },
  emptyBody: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
