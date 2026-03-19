/**
 * Social proof badges for restaurant cards: one short message per card.
 * Priority: 1) Friend signal, 2) Taste similarity, 3) Trending.
 */

const TRENDING_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TRENDING_THRESHOLD = 2;
const TRENDING_WEIGHTS = { save: 0.5, swipeRight: 0.3, log: 0.2 };

/**
 * Get friend IDs for a user (bidirectional: user's friends and who has user as friend).
 */
function getFriendIds(userId, friends) {
  if (!userId || !Array.isArray(friends)) return new Set();
  const set = new Set();
  for (const f of friends) {
    if (f.userId === userId) set.add(f.friendId);
    if (f.friendId === userId) set.add(f.userId);
  }
  return set;
}

/**
 * Count friends who have positively interacted with this restaurant (saved, swipe right, visit log, rating >= 8).
 * Returns { count, names } where names is up to 2 display names.
 */
function getFriendSignal(restaurantId, userId, { savedRestaurants, tonightSwipes, logs, friends, groupSessions, userDisplayNames }) {
  const friendIds = getFriendIds(userId, friends);
  if (friendIds.size === 0) return null;

  const savedBy = (savedRestaurants || []).filter((s) => s.restaurantId === restaurantId && friendIds.has(s.userId));
  const swipeBy = new Set();
  const sessionByCode = new Map();
  for (const s of groupSessions || []) sessionByCode.set(s.id, s);
  for (const sw of tonightSwipes || []) {
    if (sw.restaurantId !== restaurantId || sw.action !== 'LIKE') continue;
    const session = sessionByCode.get(sw.sessionId);
    const participant = session?.participants?.find((p) => p.participantId === sw.participantId);
    const uid = participant?.userId;
    if (uid && friendIds.has(uid)) swipeBy.add(uid);
  }
  const logBy = (logs || []).filter((l) => l.restaurantId === restaurantId && l.userId && friendIds.has(l.userId) && (l.rating >= 8 || l.rating == null));

  const allUserIds = new Set([...savedBy.map((s) => s.userId), ...swipeBy, ...logBy.map((l) => l.userId)]);
  const count = allUserIds.size;
  if (count === 0) return null;

  const names = [];
  const list = [...allUserIds];
  for (let i = 0; i < Math.min(2, list.length); i++) {
    const name = (userDisplayNames && userDisplayNames[list[i]]) || list[i].replace(/^user_/, 'User ');
    names.push(name);
  }
  const verb = savedBy.length > 0 ? 'saved' : logBy.length > 0 ? 'rated' : 'liked';
  let message;
  if (count === 1) message = `${names[0]} ${verb} this`;
  else if (count === 2) message = `${names[0]} and ${names[1]} ${verb} this`;
  else message = `${count} friends ${verb} this`;
  return { message, count };
}

/**
 * Compute trending score for a restaurant (last 7 days): 0.5*saves + 0.3*swipe_rights + 0.2*logs.
 */
function getTrendingScore(restaurantId, { savedRestaurants, tonightSwipes, logs, groupSessions }) {
  const cutoff = Date.now() - TRENDING_DAYS_MS;
  let saves = 0;
  for (const s of savedRestaurants || []) {
    if (s.restaurantId !== restaurantId) continue;
    const t = new Date(s.savedAt || 0).getTime();
    if (t >= cutoff) saves += 1;
  }
  let swipes = 0;
  for (const sw of tonightSwipes || []) {
    if (sw.restaurantId !== restaurantId || sw.action !== 'LIKE') continue;
    const t = new Date(sw.createdAt || 0).getTime();
    if (t >= cutoff) swipes += 1;
  }
  let logCount = 0;
  for (const l of logs || []) {
    if (l.restaurantId !== restaurantId) continue;
    const t = new Date(l.createdAt || 0).getTime();
    if (t >= cutoff) logCount += 1;
  }
  return TRENDING_WEIGHTS.save * saves + TRENDING_WEIGHTS.swipeRight * swipes + TRENDING_WEIGHTS.log * logCount;
}

/**
 * Pick one social proof badge for a restaurant. Priority: friends → taste similarity → trending.
 * @param {string} restaurantId
 * @param {string} userId
 * @param {Object} opts
 * @param {Array} opts.savedRestaurants
 * @param {Array} opts.tonightSwipes
 * @param {Array} opts.logs - items with { restaurantId, userId?, createdAt, rating? }
 * @param {Array} opts.friends - { userId, friendId }
 * @param {Array} opts.groupSessions
 * @param {Object} [opts.userDisplayNames] - { [userId]: displayName }
 * @param {boolean} [opts.similarTasteSignal] - from recommendation pipeline
 * @param {string} [opts.cuisine] - for "Popular with people who like X"
 * @returns {string | null} One badge text or null
 */
function getSocialProofBadge(restaurantId, userId, opts) {
  const {
    savedRestaurants,
    tonightSwipes,
    logs,
    friends,
    groupSessions,
    userDisplayNames,
    similarTasteSignal,
    cuisine,
  } = opts || {};

  const friendSignal = getFriendSignal(restaurantId, userId, {
    savedRestaurants,
    tonightSwipes,
    logs,
    friends,
    groupSessions,
    userDisplayNames,
  });
  if (friendSignal && friendSignal.count >= 1) return friendSignal.message;

  if (similarTasteSignal) {
    if (cuisine) return `Popular with people who like ${cuisine.split(' · ')[0]}`;
    return 'People like you loved this';
  }

  const trendingScore = getTrendingScore(restaurantId, { savedRestaurants, tonightSwipes, logs, groupSessions });
  if (trendingScore >= TRENDING_THRESHOLD) {
    return trendingScore >= 4 ? 'Trending tonight' : 'Popular this week';
  }

  return null;
}

module.exports = { getSocialProofBadge, getFriendIds, getTrendingScore };
