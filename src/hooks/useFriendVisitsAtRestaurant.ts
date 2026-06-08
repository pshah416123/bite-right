import { useMemo } from 'react';
import { useFeedContext } from '../context/FeedContext';

/** Logs use this as the current user — everyone else is treated as a friend for Discover social avatars. */
export const DISCOVER_CURRENT_USER_NAME = 'You';

export type FriendVisitAtRestaurant = {
  id: string;
  /** Supabase user id when the visit was authored by a real user. Mock
   *  seed friends (Maya, Alex, etc.) come through with userId=null, which
   *  the UI uses to decide whether tapping the name opens the friend
   *  profile or shows the "demo profile" explainer. */
  userId?: string | null;
  userName: string;
  userAvatar?: string;
  score: number;
  note?: string;
  createdAt?: string;
  /** How many separate logs this friend has at the restaurant — drives
   *  "Riley has been 5x" style milestone callouts on the detail page.
   *  Optional so legacy callers (FeedCard's row construction, mock test
   *  fixtures) don't need to be updated when they don't care. */
  visitCount?: number;
};

/**
 * Latest visit per friend (by userName) at this restaurant, sorted by visit date (newest first).
 */
export function useFriendVisitsAtRestaurant(restaurantId: string): FriendVisitAtRestaurant[] {
  const { items } = useFeedContext();

  return useMemo(() => {
    if (!restaurantId) return [];
    const logs = items.filter(
      (l) =>
        l.restaurantId === restaurantId &&
        l.userName &&
        l.userName.trim() !== DISCOVER_CURRENT_USER_NAME,
    );

    const byUser = new Map<string, FriendVisitAtRestaurant>();
    for (const log of logs) {
      const key = log.userName.trim();
      const existing = byUser.get(key);
      const logTime = new Date(log.createdAt ?? 0).getTime();
      const prevTime = existing ? new Date(existing.createdAt ?? 0).getTime() : 0;
      const nextCount = (existing?.visitCount ?? 0) + 1;
      if (!existing || logTime >= prevTime) {
        byUser.set(key, {
          id: log.id,
          userId: log.userId ?? null,
          userName: key,
          userAvatar: log.userAvatar,
          score: log.score,
          note: log.note,
          createdAt: log.createdAt,
          visitCount: nextCount,
        });
      } else {
        // Older log — keep the latest visit row but bump the count.
        byUser.set(key, { ...existing, visitCount: nextCount });
      }
    }

    return Array.from(byUser.values()).sort((a, b) => {
      const tb = new Date(b.createdAt ?? 0).getTime();
      const ta = new Date(a.createdAt ?? 0).getTime();
      return tb - ta;
    });
  }, [items, restaurantId]);
}
