import { apiClient } from './client';
import type { FeedLog, VibeTag } from '../components/FeedCard';

export interface CreateLogInput {
  restaurantId: string;
  rating: number;
  notes?: string;
  photos?: string[];
  userId?: string;
  userName?: string;
  standoutDish?: string;
  dishes?: string[];
  vibeTags?: VibeTag[];
  quickTip?: string;
  highlight?: 'food' | 'vibe' | 'service' | 'value' | null;
  taggedUserIds?: string[];
}

interface CreateLogResponse {
  id: string;
  restaurantId: string;
  restaurantName: string;
  address: string;
  userId: string;
  userName: string | null;
  rating: number;
  notes?: string | null;
  previewPhotoUrl: string | null;
  standoutDish: string | null;
  dishes: string[] | null;
  vibeTags: VibeTag[] | null;
  quickTip: string | null;
  highlight: ('food' | 'vibe' | 'service' | 'value') | null;
  createdAt: string;
}

export async function createLog(input: CreateLogInput): Promise<CreateLogResponse> {
  const { data } = await apiClient.post<CreateLogResponse>('/api/logs', input);
  return data;
}

export async function getFeed(): Promise<FeedLog[]> {
  const { data } = await apiClient.get<FeedLog[]>('/api/feed', { params: { scope: 'global' } });
  return data;
}
