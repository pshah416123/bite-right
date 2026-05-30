/**
 * Edit phone number — stored as a contact field on the user row (not an
 * auth method). Server validates length only; no carrier verification.
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

export default function EditPhoneScreen() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        setValue(me.phone ?? '');
        setHasExisting(!!me.phone);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (trimmed && (trimmed.length < 6 || trimmed.length > 20)) {
      Alert.alert('Invalid phone', 'Use 6–20 characters (digits, spaces, dashes, parens, leading +).');
      return;
    }
    setSubmitting(true);
    try {
      await updateMe({ phone: trimmed || null });
      router.back();
    } catch (e: any) {
      Alert.alert('Update failed', e?.response?.data?.error || e?.message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async () => {
    setSubmitting(true);
    try {
      await updateMe({ phone: null });
      router.back();
    } catch (e: any) {
      Alert.alert('Could not remove phone', e?.response?.data?.error || e?.message || 'Try again.');
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
          <Text style={s.title}>Phone number</Text>
        </View>

        <View style={s.body}>
          <Text style={s.label}>Phone</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="+1 (555) 555-5555"
            placeholderTextColor={colors.textFaint}
            style={s.input}
            keyboardType="phone-pad"
            autoCorrect={false}
            maxLength={20}
          />
          <Text style={s.hint}>Used for friend lookups and account recovery. Not shown publicly.</Text>

          <TouchableOpacity
            style={[s.submit, !value.trim() && hasExisting && s.submitGhost]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={s.submitText}>{submitting ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>

          {hasExisting ? (
            <TouchableOpacity style={s.removeBtn} onPress={handleRemove} disabled={submitting}>
              <Text style={s.removeText}>Remove phone</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
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
  submit: { marginTop: 28, backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  submitGhost: { backgroundColor: colors.surfaceSoft },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  removeBtn: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  removeText: { color: '#B83A3A', fontSize: 14, fontWeight: '600' },
});
