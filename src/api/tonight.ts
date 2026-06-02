import { apiClient } from './client';

// ── Session settings ─────────────────────────────────────────────────────────

export type MealTime = 'breakfast' | 'brunch' | 'lunch' | 'dinner';

export interface SessionSettings {
  location: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  searchRadius?: number;
  priceRange: number[];
  cuisines: string[];
  deckSize: 10 | 15 | 20;
  deadline: string | null;
  nominatedRestaurants: NominatedRestaurant[];
  /** When the group plans to eat. Server uses it (a) to reuse the Discover
   *  occasion-ranker so meal-shaped places bubble up, and (b) to hard-filter
   *  by isOpenNow when the chosen meal aligns with current local time. */
  mealTime?: MealTime | null;
}

export interface NominatedRestaurant {
  restaurantId: string;
  name: string;
  address: string;
  nominatedBy: string | null;
}

export interface ParticipantProgress {
  participantId: string;
  displayName: string;
  doneSwiping: boolean;
  swipeCount: number;
}

export interface SessionState {
  sessionId: string;
  code: string;
  hostUserId: string | null;
  hostParticipantId: string | null;
  started: boolean;
  participantCount: number;
  participants: ParticipantProgress[];
  settings: SessionSettings;
}

export interface CreateSessionBody {
  sessionName?: string;
  locationBias?: string;
  settings?: Partial<SessionSettings>;
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
  cuisine?: string | null;
  neighborhood?: string | null;
  priceLevel?: number | null;
  placeId?: string | null;
  googlePlaceId?: string | null;
  displayImageUrl?: string | null;
  displayImageSourceType?: 'override' | 'user' | 'google' | 'placeholder' | null;
  displayImageLastResolvedAt?: string | null;
  previewPhotoUrl?: string;
  /** Resolved image URL (https or relative proxy path). Never a photo_reference. */
  imageUrl?: string;
  /** One social proof badge: e.g. "3 friends saved this", "Trending tonight", "People like you loved this". */
  socialProofBadge?: string | null;
  /** Optional group consensus signal, e.g. \"3/4 liked this\". */
  groupSignal?: string | null;
  /** Distance from session location in miles. */
  distanceMi?: number | null;
  /** Personalized one-liner based on user history. */
  whyLine?: string | null;
  /** Top 2-3 recommended dishes. */
  recommendedDishes?: { name: string; price?: string | null; description?: string | null }[] | null;
  /** Whether the restaurant is currently open (from Google). */
  isOpenNow?: boolean | null;
  /** Google Places rating (1–5). */
  rating?: number | null;
  /** Set on each card when the cuisine filter was relaxed — explains why this
   *  card is showing up (e.g. "No ramen nearby — this is a japanese pick"). */
  fallbackNote?: string | null;
}

export interface GetPoolResponse {
  pool: PoolItem[];
  total: number;
  /** Cap on the total number of cards the participant will see this session.
   *  Mirrors the server-side MAX_TONIGHT_DECK constant; used by the swipe UI
   *  to render "x of N" progress and to know when the deck has bottomed out. */
  deckSize?: number;
  page: number;
  pageSize: number;
  /** True when the cuisine filter returned no results and we showed unfiltered picks instead. */
  filtersRelaxed?: boolean;
  /** Original cuisine the user requested — null when filtersRelaxed=false. */
  relaxedCuisine?: string | null;
  relaxedFrom?: string | null;
  /** Cuisine actually used (next on the similarity ladder). null = no cuisine at all. */
  relaxedTo?: string | null;
}

export interface MatchItem {
  restaurantId: string;
  name: string;
  address: string;
  percentMatch: number;
  displayImageUrl?: string | null;
  previewPhotoUrl?: string;
}

export interface GetMatchesResponse {
  totalParticipants: number;
  likesRequired: number;
  matches: MatchItem[];
  /** Number of participants who marked done swiping. Use with totalParticipants
   *  to distinguish "still in progress" from "everyone done, no agreement". */
  participantsDone?: number;
}

export async function createTonightSession(
  body: CreateSessionBody = {},
): Promise<CreateSessionResponse> {
  const { data } = await apiClient.post<CreateSessionResponse>('/api/tonight/sessions', body);
  return data;
}

export async function joinTonightSession(
  code: string,
  body: { userId?: string; participantId?: string } = {},
): Promise<JoinSessionResponse> {
  // Pass an existing participantId when re-joining (e.g. app reload or
  // network retry). Server uses it to dedup, otherwise a single user
  // who opens the link twice inflates participantCount.
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
  participantId?: string | null,
): Promise<GetPoolResponse> {
  const params: { page: number; pageSize: number; participantId?: string } = {
    page,
    pageSize,
  };
  if (participantId) params.participantId = participantId;
  const { data } = await apiClient.get<GetPoolResponse>(
    `/api/tonight/sessions/${encodeURIComponent(code)}/pool`,
    { params },
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

// ── Session setup endpoints ──────────────────────────────────────────────────

export async function updateSessionSettings(
  code: string,
  settings: Partial<Omit<SessionSettings, 'nominatedRestaurants'>>,
): Promise<{ ok: boolean; settings: SessionSettings }> {
  const { data } = await apiClient.put(
    `/api/tonight/sessions/${encodeURIComponent(code)}/settings`,
    settings,
  );
  return data;
}

export async function nominateRestaurant(
  code: string,
  body: { restaurantId: string; name: string; address?: string; participantId?: string },
): Promise<{ ok: boolean; nominated: NominatedRestaurant[] }> {
  const { data } = await apiClient.post(
    `/api/tonight/sessions/${encodeURIComponent(code)}/nominate`,
    body,
  );
  return data;
}

export async function removeNominatedRestaurant(
  code: string,
  restaurantId: string,
): Promise<{ ok: boolean; nominated: NominatedRestaurant[] }> {
  const { data } = await apiClient.delete(
    `/api/tonight/sessions/${encodeURIComponent(code)}/nominate/${encodeURIComponent(restaurantId)}`,
  );
  return data;
}

export async function startSession(
  code: string,
): Promise<{ ok: boolean; started: boolean; settings: SessionSettings }> {
  const { data } = await apiClient.post(
    `/api/tonight/sessions/${encodeURIComponent(code)}/start`,
  );
  return data;
}

export async function getSessionState(
  code: string,
): Promise<SessionState> {
  const { data } = await apiClient.get<SessionState>(
    `/api/tonight/sessions/${encodeURIComponent(code)}/state`,
  );
  return data;
}

export async function markDoneSwiping(
  code: string,
  participantId: string,
): Promise<{ ok: boolean; doneCount: number; totalParticipants: number; allDone: boolean }> {
  const { data } = await apiClient.post(
    `/api/tonight/sessions/${encodeURIComponent(code)}/done`,
    { participantId },
  );
  return data;
}
