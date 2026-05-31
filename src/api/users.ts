import { apiClient } from './client';
import type { FeedLog } from '../components/FeedCard';

export type UserVisibility = 'public' | 'friends' | 'private';

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  phone?: string | null;
  visibility?: UserVisibility;
  followingCount?: number;
  followerCount?: number;
}

export async function getMe(): Promise<UserSummary> {
  const { data } = await apiClient.get<UserSummary>('/api/users/me');
  return data;
}

export async function updateMe(patch: {
  displayName?: string;
  username?: string;
  phone?: string | null;
  visibility?: UserVisibility;
  avatarUrl?: string | null;
}): Promise<UserSummary> {
  const { data } = await apiClient.patch<UserSummary>('/api/users/me', patch);
  return data;
}

export async function getBlockedUsers(): Promise<UserSummary[]> {
  const { data } = await apiClient.get<UserSummary[]>('/api/users/me/blocked');
  return data;
}

export async function blockUser(userId: string): Promise<{ ok: boolean }> {
  const { data } = await apiClient.post<{ ok: boolean }>(`/api/blocks/${encodeURIComponent(userId)}`);
  return data;
}

export async function unblockUser(userId: string): Promise<{ ok: boolean }> {
  const { data } = await apiClient.delete<{ ok: boolean }>(`/api/blocks/${encodeURIComponent(userId)}`);
  return data;
}

export async function deleteMe(): Promise<{ ok: boolean }> {
  const { data } = await apiClient.delete<{ ok: boolean }>('/api/users/me');
  return data;
}

export async function getUser(id: string): Promise<UserSummary> {
  const { data } = await apiClient.get<UserSummary>(`/api/users/${encodeURIComponent(id)}`);
  return data;
}

export async function createUser(input: {
  name: string;
  username: string;
  email?: string;
}): Promise<UserSummary> {
  const { data } = await apiClient.post<UserSummary>('/api/users', input);
  return data;
}

export async function searchUsers(query: string): Promise<UserSummary[]> {
  if (!query.trim()) return [];
  const { data } = await apiClient.get<UserSummary[]>('/api/users', {
    params: { query: query.trim() },
  });
  return data;
}

export async function getSuggestedUsers(): Promise<UserSummary[]> {
  const { data } = await apiClient.get<UserSummary[]>('/api/users/suggested');
  return data;
}

export async function followUser(userId: string): Promise<{ ok: boolean; following: boolean }> {
  const { data } = await apiClient.post<{ ok: boolean; following: boolean }>(
    `/api/follows/${encodeURIComponent(userId)}`,
  );
  return data;
}

export async function unfollowUser(userId: string): Promise<{ ok: boolean; following: boolean }> {
  const { data } = await apiClient.delete<{ ok: boolean; following: boolean }>(
    `/api/follows/${encodeURIComponent(userId)}`,
  );
  return data;
}

export async function getFollowers(userId: string): Promise<UserSummary[]> {
  const { data } = await apiClient.get<UserSummary[]>(
    `/api/users/${encodeURIComponent(userId)}/followers`,
  );
  return data;
}

export async function getFollowing(userId: string): Promise<UserSummary[]> {
  const { data } = await apiClient.get<UserSummary[]>(
    `/api/users/${encodeURIComponent(userId)}/following`,
  );
  return data;
}

export async function getUserLogs(userId: string): Promise<FeedLog[]> {
  const { data } = await apiClient.get<FeedLog[]>(
    `/api/users/${encodeURIComponent(userId)}/logs`,
  );
  return data;
}
