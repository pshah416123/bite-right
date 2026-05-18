import axios from 'axios';
import { Platform } from 'react-native';

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
