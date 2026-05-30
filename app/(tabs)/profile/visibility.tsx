/**
 * Post visibility picker — controls who sees your logs in the home feed.
 * Server enforces the rule in GET /api/feed.
 */
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '~/src/theme/colors';
import { getMe, updateMe, type UserVisibility } from '~/src/api/users';

const OPTIONS: { value: UserVisibility; label: string; description: string }[] = [
  { value: 'public', label: 'Everyone', description: 'Anyone using ByteRite can see your logs.' },
  { value: 'friends', label: 'Friends only', description: 'Only people you’ve followed (and who follow you back) see your logs.' },
  { value: 'private', label: 'Only me', description: 'Your logs are hidden from other users entirely.' },
];

export default function VisibilityScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<UserVisibility>('public');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => { if (!cancelled) setSelected((me.visibility as UserVisibility) ?? 'public'); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handlePick = async (value: UserVisibility) => {
    if (value === selected) return;
    setSubmitting(true);
    const prev = selected;
    setSelected(value);
    try {
      await updateMe({ visibility: value });
    } catch (e: any) {
      setSelected(prev);
      Alert.alert('Update failed', e?.response?.data?.error || e?.message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Who can see my posts</Text>
      </View>

      <View style={s.body}>
        {OPTIONS.map((opt) => {
          const active = selected === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.option, active && s.optionActive]}
              onPress={() => handlePick(opt.value)}
              activeOpacity={0.7}
              disabled={submitting}
            >
              <View style={s.optionBody}>
                <Text style={s.optionLabel}>{opt.label}</Text>
                <Text style={s.optionDescription}>{opt.description}</Text>
              </View>
              {active ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
              ) : (
                <View style={s.radio} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { paddingHorizontal: 20, gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  optionActive: { borderColor: colors.accent },
  optionBody: { flex: 1, paddingRight: 12 },
  optionLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  optionDescription: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border },
});
