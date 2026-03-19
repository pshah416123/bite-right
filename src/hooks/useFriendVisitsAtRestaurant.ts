import { useMemo } from 'react';
import { useFeedContext } from '../context/FeedContext';

/** Logs use this as the current user — everyone else is treated as a friend for Discover social avatars. */
export const DISCOVER_CURRENT_USER_NAME = 'You';

export type FriendVisitAtRestaurant = {
  userName: string;
  userAvatar?: string;
  score: number;
  createdAt?: string;
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
      if (!existing || logTime >= prevTime) {
        byUser.set(key, {
          userName: key,
          userAvatar: log.userAvatar,
          score: log.score,
          createdAt: log.createdAt,
        });
      }
    }

    return Array.from(byUser.values()).sort((a, b) => {
      const tb = new Date(b.createdAt ?? 0).getTime();
      const ta = new Date(a.createdAt ?? 0).getTime();
      return tb - ta;
    });
  }, [items, restaurantId]);
}
