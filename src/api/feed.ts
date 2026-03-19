import { apiClient } from './client';
import type { FeedLog } from '../components/FeedCard';

export type FeedScope = 'friends' | 'following' | 'global';

export async function getFeed(scope: FeedScope): Promise<FeedLog[]> {
  const { data } = await apiClient.get<FeedLog[]>('/api/feed', {
    params: { scope },
  });
  return data;
}
