import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getMe, getFollowing, type UserSummary } from '~/src/api/users';
import { colors } from '~/src/theme/colors';

export default function FollowingScreen() {
  const router = useRouter();
  const [list, setList] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then((me) => getFollowing(me.id))
      .then(setList)
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Following</Text>
        <Text style={styles.subtitle}>People you follow</Text>
      </View>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Not following anyone yet</Text>
          <Text style={styles.emptySubtext}>Find friends to see their taste and logs</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.userRow}
              activeOpacity={0.8}
              onPress={() => router.push(`/friend/${item.id}`)}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{(item.displayName || item.username)[0] ?? '·'}</Text>
              </View>
              <View style={styles.userMeta}>
                <Text style={styles.userName}>{item.displayName}</Text>
                <Text style={styles.userHandle}>@{item.username}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backText: { marginLeft: 4, fontSize: 16, color: colors.text },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, fontWeight: '600', color: colors.text },
  emptySubtext: { marginTop: 4, fontSize: 14, color: colors.textMuted },
  listContent: { paddingHorizontal: 20, paddingBottom: 24 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarInitial: { fontSize: 18, fontWeight: '700', color: colors.text },
  userMeta: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '600', color: colors.text },
  userHandle: { fontSize: 13, color: colors.textMuted },
});
