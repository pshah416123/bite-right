/**
 * FriendTagPicker — multi-select friend picker for tagging on a restaurant log.
 *
 * Lightweight UX: a single row of compact name pills + a "+ Add" button that
 * opens a sheet with search. Friends are loaded from SOCIAL_PROFILES (mock).
 * When real friendships ship server-side, swap the source to an API hook —
 * the component contract (`selectedUserNames`, `onChange`) doesn't change.
 */

import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { SOCIAL_PROFILES } from '../../data/socialProfiles';

const MAX_TAGS = 8;

interface Props {
  selectedUserNames: string[];
  onChange: (next: string[]) => void;
}

export function FriendTagPicker({ selectedUserNames, onChange }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState('');

  const allFriends = useMemo(
    () => Object.values(SOCIAL_PROFILES).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allFriends;
    return allFriends.filter((f) =>
      f.userName.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q),
    );
  }, [allFriends, query]);

  const toggle = (userName: string) => {
    if (selectedUserNames.includes(userName)) {
      onChange(selectedUserNames.filter((n) => n !== userName));
    } else if (selectedUserNames.length < MAX_TAGS) {
      onChange([...selectedUserNames, userName]);
    }
  };

  const remove = (userName: string) => {
    onChange(selectedUserNames.filter((n) => n !== userName));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Who did you go with?</Text>
      <View style={styles.row}>
        {selectedUserNames.map((userName) => {
          const profile = SOCIAL_PROFILES[userName];
          return (
            <TouchableOpacity
              key={userName}
              style={styles.chip}
              onPress={() => remove(userName)}
              activeOpacity={0.7}
              accessibilityLabel={`Remove ${profile?.displayName ?? userName}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {profile?.displayName ?? userName}
              </Text>
              <Ionicons name="close" size={13} color={colors.accentText} />
            </TouchableOpacity>
          );
        })}
        {selectedUserNames.length < MAX_TAGS ? (
          <TouchableOpacity
            style={styles.addChip}
            onPress={() => setSheetOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="Add friends to this visit"
          >
            <Ionicons name="add" size={14} color={colors.textMuted} />
            <Text style={styles.addChipText}>
              {selectedUserNames.length === 0 ? 'Add friends' : 'Add'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal visible={sheetOpen} animationType="slide" transparent onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Tag friends</Text>
              <TouchableOpacity onPress={() => setSheetOpen(false)} hitSlop={8}>
                <Text style={styles.sheetDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search friends"
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <Text style={styles.emptyText}>No friends match.</Text>
              ) : (
                filtered.map((f) => {
                  const selected = selectedUserNames.includes(f.userName);
                  return (
                    <TouchableOpacity
                      key={f.userName}
                      style={[styles.listRow, selected && styles.listRowSelected]}
                      onPress={() => toggle(f.userName)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarLetter}>{f.displayName[0]?.toUpperCase() ?? '?'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.listName}>{f.displayName}</Text>
                        <Text style={styles.listSub}>@{f.userName}</Text>
                      </View>
                      <Ionicons
                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={selected ? colors.accent : colors.textFaint}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            {selectedUserNames.length >= MAX_TAGS ? (
              <Text style={styles.capText}>You can tag up to {MAX_TAGS} friends per visit.</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent + '40',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentText,
    maxWidth: 120,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addChipText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  sheetDone: { fontSize: 15, fontWeight: '700', color: colors.accent },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, padding: 0 },
  list: { maxHeight: 360 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  listRowSelected: { backgroundColor: colors.surfaceSoft },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 14, fontWeight: '800', color: colors.text },
  listName: { fontSize: 14, fontWeight: '700', color: colors.text },
  listSub: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  emptyText: { textAlign: 'center', color: colors.textMuted, paddingVertical: 24 },
  capText: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
});
