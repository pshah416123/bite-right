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

// Identity cache — filled by the Supabase auth listener below, read
// synchronously by the request interceptor. The first version of this
// awaited supabase.auth.getSession() per request, which stalled cold-start
// fetches (the detail page came up empty because getRestaurantDetail
// timed out waiting on the session promise). With the cache, the
// interceptor is fast + non-blocking.
let _userId: string | null = null;
let _userEmail: string | null = null;

if (supabaseConfigured) {
  supabase.auth
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

apiClient.interceptors.request.use((config) => {
  if (_userId && config.headers) {
    config.headers['X-User-Id'] = _userId;
    if (_userEmail) config.headers['X-User-Email'] = _userEmail;
  }
  return config;
});
