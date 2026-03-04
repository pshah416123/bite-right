import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const defaultUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
const API_BASE_URL = Constants.expoConfig?.extra?.apiUrl ?? defaultUrl;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

