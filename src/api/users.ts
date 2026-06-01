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
  /** Optional short user-written bio. Surfaced on the friend profile when
   *  the user has no logs yet so the screen doesn't feel like a dead end. */
  bio?: string | null;
  /** ISO timestamp the users row was created — used to show "Joined Mon Year"
   *  on profile headers. */
  createdAt?: string | null;
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

/**
 * Match a list of raw phone strings (from the device address book) against
 * BiteRight users. The server normalizes each phone to E.164 before lookup,
 * so callers can pass numbers in any presentation format ("(312) 555-1212",
 * "+13125551212", "312.555.1212" — all work). Excludes the caller themselves
 * and anyone in a block edge. Returns at most one user per matched phone.
 */
export async function matchContacts(phones: string[]): Promise<UserSummary[]> {
  if (!Array.isArray(phones) || phones.length === 0) return [];
  const { data } = await apiClient.post<{ matches: UserSummary[] }>(
    '/api/users/match-contacts',
    { phones },
  );
  return Array.isArray(data?.matches) ? data.matches : [];
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
