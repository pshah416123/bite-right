import axios from 'axios';
import { Platform } from 'react-native';
import { supabase, supabaseConfigured } from '../lib/supabase';

// Production URL is injected at build time via EXPO_PUBLIC_API_URL (see eas.json).
// In local dev (no env var set), fall back to the appropriate localhost for the
// platform — iOS simulator can use localhost; Android emulator must use 10.0.2.2.
const devFallback =
  Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? devFallback;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
});

// Identity cache — filled by the Supabase auth listener below, read by the
// request interceptor. The first version awaited supabase.auth.getSession()
// per request, which stalled cold-start fetches. The cached version that
// followed was non-blocking but raced: AuthProvider's separate getSession()
// could resolve and mount FeedProvider before the cache here populated,
// causing the first /api/feed call to go out unauthenticated and drop the
// user's friends-only / private logs from the response — testers saw logs
// "come and go" depending on which getSession() won the race.
//
// Compromise: kick off getSession() once at module load and stash the
// in-flight promise. The interceptor only awaits it when _userId is still
// null AND the promise hasn't resolved yet — so the first request waits at
// most a few ms for auth hydration, and every subsequent request is fast.
let _userId: string | null = null;
let _userEmail: string | null = null;
let _authReady: Promise<void> | null = null;

if (supabaseConfigured) {
  _authReady = supabase.auth
    .getSession()
    .then(({ data }) => {
      const user = data.session?.user;
      if (user) {
        _userId = user.id;
        _userEmail = user.email ?? null;
      }
    })
    .catch(() => {});

  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    _userId = user?.id ?? null;
    _userEmail = user?.email ?? null;
  });
}

apiClient.interceptors.request.use(async (config) => {
  if (!_userId && _authReady) {
    await _authReady;
  }
  if (_userId && config.headers) {
    config.headers['X-User-Id'] = _userId;
    if (_userEmail) config.headers['X-User-Email'] = _userEmail;
  }
  return config;
});
