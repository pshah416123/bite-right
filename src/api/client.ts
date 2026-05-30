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

// Attach the Supabase auth identity to every outbound request so the server
// can identify the caller without us threading userId through every URL.
// This is a soft signal — not cryptographically verified — but matches the
// existing convention where /api/users/:userId/... already accepts the id as
// a parameter the client supplies. JWT verification can layer on top later
// without changing call sites.
apiClient.interceptors.request.use(async (config) => {
  if (!supabaseConfigured) return config;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      config.headers = config.headers ?? {};
      config.headers['X-User-Id'] = user.id;
      if (user.email) config.headers['X-User-Email'] = user.email;
    }
  } catch {
    // Don't block requests if session retrieval fails.
  }
  return config;
});
