/**
 * Discover recommendation pipeline: clustering + collaborative filtering.
 *
 * 1. User clusters: Users are clustered by a taste vector (counts of cuisine/neighborhood
 *    from their saved + swipe-right restaurants). K-means (k=3) assigns each user to a cluster.
 *
 * 2. Ranking: For each restaurant in radius we compute:
 *    - clusterSimilarityScore: how often this restaurant is saved/liked in the user's cluster
 *    - similarUserScore: how much similar users (Jaccard on liked sets) like this restaurant
 *    - personalTasteScore: match to user's top cuisines and neighborhoods
 *    - nearbyScore: distance decay within radius
 *    - noveltyScore: small bonus for not already liked
 *    finalScore = 0.45*(cluster+similarUser) + 0.30*personal + 0.15*nearby + 0.10*novelty
 *
 * 3. Cold start: If user has < 2 likes, we rank by nearbyScore + popularity (how many users
 *    saved/liked this restaurant). Explanations: "Popular with BiteRight users" or "Nearby · Try it and we'll learn your taste".
 *
 * 4. Explanations: Generated from similar-user overlap, cluster popularity, cuisine/neighborhood
 *    match, and restaurant-to-restaurant similarity ("Because you liked X").
 */

// Static features for pool restaurants (rest_1..rest_5). Extend when pool grows.
const RESTAURANT_FEATURES = {
  rest_1: { cuisine: 'Pizza · Deep dish', neighborhood: 'River North', priceLevel: 2, tags: ['pizza', 'casual', 'groups'] },
  rest_2: { cuisine: 'American · Small plates', neighborhood: 'West Loop', priceLevel: 3, tags: ['date night', 'small plates'] },
  rest_3: { cuisine: 'Hot dogs · Chicago classics', neighborhood: 'River North', priceLevel: 1, tags: ['casual', 'quick bite'] },
  rest_4: { cuisine: 'Mediterranean · Shared plates', neighborhood: 'Magnificent Mile', priceLevel: 3, tags: ['wine', 'date night', 'shared plates'] },
  rest_5: { cuisine: 'Burgers · American', neighborhood: 'West Loop', priceLevel: 2, tags: ['burgers', 'late night', 'groups'] },
};

function getFeatures(restaurantId) {
  return RESTAURANT_FEATURES[restaurantId] || { cuisine: '', neighborhood: '', priceLevel: 2, tags: [] };
}

/**
 * Build map: userId -> Set of restaurantIds (saved or swipe-right).
 * tonightSwipes: { sessionId, participantId, restaurantId, action }
 * groupSessions: { id, participants: [{ participantId, userId }] }
 */
function getLikedByUser(savedRestaurants, tonightSwipes, groupSessions) {
  const byUser = new Map(); // userId -> Set(restaurantId)

  function add(userId, restaurantId) {
    if (!userId || !restaurantId) return;
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId).add(restaurantId);
  }

  for (const s of savedRestaurants) {
    add(s.userId, s.restaurantId);
  }

  const sessionByCode = new Map();
  for (const sess of groupSessions) {
    sessionByCode.set(sess.id, sess);
  }
  for (const swipe of tonightSwipes) {
    if (swipe.action !== 'LIKE') continue;
    const session = sessionByCode.get(swipe.sessionId);
    if (!session || !session.participants) continue;
    const participant = session.participants.find((p) => p.participantId === swipe.participantId);
    const userId = participant?.userId;
    add(userId, swipe.restaurantId);
  }

  return byUser;
}

/**
 * User taste profile: liked ids, cuisine/neighborhood counts, avg price.
 */
