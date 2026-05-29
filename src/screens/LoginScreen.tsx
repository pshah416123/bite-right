import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setInfo(null);
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    if (mode === 'signin') {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setLoading(false);
      if (authError) setError(authError.message);
    } else {
      const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password });
      setLoading(false);
      if (authError) {
        setError(authError.message);
      } else if (!data.session) {
        // Email confirmation required — session won't exist until confirmed
        setInfo('Account created! Check your email for a confirmation link, then sign in.');
        setMode('signin');
        setPassword('');
      }
    }
  };

  const toggleMode = () => {
    setError(null);
    setInfo(null);
    setEmail('');
    setPassword('');
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Wordmark */}
          <View style={s.wordmarkWrap}>
            <Text style={s.wordmark}>ByteRite</Text>
            <Text style={s.tagline}>Your Taste, Perfected</Text>
          </View>

          {/* Form card */}
          <View style={s.card}>
            <Text style={s.cardTitle}>
              {mode === 'signin' ? 'Welcome back' : 'Create your account'}
            </Text>

            {info ? (
              <View style={s.infoBox}>
                <Ionicons name="checkmark-circle-outline" size={15} color="#1A7F4E" style={s.errorIcon} />
                <Text style={s.infoText}>{info}</Text>
              </View>
            ) : null}

            {error ? (
              <View style={s.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#D93025" style={s.errorIcon} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Email */}
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor="#B8A89A"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
            />

            {/* Password */}
            <Text style={s.label}>Password</Text>
            <View style={s.passwordWrap}>
              <TextInput
                style={s.passwordInput}
                placeholder="••••••••"
                placeholderTextColor="#B8A89A"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={s.eyeBtn}
                onPress={() => setShowPassword((v) => !v)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#8A7060"
                />
              </TouchableOpacity>
            </View>

            {/* Sign In / Create Account */}
            <TouchableOpacity
              style={[s.primaryBtn, loading && s.btnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryBtnText}>
                  {mode === 'signin' ? 'Sign In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.secondaryBtn, loading && s.btnDisabled]}
              onPress={toggleMode}
              activeOpacity={0.8}
              disabled={loading}
            >
              <Text style={s.secondaryBtnText}>
                {mode === 'signin' ? 'Create Account' : 'Sign In Instead'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5EDE3' },
  kav: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },

  // Wordmark
  wordmarkWrap: { alignItems: 'center', marginBottom: 40 },
  flame: { fontSize: 52 },
  wordmark: {
    fontSize: 38,
    fontWeight: '800',
    color: '#1C1C1E',
    letterSpacing: -1,
    marginTop: 6,
  },
  tagline: { fontSize: 14, color: '#8A7060', marginTop: 6, fontWeight: '500' },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    shadowColor: 'rgba(180,120,80,0.12)',
    shadowOpacity: 1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1C1C1E',
    letterSpacing: -0.3,
    marginBottom: 20,
  },

  // Error
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FBF5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7DFC0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  infoText: { flex: 1, fontSize: 13, color: '#1A7F4E', fontWeight: '500', lineHeight: 18 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF0EE',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFCDC7',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorIcon: { marginTop: 1 },
  errorText: { flex: 1, fontSize: 13, color: '#D93025', fontWeight: '500', lineHeight: 18 },

  // Inputs
  label: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 6, marginTop: 14 },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E4E2E7',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#1C1C1E',
    backgroundColor: '#F0EFF2',
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E4E2E7',
    backgroundColor: '#F0EFF2',
    paddingHorizontal: 14,
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
    color: '#1C1C1E',
  },
  eyeBtn: { padding: 4 },

  // Buttons
  primaryBtn: {
    height: 52,
    borderRadius: 999,
    backgroundColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    shadowColor: 'rgba(255,107,53,0.3)',
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  secondaryBtn: {
    height: 52,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#FF6B35',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    backgroundColor: '#fff',
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '700', color: '#FF6B35', letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.55 },
});
