import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments } from 'expo-router';
import { useAuth, type AuthState } from '../hooks/useAuth';
import { supabaseConfigured } from '../lib/supabase';

const AuthContext = createContext<AuthState | undefined>(undefined);
const TutorialContext = createContext<{
  markTutorialComplete: () => Promise<void>;
  resetTutorial: () => Promise<void>;
} | undefined>(undefined);
const TUTORIAL_FLAG = 'byterite_tutorialCompleted';

function useProtectedRoute(
  session: AuthState['session'],
  loading: boolean,
  tutorialDone: boolean | null,
) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // Skip auth redirect when Supabase isn't configured (dev without credentials)
    if (!supabaseConfigured) return;
    // Wait for the tutorial flag to load before deciding where to send a logged-in user.
    if (tutorialDone === null) return;

    const seg0 = segments[0] as string | undefined;
    const inAuthGroup = seg0 === '(auth)';
    const inTutorialGroup = seg0 === '(tutorial)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && !tutorialDone && !inTutorialGroup) {
      // Route type cast: typed-routes regen lags behind file creation;
      // refreshes on next `expo start` and removes the need for this cast.
      router.replace('/(tutorial)' as never);
    } else if (session && tutorialDone && (inAuthGroup || inTutorialGroup)) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments, tutorialDone]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [tutorialDone, setTutorialDone] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(TUTORIAL_FLAG)
      .then((v) => setTutorialDone(v === 'true'))
      .catch(() => setTutorialDone(false));
  }, []);

  const markTutorialComplete = useCallback(async () => {
    await AsyncStorage.setItem(TUTORIAL_FLAG, 'true');
    setTutorialDone(true);
  }, []);

  // Clear the tutorial flag so the next sign-in routes through onboarding.
  // Called from the delete-account flow — without this, AsyncStorage on
  // the device still says "tutorial done" from the deleted user's session
  // and a newly-created account skips straight to the home feed.
  const resetTutorial = useCallback(async () => {
    await AsyncStorage.removeItem(TUTORIAL_FLAG);
    setTutorialDone(false);
  }, []);

  useProtectedRoute(auth.session, auth.loading, tutorialDone);

  if (auth.loading || tutorialDone === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <TutorialContext.Provider value={{ markTutorialComplete, resetTutorial }}>{children}</TutorialContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}

export function useTutorialControls() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorialControls must be used within AuthProvider');
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
