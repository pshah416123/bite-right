/**
 * Edit username — single-field edit screen wired to PATCH /api/users/me.
 * Validates 3-20 chars: letters/numbers/underscores. Server enforces
 * case-insensitive uniqueness and surfaces a friendly 409 error.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '~/src/theme/colors';
import { getMe, updateMe } from '~/src/api/users';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function EditUsernameScreen() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => { if (!cancelled) setValue(me.username ?? ''); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async () => {
    const trimmed = value.trim().toLowerCase();
    if (!USERNAME_RE.test(trimmed)) {
      Alert.alert('Invalid username', '3–20 characters, letters / numbers / underscores only.');
      return;
    }
    setSubmitting(true);
    try {
      await updateMe({ username: trimmed });
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Could not update username.';
      Alert.alert('Update failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const valid = USERNAME_RE.test(value.trim().toLowerCase());

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.title}>Edit username</Text>
        </View>

        <View style={s.body}>
          <Text style={s.label}>Username</Text>
          <View style={s.inputRow}>
            <Text style={s.atSign}>@</Text>
            <TextInput
              value={value}
              onChangeText={(t) => setValue(t.toLowerCase())}
              placeholder="username"
              placeholderTextColor={colors.textFaint}
              style={s.input}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={loaded}
              maxLength={20}
            />
          </View>
          <Text style={s.hint}>3–20 characters. Letters, numbers, and underscores.</Text>

          <TouchableOpacity
            style={[s.submit, !valid && s.submitDisabled]}
            onPress={handleSubmit}
            disabled={!valid || submitting}
            activeOpacity={0.85}
          >
            <Text style={s.submitText}>{submitting ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { paddingHorizontal: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  atSign: { fontSize: 16, color: colors.textMuted, marginRight: 4, fontWeight: '600' },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  hint: { marginTop: 8, fontSize: 12, color: colors.textMuted },
  submit: {
    marginTop: 28,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: colors.surfaceSoft },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
