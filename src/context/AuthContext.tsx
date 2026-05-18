import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useAuth, type AuthState } from '../hooks/useAuth';
import { supabaseConfigured } from '../lib/supabase';

const AuthContext = createContext<AuthState | undefined>(undefined);

function useProtectedRoute(session: AuthState['session'], loading: boolean) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // Skip auth redirect when Supabase isn't configured (dev without credentials)
    if (!supabaseConfigured) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  useProtectedRoute(auth.session, auth.loading);

  if (auth.loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
