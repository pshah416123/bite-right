import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '~/src/theme/colors';
import {
  getMe,
  getSuggestedUsers,
  searchUsers,
  followUser,
  matchContacts,
  type UserSummary,
} from '~/src/api/users';
import {
  getContactsPermission,
  requestContactsPermission,
  getContactPhones,
  type ContactsPermissionState,
} from '~/src/utils/contacts';

export default function FindFriendsScreen() {
  const router = useRouter();
  const [me, setMe] = useState<UserSummary | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSummary[]>([]);
  const [suggested, setSuggested] = useState<UserSummary[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingSuggested, setLoadingSuggested] = useState(false);

  // Contacts state: lazy-loaded once permission is granted. Stored locally so
  // the user doesn't have to wait for a match-contacts round trip every time
  // they open this screen — only re-fetched when they tap "Refresh".
  const [contactsPermission, setContactsPermission] = useState<ContactsPermissionState>('undetermined');
  const [contactMatches, setContactMatches] = useState<UserSummary[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  useEffect(() => {
    getMe().then(setMe).catch(() => {});
    setLoadingSuggested(true);
    getSuggestedUsers()
      .then(setSuggested)
      .catch(() => setSuggested([]))
      .finally(() => setLoadingSuggested(false));
    // Check existing permission without prompting — if the user already
    // granted contacts on a prior visit, we auto-load matches.
    getContactsPermission().then(async (p) => {
      setContactsPermission(p);
      if (p === 'granted') {
        await loadContactMatches();
      }
    }).catch(() => {});
  }, []);

  const loadContactMatches = async () => {
    setLoadingContacts(true);
    try {
      const phones = await getContactPhones();
      if (phones.length === 0) {
        setContactMatches([]);
        return;
      }
      const matches = await matchContacts(phones);
      setContactMatches(matches);
    } catch {
      setContactMatches([]);
    } finally {
      setLoadingContacts(false);
    }
  };

  const handleEnableContacts = async () => {
    const current = await getContactsPermission();
    if (current === 'granted') {
      await loadContactMatches();
      return;
    }
    if (current === 'denied') {
      Alert.alert(
        'Contacts access disabled',
        'Open Settings → BiteRight → Contacts to turn it on.',
      );
      return;
    }
    const next = await requestContactsPermission();
    setContactsPermission(next);
    if (next === 'granted') {
      await loadContactMatches();
    }
  };

  const runSearch = (text: string) => {
    setQuery(text);
    const trimmed = text.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    setLoadingSearch(true);
    searchUsers(trimmed)
      .then(setSearchResults)
      .catch(() => setSearchResults([]))
      .finally(() => setLoadingSearch(false));
  };

  const toggleFollow = async (user: UserSummary) => {
    try {
      await followUser(user.id);
      if (query.trim()) {
        runSearch(query);
      }
      getSuggestedUsers().then(setSuggested).catch(() => {});
    } catch {
      // ignore
    }
  };

  const renderUser = ({ item }: { item: UserSummary }) => {
    return (
      <TouchableOpacity
        style={styles.userRow}
        activeOpacity={0.8}
        onPress={() => router.push(`/friend/${item.id}` as any)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{(item.displayName || item.username)[0] ?? '·'}</Text>
        </View>
        <View style={styles.userMeta}>
          <Text style={styles.userName}>{item.displayName}</Text>
          <Text style={styles.userHandle}>@{item.username}</Text>
        </View>
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation();
            toggleFollow(item);
          }}
          style={styles.followBtn}
          activeOpacity={0.8}
        >
          <Text style={styles.followBtnText}>Follow</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Find friends</Text>
        <Text style={styles.subtitle}>Follow friends to see their ByteRite activity</Text>
      </View>
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by username"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={runSearch}
        />
      </View>
      {loadingSearch ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.loadingText}>Searching…</Text>
        </View>
      ) : null}
      {searchResults.length > 0 ? (
        <FlatList
          data={searchResults}
          keyExtractor={(u) => u.id}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* From your contacts */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>From your contacts</Text>
            {contactsPermission === 'granted' && !loadingContacts ? (
              <TouchableOpacity onPress={loadContactMatches} hitSlop={8}>
                <Text style={styles.sectionAction}>Refresh</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {contactsPermission !== 'granted' ? (
            <TouchableOpacity
              style={styles.contactsCta}
              activeOpacity={0.85}
              onPress={handleEnableContacts}
            >
              <View style={styles.contactsCtaIcon}>
                <Ionicons name="people-outline" size={20} color={colors.accent} />
              </View>
              <View style={styles.contactsCtaBody}>
                <Text style={styles.contactsCtaTitle}>Find friends from your contacts</Text>
                <Text style={styles.contactsCtaSub}>
                  We only match phone numbers — your contacts stay on your phone.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </TouchableOpacity>
          ) : loadingContacts ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Scanning your contacts…</Text>
            </View>
          ) : contactMatches.length === 0 ? (
            <Text style={styles.emptyHint}>
              None of your contacts are on BiteRight yet. Invite them so you can follow when they join.
            </Text>
          ) : (
            contactMatches.map((u) => (
              <View key={`contact-${u.id}`}>{renderUser({ item: u })}</View>
            ))
          )}

          {/* Suggested */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Suggested</Text>
          {loadingSuggested ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          ) : (
            suggested.map((u) => (
              <View key={`suggested-${u.id}`}>{renderUser({ item: u })}</View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  backText: {
    marginLeft: 2,
    fontSize: 14,
    color: colors.text,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  sectionTitle: {
    marginTop: 16,
    marginHorizontal: 20,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingRight: 20,
    marginTop: 8,
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  contactsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactsCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactsCtaBody: { flex: 1, gap: 2 },
  contactsCtaTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  contactsCtaSub: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  emptyHint: {
    marginHorizontal: 20,
    marginTop: 10,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  userMeta: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  userHandle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  followBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
});

