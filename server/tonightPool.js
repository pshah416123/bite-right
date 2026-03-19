/**
 * Tonight swipe pool: build large candidate pool, rank (cold start / personalization / clustering), enforce variety, paginate.
 * Pool items must have: restaurantId, name, address, lat, lng, previewPhotoUrl, rating, cuisine, neighborhood, priceLevel.
 */

const DEFAULT_LAT = 41.88;
const DEFAULT_LNG = -87.63;
const DEFAULT_RADIUS_MILES = 10;
const MAX_CUISINE_IN_ROW = 2;
const MAX_NEIGHBORHOOD_IN_ROW = 2;

function getFeaturesFromItem(item) {
  return {
    cuisine: item.cuisine || '',
    neighborhood: item.neighborhood || '',
    priceLevel: item.priceLevel != null ? item.priceLevel : 2,
    tags: [],
  };
}

/**
 * Build map: userId -> Set of restaurantIds (saved or swipe-right).
 */
function getLikedByUser(savedRestaurants, tonightSwipes, groupSessions) {
  const byUser = new Map();
  function add(userId, restaurantId) {
    if (!userId || !restaurantId) return;
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId).add(restaurantId);
  }
  for (const s of savedRestaurants) add(s.userId, s.restaurantId);
  const sessionByCode = new Map();
  for (const sess of groupSessions) sessionByCode.set(sess.id, sess);
  for (const swipe of tonightSwipes) {
    if (swipe.action !== 'LIKE') continue;
    const session = sessionByCode.get(swipe.sessionId);
    if (!session?.participants) continue;
    const participant = session.participants.find((p) => p.participantId === swipe.participantId);
    add(participant?.userId, swipe.restaurantId);
  }
  return byUser;
}

/**
 * User taste profile from pool items (cuisine/neighborhood/price from liked restaurants).
 */