function buildUserTasteProfile(userId, likedByUser, pool) {
  const likedIds = likedByUser.get(userId) || new Set();
  const cuisineCounts = {};
  const neighborhoodCounts = {};
  let priceSum = 0;
  let priceCount = 0;

  for (const restaurantId of likedIds) {
    const f = getFeatures(restaurantId);
    if (f.cuisine) cuisineCounts[f.cuisine] = (cuisineCounts[f.cuisine] || 0) + 1;
    if (f.neighborhood) neighborhoodCounts[f.neighborhood] = (neighborhoodCounts[f.neighborhood] || 0) + 1;
    if (f.priceLevel != null) { priceSum += f.priceLevel; priceCount += 1; }
  }

  const topCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  const topNeighborhoods = Object.entries(neighborhoodCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const avgPrice = priceCount > 0 ? priceSum / priceCount : 2;

  return {
    userId,
    likedIds,
    topCuisines,
    topNeighborhoods,
    avgPrice,
    likeCount: likedIds.size,
  };
}

/**
 * Similar users by Jaccard similarity on liked restaurant sets.
 */
function getSimilarUsers(userId, likedByUser, pool, topK = 20) {
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
 * Simple clustering: assign each user to a cluster by discretized "taste vector".
 * Vector = [cuisine1, cuisine2, ..., neighborhood1, ..., avgPrice]. We use a hash of top cuisines + neighborhoods.
 */
function buildUserClusters(likedByUser, pool) {
  const userIds = [...likedByUser.keys()];
  if (userIds.length === 0) return { assignments: {}, clusterLikes: {} };

  const k = Math.min(3, userIds.length);
  const features = new Set();
  for (const [, set] of likedByUser) {
    for (const rid of set) {
      const f = getFeatures(rid);
      if (f.cuisine) features.add('c_' + f.cuisine);
      if (f.neighborhood) features.add('n_' + f.neighborhood);
    }
  }
  const featureList = [...features];
  const dim = Math.max(1, featureList.length);

  function userVector(uid) {
    const set = likedByUser.get(uid) || new Set();
    const v = new Array(dim).fill(0);
    for (const rid of set) {
      const f = getFeatures(rid);
      const ci = featureList.indexOf('c_' + f.cuisine);
      const ni = featureList.indexOf('n_' + f.neighborhood);
      if (ci >= 0) v[ci] += 1;
      if (ni >= 0) v[ni] += 1;
    }
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
    for (const rid of set) {
      clusterLikes[c][rid] = (clusterLikes[c][rid] || 0) + 1;
    }
  }

  return { assignments, clusterLikes };
}

/**
 * Restaurant-to-restaurant similarity: content (cuisine, neighborhood, price) + collaborative (users who liked A also liked B).
 */
function getRestaurantSimilarity(restaurantId, likedByUser, pool) {
  const fA = getFeatures(restaurantId);
  const similar = [];
  for (const r of pool) {
    if (r.restaurantId === restaurantId) continue;
    const fB = getFeatures(r.restaurantId);
    let content = 0;
    if (fA.cuisine && fA.cuisine === fB.cuisine) content += 0.5;
    if (fA.neighborhood && fA.neighborhood === fB.neighborhood) content += 0.3;
    if (fA.priceLevel != null && fB.priceLevel != null && Math.abs(fA.priceLevel - fB.priceLevel) <= 1) content += 0.2;

    let collab = 0;
    let pairs = 0;
    for (const [, set] of likedByUser) {
      if (set.has(restaurantId) && set.has(r.restaurantId)) { collab += 1; pairs += 1; }
      if (set.has(restaurantId) || set.has(r.restaurantId)) pairs += 0.5;
    }
    const collabScore = pairs > 0 ? collab / Math.sqrt(pairs) : 0;
    const score = 0.5 * content + 0.5 * Math.min(1, collabScore * 2);
    if (score > 0.2) similar.push({ restaurantId: r.restaurantId, name: r.name, score });
  }
  similar.sort((a, b) => b.score - a.score);
  return similar.slice(0, 5);
}

/**
 * Generate explanation strings for a recommendation.
 */
function getExplanations(restaurantId, profile, similarUsers, clusterLikes, myCluster, similarRestaurants, pool) {
  const f = getFeatures(restaurantId);
  const explanations = [];

  const likedBySimilar = similarUsers.filter((u) => u.score > 0.3).length;
  if (likedBySimilar > 0) {
    explanations.push('Popular with people who like similar spots');
  }

  const clusterCount = clusterLikes[myCluster]?.[restaurantId];
  if (clusterCount != null && clusterCount > 0) {
    explanations.push('Trending with users like you');
  }

  if (f.cuisine && profile.topCuisines.includes(f.cuisine)) {
    explanations.push(`Strong match for your ${f.cuisine} tastes`);
  }
  if (f.neighborhood && profile.topNeighborhoods.includes(f.neighborhood)) {
    explanations.push(`In a neighborhood you like: ${f.neighborhood}`);
  }

  const fromSimilar = similarRestaurants.find((s) => s.restaurantId === restaurantId);
  if (fromSimilar && fromSimilar.score > 0.5 && similarRestaurants[0]?.restaurantId !== restaurantId) {
    const first = similarRestaurants[0];
    if (first.name) explanations.push(`Because you liked ${first.name}`);
  }

  if (explanations.length === 0) {
    explanations.push('Recommended for you');
  }
  return explanations;
}

/**
 * Decide recommendation mode: trending (cold start), blended (light personalization), or clustered (full collaborative).
 */
function getDiscoverMode(profile, likedByUser, similarUsers, clusterLikes, myCluster) {
  const totalPlatformLikes = [...likedByUser.values()].reduce((sum, set) => sum + set.size, 0);
  if (profile.likeCount < 2 || totalPlatformLikes < 5) return 'trending';
  if (similarUsers.length < 2) return 'blended';
  const myClusterSize = clusterLikes[myCluster] ? Object.keys(clusterLikes[myCluster]).length : 0;
  if (myClusterSize < 2) return 'blended';
  return 'clustered';
}

function buildTrendingSections(scored) {
  const topPicksForYou = scored.slice(0, 6).map((r) => ({
    ...r,
    explanations: r.explanations.length ? r.explanations : ['Trending nearby'],
  }));
  const trendingWithSimilarUsers = scored.slice(6, 11).map((r) => ({
    ...r,
    explanations: ['Popular this week'],
  }));
  return { topPicksForYou, becauseYouLiked: [], trendingWithSimilarUsers, allNearby: scored };
}

function scoreBlended(rid, profile, popularity, maxPop, nearbyScore, similarRestaurants, firstLikedName) {
  const pop = popularity[rid] || 0;
  const popularityScore = maxPop > 0 ? pop / maxPop : 0.4;
  const personalCuisine = profile.topCuisines.includes(getFeatures(rid).cuisine) ? 0.8 : 0.2;
  const personalNeighborhood = profile.topNeighborhoods.includes(getFeatures(rid).neighborhood) ? 0.5 : 0;
  const contentSim = similarRestaurants.find((s) => s.restaurantId === rid);
  const contentScore = contentSim ? contentSim.score : 0.2;
  const finalScore =
    0.35 * nearbyScore +
    0.35 * Math.max(0.3, popularityScore) +
    0.2 * (personalCuisine * 0.6 + personalNeighborhood * 0.4) +
    0.1 * contentScore;
  const explanations = [];
  if (firstLikedName && contentSim && contentSim.score > 0.4) explanations.push(`Because you liked ${firstLikedName}`);
  if (personalCuisine > 0.5) explanations.push('Matches your taste');
  if (pop > 0) explanations.push('Popular nearby');
  if (!explanations.length) explanations.push('For your taste');
  return { finalScore, explanations };
}

/**
 * Main entry: get sectioned Discover recommendations.
 * Progressive strategy: trending -> blended -> clustered so Discover is never blank.
 */
function getDiscoverRecommendations({
  userId = 'default',
  lat,
  lng,
  radiusMiles = 10,
  savedRestaurants,
  tonightSwipes,
  groupSessions,
  negativeFeedback = [],
  pool,
  getRestaurantInfo,
  distanceMiles: distFn,
}) {
  const likedByUser = getLikedByUser(savedRestaurants, tonightSwipes, groupSessions);
  const profile = buildUserTasteProfile(userId, likedByUser, pool);
  const { assignments, clusterLikes } = buildUserClusters(likedByUser, pool);
  const myCluster = assignments[userId] ?? 0;
  const similarUsers = getSimilarUsers(userId, likedByUser, pool, 15);
  const discoverMode = getDiscoverMode(profile, likedByUser, similarUsers, clusterLikes, myCluster);
  const userLikedIds = profile.likedIds;

  const popularity = {};
  for (const [, set] of likedByUser) {
    for (const rid of set) {
      popularity[rid] = (popularity[rid] || 0) + 1;
    }
  }
  const maxPop = Math.max(1, ...Object.values(popularity));

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
  const myHidden = hiddenByUser.get(userId) || new Set();
  const mySuggestLess = suggestLessByUser.get(userId) || new Set();

  const candidates = [];
  for (const r of pool) {
    const rid = r.restaurantId;
    if (myHidden.has(rid)) {
      // Strong negative: never recommend this restaurant again in Discover.
      continue;
    }
    const info = getRestaurantInfo(rid) || r;
    const distance = distFn(lat, lng, r.lat ?? 41.88, r.lng ?? -87.63);
    const inRadius = distance <= radiusMiles;
    const nearbyScore = Math.max(0, 1 - distance / (radiusMiles || 1));
    candidates.push({ r, rid, info, distance, inRadius, nearbyScore });
  }
  const inRadiusCandidates = candidates.filter((c) => c.inRadius);
  const useRadius = inRadiusCandidates.length > 0;
  const toScore = useRadius ? inRadiusCandidates : candidates;

  const scored = [];
  for (const { r, rid, info, distance, inRadius, nearbyScore } of toScore) {

    let clusterScore = 0;
    for (const c of [myCluster]) {
      const count = clusterLikes[c]?.[rid];
      if (count != null && count > 0) clusterScore = Math.min(1, count / 3);
    }

    let similarUserScore = 0;
    for (const { userId: otherId, score } of similarUsers) {
      if ((likedByUser.get(otherId) || new Set()).has(rid)) similarUserScore += score;
    }
    similarUserScore = Math.min(1, similarUserScore * 2);

    const personalScore = profile.topCuisines.includes(getFeatures(rid).cuisine) ? 0.8 : 0.2;
    const personalNeighborhood = profile.topNeighborhoods.includes(getFeatures(rid).neighborhood) ? 0.5 : 0;

    const noveltyBonus = userLikedIds.has(rid) ? 0 : 0.1;

    let finalScore;
    let explanations;

    if (discoverMode === 'trending') {
      const pop = popularity[rid] || 0;
      const popularityScore = maxPop > 0 ? pop / maxPop : 0.5;
      finalScore = 0.5 * nearbyScore + 0.5 * Math.max(0.3, popularityScore);
      explanations = pop > 0 ? ['Popular with BiteRight users'] : ['Trending nearby', 'Try it and we\'ll learn your taste'];
    } else if (discoverMode === 'blended') {
      const firstLiked = [...userLikedIds][0];
      const firstLikedName = firstLiked && getRestaurantInfo(firstLiked) ? getRestaurantInfo(firstLiked).name : null;
      const similarRestaurants = getRestaurantSimilarity(rid, likedByUser, pool);
      const { finalScore: fs, explanations: expl } = scoreBlended(rid, profile, popularity, maxPop, nearbyScore, similarRestaurants, firstLikedName);
      finalScore = fs;
      explanations = expl;
    } else {
      finalScore =
        0.45 * (clusterScore * 0.5 + similarUserScore * 0.5) +
        0.30 * (personalScore * 0.6 + personalNeighborhood * 0.4) +
        0.15 * nearbyScore +
        0.10 * noveltyBonus;
      const similarRestaurants = getRestaurantSimilarity(rid, likedByUser, pool);
      explanations = getExplanations(rid, profile, similarUsers, clusterLikes, myCluster, similarRestaurants, pool);
    }

    // Medium negative: \"suggest less\" downranks this restaurant (and implicitly similar ones via lower cluster/similarity signals over time).
    if (mySuggestLess.has(rid)) {
      finalScore *= 0.7; // soften but do not eliminate
      if (!explanations.includes('We will show you less like this')) {
        explanations.push('We will show you less like this');
      }
    }

    const cuisine = getFeatures(rid).cuisine || '';
    const similarTasteSignal =
      (clusterLikes[myCluster]?.[rid] || 0) > 0 ||
      similarUsers.some((su) => (likedByUser.get(su.userId) || new Set()).has(rid));

    scored.push({
      restaurantId: rid,
      name: info.name || r.name,
      address: info.address || r.address,
      neighborhood: (info.neighborhood || getFeatures(rid).neighborhood || (r.address && r.address.split(',')[0]) || null),
      cuisine,
      priceLevel: getFeatures(rid).priceLevel ?? 2,
      percentMatch: Math.round(Math.max(10, Math.min(100, finalScore * 100))),
      explanations,
      distance,
      inRadius: useRadius ? inRadius : true,
      similarTasteSignal,
    });
  }

  scored.sort((a, b) => b.percentMatch - a.percentMatch);

  let topPicksForYou;
  let becauseYouLiked;
  let trendingWithSimilarUsers;
  const allNearby = scored;

  if (discoverMode === 'trending') {
    const sections = buildTrendingSections(scored);
    topPicksForYou = sections.topPicksForYou;
    becauseYouLiked = sections.becauseYouLiked;
    trendingWithSimilarUsers = sections.trendingWithSimilarUsers;
  } else if (discoverMode === 'blended') {
    topPicksForYou = scored.slice(0, 6);
    becauseYouLiked = [];
    const firstLiked = [...userLikedIds][0];
    if (firstLiked && getRestaurantInfo(firstLiked)) {
      const similarToFirst = getRestaurantSimilarity(firstLiked, likedByUser, pool);
      const added = new Set(topPicksForYou.map((r) => r.restaurantId));
      for (const s of similarToFirst) {
        if (added.has(s.restaurantId)) continue;
        const rec = scored.find((r) => r.restaurantId === s.restaurantId);
        if (rec) {
          becauseYouLiked.push({ ...rec, explanations: [`Because you liked ${getRestaurantInfo(firstLiked).name}`] });
          added.add(s.restaurantId);
        }
        if (becauseYouLiked.length >= 4) break;
      }
    }
    trendingWithSimilarUsers = scored.filter((r) => (popularity[r.restaurantId] || 0) > 0 && !userLikedIds.has(r.restaurantId)).slice(0, 5);
  } else {
    topPicksForYou = scored.slice(0, 6);
    becauseYouLiked = [];
    const firstLiked = [...userLikedIds][0];
    if (firstLiked && getRestaurantInfo(firstLiked)) {
      const similarToFirst = getRestaurantSimilarity(firstLiked, likedByUser, pool);
      const added = new Set(topPicksForYou.map((r) => r.restaurantId));
      for (const s of similarToFirst) {
        if (added.has(s.restaurantId)) continue;
        const rec = scored.find((r) => r.restaurantId === s.restaurantId);
        if (rec) {
          becauseYouLiked.push({ ...rec, explanations: [`Because you liked ${getRestaurantInfo(firstLiked).name}`] });
          added.add(s.restaurantId);
        }
        if (becauseYouLiked.length >= 4) break;
      }
    }
    trendingWithSimilarUsers = scored.filter((r) => (clusterLikes[myCluster]?.[r.restaurantId] || 0) > 0 && !userLikedIds.has(r.restaurantId)).slice(0, 5);
  }

  const isColdStart = discoverMode === 'trending';
  return {
    isColdStart,
    discoverMode,
    sections: {
      topPicksForYou,
      becauseYouLiked,
      trendingWithSimilarUsers,
      allNearby,
    },
  };
}

module.exports = {
  getDiscoverRecommendations,
  getDiscoverMode,
  getLikedByUser,
  buildUserTasteProfile,
  getSimilarUsers,
  buildUserClusters,
  getRestaurantSimilarity,
  getFeatures,
};
