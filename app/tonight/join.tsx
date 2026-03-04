import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { joinTonightSession } from '../../src/api/tonight';
import { useTonightSession } from '../../src/context/TonightContext';
import { colors } from '../../src/theme/colors';

export default function TonightJoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const { setSession } = useTonightSession();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const code = (params.code ?? '').trim().toUpperCase();

  useEffect(() => {
    if (!code) {
      setStatus('error');
      setErrorMessage('No session code in link.');
      return;
    }
    let cancelled = false;
    joinTonightSession(code)
      .then((res) => {
        if (cancelled) return;
        setSession({
          sessionId: res.sessionId,
          code: res.sessionState.code,
          participantId: res.participantId,
          sessionName: res.sessionState.sessionName,
          participantCount: res.sessionState.participantCount,
        });
        setStatus('ok');
        router.replace('/tonight/swipe');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err.response?.data?.error || err.message || 'Failed to join session');
      });
    return () => {
      cancelled = true;
    };
  }, [code, setSession, router]);

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.helper}>Joining session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn’t join</Text>
          <Text style={styles.helper}>{errorMessage}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/tonight')}
          >
            <Text style={styles.buttonText}>Back to Tonight</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  helper: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  button: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.accent,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