function buildUserTasteProfile(userId, likedByUser, poolItemsById) {
  const likedIds = likedByUser.get(userId) || new Set();
  const cuisineCounts = {};
  const neighborhoodCounts = {};
  let priceSum = 0;
  let priceCount = 0;
  for (const restaurantId of likedIds) {
    const item = poolItemsById.get(restaurantId);
    if (!item) continue;
    const f = getFeaturesFromItem(item);
    if (f.cuisine) cuisineCounts[f.cuisine] = (cuisineCounts[f.cuisine] || 0) + 1;
    if (f.neighborhood) neighborhoodCounts[f.neighborhood] = (neighborhoodCounts[f.neighborhood] || 0) + 1;
    if (f.priceLevel != null) { priceSum += f.priceLevel; priceCount += 1; }
  }
  const topCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  const topNeighborhoods = Object.entries(neighborhoodCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const avgPrice = priceCount > 0 ? priceSum / priceCount : 2;
  return { userId, likedIds, topCuisines, topNeighborhoods, avgPrice, likeCount: likedIds.size };
}

/**
 * Similar users by Jaccard on liked sets.
 */
function getSimilarUsers(userId, likedByUser, topK = 20) {
  const userSet = likedByUser.get(userId) || new Set();
  if (userSet.size === 0) return [];
  const scores = [];
  for (const [otherId, otherSet] of likedByUser) {
    if (otherId === userId) continue;
    const inter = [...userSet].filter((r) => otherSet.has(r)).length;
    const union = new Set([...userSet, ...otherSet]).size;
    const jaccard = union > 0 ? inter / union : 0;
    if (jaccard > 0) scores.push({ userId: otherId, score: jaccard });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

/**
 * Simple clustering: cluster index per userId.
 */
function buildUserClusters(likedByUser) {
  const userIds = [...likedByUser.keys()];
  if (userIds.length === 0) return { assignments: {}, clusterLikes: {} };
  const k = Math.min(3, userIds.length);
  const features = new Set();
  for (const [, set] of likedByUser) {
    for (const rid of set) features.add(rid);
  }
  const featureList = [...features];
  const dim = Math.max(1, featureList.length);
  function userVector(uid) {
    const set = likedByUser.get(uid) || new Set();
    const v = new Array(dim).fill(0);
    featureList.forEach((rid, i) => { if (set.has(rid)) v[i] = 1; });
    return v;
  }
  const vectors = userIds.map((uid) => ({ uid, vec: userVector(uid) }));
  let centroids = vectors.slice(0, k).map((v) => [...v.vec]);
  const assignments = {};
  for (let iter = 0; iter < 5; iter++) {
    for (const { uid, vec } of vectors) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const d = centroids[i].reduce((s, c, j) => s + (c - vec[j]) ** 2, 0);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      assignments[uid] = best;
    }
    const sums = centroids.map(() => new Array(dim).fill(0));
    const counts = centroids.map(() => 0);
    for (const { uid, vec } of vectors) {
      const c = assignments[uid];
      for (let i = 0; i < dim; i++) sums[c][i] += vec[i];
      counts[c] += 1;
    }
    centroids = sums.map((s, i) => s.map((v) => (counts[i] > 0 ? v / counts[i] : 0)));
  }
  const clusterLikes = {};
  for (const [uid, set] of likedByUser) {
    const c = assignments[uid] ?? 0;
    if (!clusterLikes[c]) clusterLikes[c] = {};
    for (const rid of set) clusterLikes[c][rid] = (clusterLikes[c][rid] || 0) + 1;
  }
  return { assignments, clusterLikes };
}

/**
 * Enforce variety: max MAX_CUISINE_IN_ROW same cuisine, max MAX_NEIGHBORHOOD_IN_ROW same neighborhood in a row.
 */
function applyVariety(ordered) {
  if (ordered.length <= 1) return ordered;
  const result = [];
  const remaining = [...ordered];
  while (remaining.length > 0) {
    const lastCuisines = result.slice(-MAX_CUISINE_IN_ROW).map((r) => r.cuisine);
    const lastNeighborhoods = result.slice(-MAX_NEIGHBORHOOD_IN_ROW).map((r) => r.neighborhood);
    let chosen = null;
    let chosenIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const cuisineBlocked = lastCuisines.length >= MAX_CUISINE_IN_ROW && lastCuisines.every((c) => c === r.cuisine);
      const neighborhoodBlocked = lastNeighborhoods.length >= MAX_NEIGHBORHOOD_IN_ROW && lastNeighborhoods.every((n) => n === r.neighborhood);
      if (!cuisineBlocked && !neighborhoodBlocked) {
        chosen = r;
        chosenIdx = i;
        break;
      }
    }
    if (chosen == null) {
      chosen = remaining[0];
      chosenIdx = 0;
    }
    result.push(chosen);
    remaining.splice(chosenIdx, 1);
  }
  return result;
}

/**
 * Get ranked Tonight pool: filter (distance, rating >= 4, has photo), score, variety, exclude already swiped.
 * @param {Object} opts
 * @param {Array} opts.pool - full pool items { restaurantId, name, address, lat, lng, previewPhotoUrl, rating, cuisine, neighborhood, priceLevel }
 * @param {number} opts.lat
 * @param {number} opts.lng
 * @param {number} opts.radiusMiles
 * @param {string} [opts.participantId]
 * @param {string} opts.sessionId
 * @param {Array} opts.tonightSwipes
 * @param {Array} opts.savedRestaurants
 * @param {Array} opts.groupSessions
 * @param {Array} [opts.negativeFeedback]
 * @param {Function} opts.distanceMiles
 * @returns {Array} ordered pool items (excluding swiped for this participant in this session)
 */
function getTonightPoolRanked(opts) {
  const {
    pool,
    lat = DEFAULT_LAT,
    lng = DEFAULT_LNG,
    radiusMiles = DEFAULT_RADIUS_MILES,
    participantId,
    sessionId,
    tonightSwipes,
    savedRestaurants,
    groupSessions,
    negativeFeedback = [],
    distanceMiles: distFn,
  } = opts;
  if (!pool || !distFn) return [];

  const session = groupSessions.find((s) => s.id === sessionId);
  const participant = session?.participants?.find((p) => p.participantId === participantId);
  const userId = participant?.userId || null;

  const swipedInSession = new Set(
    (tonightSwipes || [])
      .filter((s) => s.sessionId === sessionId && s.participantId === participantId)
      .map((s) => s.restaurantId),
  );

  const poolItemsById = new Map();
  for (const r of pool) poolItemsById.set(r.restaurantId, r);

  const likedByUser = getLikedByUser(savedRestaurants || [], tonightSwipes || [], groupSessions || []);
  const profile = buildUserTasteProfile(userId || 'default', likedByUser, poolItemsById);
  const { assignments, clusterLikes } = buildUserClusters(likedByUser);
  const myCluster = userId ? (assignments[userId] ?? 0) : 0;
  const similarUsers = getSimilarUsers(userId || 'default', likedByUser, 15);

  const popularity = {};
  for (const [, set] of likedByUser) {
    for (const rid of set) popularity[rid] = (popularity[rid] || 0) + 1;
  }
  const maxPop = Math.max(1, ...Object.values(popularity));

  const cuisineCount = {};
  for (const r of pool) {
    const c = r.cuisine || 'Other';
    cuisineCount[c] = (cuisineCount[c] || 0) + 1;
  }
  const totalCuisines = Object.keys(cuisineCount).length || 1;

  const hiddenByUser = new Map();
  const suggestLessByUser = new Map();
  for (const fb of negativeFeedback) {
    if (!fb || !fb.userId || !fb.restaurantId) continue;
    if (fb.actionType === 'hide') {
      if (!hiddenByUser.has(fb.userId)) hiddenByUser.set(fb.userId, new Set());
      hiddenByUser.get(fb.userId).add(fb.restaurantId);
    } else if (fb.actionType === 'suggest_less') {
      if (!suggestLessByUser.has(fb.userId)) suggestLessByUser.set(fb.userId, new Set());
      suggestLessByUser.get(fb.userId).add(fb.restaurantId);
    }
  }
  const myHidden = userId ? hiddenByUser.get(userId) || new Set() : new Set();
  const mySuggestLess = userId ? suggestLessByUser.get(userId) || new Set() : new Set();

  const candidates = [];
  for (const r of pool) {
    if (swipedInSession.has(r.restaurantId)) continue;
    if (myHidden.has(r.restaurantId)) continue; // never show hidden restaurants in Tonight
    const distance = distFn(lat, lng, r.lat ?? DEFAULT_LAT, r.lng ?? DEFAULT_LNG);
    if (distance > radiusMiles) continue;
    const rating = typeof r.rating === 'number' ? r.rating : parseFloat(r.rating) || 4;
    if (rating < 4) continue;

    const distanceScore = Math.max(0, 1 - distance / radiusMiles);
    const ratingNorm = Math.min(1, Math.max(0, (rating - 4) / 1));
    const pop = popularity[r.restaurantId] || 0;
    const popularityScore = maxPop > 0 ? pop / maxPop : 0.3;
    const cuisineDiversity = 1 / (1 + (cuisineCount[r.cuisine || 'Other'] || 1) / totalCuisines);

    let coldStart = 0.4 * ratingNorm + 0.3 * Math.max(0.3, popularityScore) + 0.2 * distanceScore + 0.1 * cuisineDiversity;

    let personalScore = 0;
    if (profile.likeCount >= 1) {
      const f = getFeaturesFromItem(r);
      if (profile.topCuisines.includes(f.cuisine)) personalScore += 0.35;
      if (profile.topNeighborhoods.includes(f.neighborhood)) personalScore += 0.25;
      if (f.priceLevel != null && Math.abs(f.priceLevel - profile.avgPrice) <= 1) personalScore += 0.2;
      const likedIds = [...profile.likedIds];
      for (const lid of likedIds) {
        const other = poolItemsById.get(lid);
        if (!other) continue;
        const of = getFeaturesFromItem(other);
        if (of.cuisine === f.cuisine) personalScore += 0.1;
        if (of.neighborhood === f.neighborhood) personalScore += 0.1;
      }
      personalScore = Math.min(1, personalScore);
    }

    let clusterScore = 0;
    if (profile.likeCount >= 2 && similarUsers.length >= 1) {
      const count = clusterLikes[myCluster]?.[r.restaurantId];
      if (count != null && count > 0) clusterScore = Math.min(1, count / 3);
      let similarUserScore = 0;
      for (const { userId: otherId, score } of similarUsers) {
        if ((likedByUser.get(otherId) || new Set()).has(r.restaurantId)) similarUserScore += score;
      }
      similarUserScore = Math.min(1, similarUserScore * 2);
      clusterScore = 0.5 * clusterScore + 0.5 * similarUserScore;
    }

    const hasPersonalization = profile.likeCount >= 1;
    const hasClustering = profile.likeCount >= 2 && similarUsers.length >= 1;
    let finalScore;
    if (!hasPersonalization) {
      finalScore = coldStart;
    } else if (!hasClustering) {
      finalScore = 0.6 * coldStart + 0.4 * personalScore;
    } else {
      finalScore = 0.4 * coldStart + 0.35 * personalScore + 0.25 * clusterScore;
    }

    if (mySuggestLess.has(r.restaurantId)) {
      finalScore *= 0.7;
    }

    const similarTasteSignal =
      hasClustering &&
      ((clusterLikes[myCluster]?.[r.restaurantId] || 0) > 0 ||
        similarUsers.some((su) => (likedByUser.get(su.userId) || new Set()).has(r.restaurantId)));
    candidates.push({ ...r, _score: finalScore, similarTasteSignal });
  }

  candidates.sort((a, b) => b._score - a._score);
  const ordered = candidates.map(({ _score, similarTasteSignal, ...r }) => ({ ...r, similarTasteSignal }));
  return applyVariety(ordered);
}

module.exports = { getTonightPoolRanked, applyVariety };
