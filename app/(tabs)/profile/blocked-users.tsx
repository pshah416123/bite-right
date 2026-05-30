/**
 * Blocked users — list and unblock. Blocking new users happens from
 * the friend profile screen (separate change).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '~/src/theme/colors';
import { getBlockedUsers, unblockUser, type UserSummary } from '~/src/api/users';

export default function BlockedUsersScreen() {
  const router = useRouter();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getBlockedUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const handleUnblock = (user: UserSummary) => {
    Alert.alert(
      `Unblock @${user.username}?`,
      'They’ll be able to see your logs and you’ll see theirs again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblockUser(user.id);
              setUsers((prev) => prev.filter((u) => u.id !== user.id));
            } catch (e: any) {
              Alert.alert('Could not unblock', e?.response?.data?.error || e?.message || 'Try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Blocked users</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : users.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="people-outline" size={42} color={colors.textFaint} />
          <Text style={s.emptyTitle}>No one blocked</Text>
          <Text style={s.emptyBody}>Blocking someone hides their logs from you and yours from them.</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={s.avatar}>
                <Text style={s.avatarInitial}>{(item.displayName || item.username)[0]?.toUpperCase() ?? '·'}</Text>
              </View>
              <View style={s.meta}>
                <Text style={s.name}>{item.displayName}</Text>
                <Text style={s.handle}>@{item.username}</Text>
              </View>
              <TouchableOpacity style={s.unblockBtn} onPress={() => handleUnblock(item)} activeOpacity={0.8}>
                <Text style={s.unblockText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 4 },
  emptyBody: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: colors.text },
  meta: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  handle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  unblockBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  unblockText: { fontSize: 13, fontWeight: '700', color: colors.text },
});
