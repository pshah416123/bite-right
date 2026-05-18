/**
 * SendToFriendSheet — Lightweight friend picker for sending a restaurant recommendation.
 * No comment threads, no public posting. Just "send to Jordan".
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Image,
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
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import { SOCIAL_PROFILES } from '../data/socialProfiles';

interface Props {
  visible: boolean;
  onClose: () => void;
  restaurantName: string;
  restaurantId: string;
  cuisine?: string;
  neighborhood?: string;
}

interface Friend {
  userName: string;
  displayName: string;
  avatarUrl?: string;
}

// Pull friends from social profiles
const ALL_FRIENDS: Friend[] = Object.values(SOCIAL_PROFILES).map((p) => ({
  userName: p.userName,
  displayName: p.displayName,
  avatarUrl: undefined, // Could be wired to avatars later
}));

export function SendToFriendSheet({
  visible,
  onClose,
  restaurantName,
  cuisine,
  neighborhood,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const toggle = useCallback((userName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userName)) next.delete(userName);
      else next.add(userName);
      return next;
    });
  }, []);

  const handleSend = useCallback(() => {
    if (selected.size === 0) return;
    // In a real app, this would POST to /api/send-recommendation
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSent(true);
    setTimeout(() => {
      setSent(false);
      setSelected(new Set());
      setNote('');
      onClose();
    }, 1200);
  }, [selected, onClose]);

  const handleClose = useCallback(() => {
    setSelected(new Set());
    setNote('');
    setSent(false);
    onClose();
  }, [onClose]);

  const meta = useMemo(() => {
    return [cuisine, neighborhood].filter(Boolean).join(' \u00B7 ');
  }, [cuisine, neighborhood]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={s.backdrop} onPress={handleClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />

          {sent ? (
            <View style={s.sentWrap}>
              <Text style={s.sentEmoji}>{'\u2705'}</Text>
              <Text style={s.sentTitle}>Sent!</Text>
              <Text style={s.sentSub}>
                {selected.size === 1
                  ? `${Array.from(selected)[0]} will see your rec`
                  : `${selected.size} friends will see your rec`}
              </Text>
            </View>
          ) : (
            <>
              {/* Header */}
              <View style={s.header}>
                <Text style={s.title}>Send to a friend</Text>
                <Text style={s.subtitle}>{restaurantName}</Text>
                {meta ? <Text style={s.meta}>{meta}</Text> : null}
              </View>

              {/* Optional note */}
              <View style={s.noteWrap}>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Add a note (optional)"
                  style={s.noteInput}
                  maxLength={100}
                />
              </View>

              {/* Friend list */}
              <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
                {ALL_FRIENDS.map((f) => {
                  const isSelected = selected.has(f.userName);
                  return (
                    <TouchableOpacity
                      key={f.userName}
                      style={[s.friendRow, isSelected && s.friendRowSelected]}
                      onPress={() => toggle(f.userName)}
                      activeOpacity={0.7}
                    >
                      <View style={s.friendAvatar}>
                        <Text style={s.friendInitial}>{f.displayName[0]}</Text>
                      </View>
                      <Text style={s.friendName}>{f.displayName}</Text>
                      <View style={[s.checkCircle, isSelected && s.checkCircleActive]}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Send button */}
              <TouchableOpacity
                style={[s.sendBtn, selected.size === 0 && s.sendBtnDisabled]}
                onPress={handleSend}
                activeOpacity={0.8}
                disabled={selected.size === 0}
              >
                <Ionicons name="send" size={16} color="#fff" />
                <Text style={s.sendBtnText}>
                  {selected.size === 0
                    ? 'Select friends'
                    : selected.size === 1
                      ? `Send to ${Array.from(selected)[0]}`
                      : `Send to ${selected.size} friends`}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 34,
    paddingHorizontal: 20,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D0CDD4',
    marginBottom: 16,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    marginTop: 1,
    fontSize: 12,
    color: colors.textMuted,
  },

  // Note
  noteWrap: {
    marginBottom: 14,
  },
  noteInput: {
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  // Friend list
  list: {
    maxHeight: 260,
  },
  listContent: {
    gap: 6,
    paddingBottom: 8,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  friendRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  friendAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendInitial: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  friendName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },

  // Send
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  // Sent confirmation
  sentWrap: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  sentEmoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  sentTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  sentSub: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
});
