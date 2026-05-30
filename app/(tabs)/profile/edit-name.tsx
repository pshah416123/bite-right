/**
 * Edit display name — single-field edit screen wired to PATCH /api/users/me.
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

export default function EditNameScreen() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => { if (!cancelled) setValue(me.displayName ?? ''); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      Alert.alert('Invalid name', 'Display name can’t be blank.');
      return;
    }
    setSubmitting(true);
    try {
      await updateMe({ displayName: trimmed });
      router.back();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Could not update name.';
      Alert.alert('Update failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.title}>Edit name</Text>
        </View>

        <View style={s.body}>
          <Text style={s.label}>Display name</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="Your name"
            placeholderTextColor={colors.textFaint}
            style={s.input}
            autoFocus={loaded}
            maxLength={60}
          />
          <Text style={s.hint}>Shown on your profile and on logs you post.</Text>

          <TouchableOpacity
            style={[s.submit, !value.trim() && s.submitDisabled]}
            onPress={handleSubmit}
            disabled={!value.trim() || submitting}
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
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
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
