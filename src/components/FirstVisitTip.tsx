/**
 * FirstVisitTip — small dismissible coach mark for first-time users.
 *
 * Renders an inline callout (icon + heading + body + X) and remembers
 * the dismissal in AsyncStorage so it never reappears for a given user.
 * The existing tutorial carousel covers the same ground, but in-context
 * tips after the user lands on each screen turn out to stick better.
 *
 * Usage:
 *   <FirstVisitTip
 *     storageKey="byterite_tip_feed_fab"
 *     icon="add-circle"
 *     title="Log what you tried"
 *     body="Tap the + button anytime you eat somewhere worth remembering. Your taste profile builds from these."
 *   />
 *
 * Storage keys are namespaced under `byterite_tip_` so they're easy to
 * grep / clear during testing.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

type Props = {
  storageKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** Optional inline style override for placement on a specific screen. */
  style?: object;
};

export function FirstVisitTip({ storageKey, icon, title, body, style }: Props) {
  // null = haven't checked yet (don't flash). false = should show. true = dismissed.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((v) => setDismissed(v === '1'))
      .catch(() => setDismissed(false));
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    AsyncStorage.setItem(storageKey, '1').catch(() => { /* noop */ });
  }, [storageKey]);

  if (dismissed === null || dismissed === true) return null;

  return (
    <View style={[s.wrap, style]}>
      <View style={s.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={s.body}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.text}>{body}</Text>
      </View>
      <TouchableOpacity onPress={dismiss} hitSlop={10} style={s.closeBtn}>
        <Ionicons name="close" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(232, 89, 42, 0.25)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.1,
  },
  text: {
    fontSize: 12.5,
    color: colors.textMuted,
    lineHeight: 17,
  },
  closeBtn: {
    paddingTop: 1,
  },
});
