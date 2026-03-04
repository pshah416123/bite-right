import { apiClient } from './client';

export interface CreateSessionBody {
  sessionName?: string;
  locationBias?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
  code: string;
  shareUrl: string;
  expiresAt: string;
  participantId: string;
}

export interface JoinSessionResponse {
  sessionId: string;
  participantId: string;
  sessionState: {
    sessionId: string;
    code: string;
    sessionName: string | null;
    participantCount: number;
  };
}

export interface PoolItem {
  restaurantId: string;
  name: string;
  address: string;
  placeId?: string | null;
  previewPhotoUrl?: string;
  /** Resolved image URL (https or relative proxy path). Never a photo_reference. */
  imageUrl?: string;
}

export interface GetPoolResponse {
  pool: PoolItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MatchItem {
  restaurantId: string;
  name: string;
  address: string;
  percentMatch: number;
  previewPhotoUrl?: string;
}

export interface GetMatchesResponse {
  totalParticipants: number;
  likesRequired: number;
  matches: MatchItem[];
}

export async function createTonightSession(
  body: CreateSessionBody = {},
): Promise<CreateSessionResponse> {
  const { data } = await apiClient.post<CreateSessionResponse>('/api/tonight/sessions', body);
  return data;
}

export async function joinTonightSession(
  code: string,
  body: { userId?: string } = {},
): Promise<JoinSessionResponse> {
  const { data } = await apiClient.post<JoinSessionResponse>(
    `/api/tonight/sessions/${encodeURIComponent(code)}/join`,
    body,
  );
  return data;
}

export async function getTonightPool(
  code: string,
  page = 0,
  pageSize = 20,
): Promise<GetPoolResponse> {
  const { data } = await apiClient.get<GetPoolResponse>(
    `/api/tonight/sessions/${encodeURIComponent(code)}/pool`,
    { params: { page, pageSize } },
  );
  return data;
}

export async function postTonightSwipe(
  code: string,
  body: {
    participantId: string;
    restaurantId: string;
    action: 'LIKE' | 'PASS';
    userId?: string;
  },
): Promise<{ ok: boolean; saved?: boolean }> {
  const { data } = await apiClient.post<{ ok: boolean; saved?: boolean }>(
    `/api/tonight/sessions/${encodeURIComponent(code)}/swipe`,
    body,
  );
  return data;
}

export async function getTonightMatches(
  code: string,
  threshold?: number,
): Promise<GetMatchesResponse> {
  const params = threshold != null ? { threshold } : {};
  const { data } = await apiClient.get<GetMatchesResponse>(
    `/api/tonight/sessions/${encodeURIComponent(code)}/matches`,
    { params },
  );
  return data;
}
