import { DiscoverApiResponse, DiscoverApiRecommendation, RestaurantMeta } from '../types/discover';

type Vec = number[];

interface UserTasteVector {
  userId: string;
  vector: Vec;
}

interface UserLog {
  userId: string;
  restaurantId: string;
  rating: number; // 0–10
}

interface RestaurantProfile extends RestaurantMeta {
  vector: Vec;
}

// --- Mock data ----------------------------------------------------------------

// 5 Chicago restaurants
const RESTAURANTS: RestaurantProfile[] = [
  {
    id: 'rest_1',
    name: "Lou Malnati's",
    neighborhood: 'River North',
    state: 'IL',
    cuisine: 'Pizza · Deep dish',
    priceLevel: 2,
    tags: ['pizza', 'casual', 'groups'],
    vector: [0.9, 0.7, 0.1, 0.3],
  },
  {
    id: 'rest_2',
    name: 'Girl & the Goat',
    neighborhood: 'West Loop',
    state: 'IL',
    cuisine: 'American · Small plates',
    priceLevel: 3,
    tags: ['date night', 'small plates', 'cozy'],
    vector: [0.2, 0.8, 0.2, 0.3],
  },
  {
    id: 'rest_3',
    name: "Portillo's",
    neighborhood: 'River North',
    state: 'IL',
    cuisine: 'Hot dogs · Chicago classics',
    priceLevel: 1,
    tags: ['casual', 'quick bite', 'classic'],
    vector: [0.8, 0.6, 0.1, 0.2],
  },
  {
    id: 'rest_4',
    name: 'The Purple Pig',
    neighborhood: 'Magnificent Mile',
    state: 'IL',
    cuisine: 'Mediterranean · Shared plates',
    priceLevel: 3,
    tags: ['wine', 'date night', 'shared plates'],
    vector: [0.1, 0.3, 0.9, 0.8],
  },
  {
    id: 'rest_5',
    name: 'Au Cheval',
    neighborhood: 'West Loop',
    state: 'IL',
    cuisine: 'Burgers · American',
    priceLevel: 2,
    tags: ['burgers', 'late night', 'groups'],
    vector: [0.7, 0.9, 0.2, 0.3],
  },
];

const USER_LOGS: UserLog[] = [
  { userId: 'you', restaurantId: 'rest_1', rating: 9.2 },
  { userId: 'you', restaurantId: 'rest_2', rating: 8.7 },
  { userId: 'maya', restaurantId: 'rest_2', rating: 9.0 },
  { userId: 'maya', restaurantId: 'rest_5', rating: 8.6 },
  { userId: 'alex', restaurantId: 'rest_3', rating: 9.4 },
  { userId: 'alex', restaurantId: 'rest_4', rating: 9.1 },
  { userId: 'sam', restaurantId: 'rest_2', rating: 8.9 },
  { userId: 'sam', restaurantId: 'rest_4', rating: 8.4 },
  { userId: 'lee', restaurantId: 'rest_4', rating: 9.0 },
  { userId: 'lee', restaurantId: 'rest_1', rating: 8.5 },
];

const ALL_USER_IDS = Array.from(new Set(USER_LOGS.map((l) => l.userId)));

// --- Small vector helpers -----------------------------------------------------

function add(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v + b[i]);
}

function scale(a: Vec, s: number): Vec {
  return a.map((v) => v * s);
}

function zeroVec(dim: number): Vec {
  return Array(dim).fill(0);
}

function dot(a: Vec, b: Vec): number {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

function norm(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a: Vec, b: Vec): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

// --- Build user taste vectors from logs --------------------------------------

function buildUserTasteVectors(): UserTasteVector[] {
  const byUser: Record<string, { sum: Vec; weight: number }> = {};
  const dim = RESTAURANTS[0].vector.length;

  for (const userId of ALL_USER_IDS) {
    byUser[userId] = { sum: zeroVec(dim), weight: 0 };
  }

  for (const log of USER_LOGS) {
    const userBucket = byUser[log.userId];
    const restaurant = RESTAURANTS.find((r) => r.id === log.restaurantId);
    if (!restaurant) continue;
    const weight = log.rating / 10; // higher rating pulls vector more
    userBucket.sum = add(userBucket.sum, scale(restaurant.vector, weight));
    userBucket.weight += weight;
  }

  return Object.entries(byUser).map(([userId, { sum, weight }]) => ({
    userId,
    vector: weight === 0 ? zeroVec(dim) : scale(sum, 1 / weight),
  }));
}

// --- Very small k-means (on user taste vectors) ------------------------------

interface ClusterResult {
  centroids: Vec[];
  assignments: Record<string, number>; // userId -> cluster index
}

function kMeans(vectors: UserTasteVector[], k: number, maxIters = 5): ClusterResult {
  const dim = vectors[0]?.vector.length ?? 0;
  if (dim === 0) {
    return { centroids: [], assignments: {} };
  }

  let centroids = vectors.slice(0, k).map((v) => [...v.vector]);
  let assignments: Record<string, number> = {};

  for (let iter = 0; iter < maxIters; iter += 1) {
    // Assign
    for (const v of vectors) {
      let bestIdx = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      centroids.forEach((c, idx) => {
        const dist = norm(v.vector.map((val, i) => val - c[i]));
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });
      assignments[v.userId] = bestIdx;
    }

    // Recompute centroids
    const sums = centroids.map(() => zeroVec(dim));
    const counts = centroids.map(() => 0);

    for (const v of vectors) {
      const clusterIdx = assignments[v.userId];
      sums[clusterIdx] = add(sums[clusterIdx], v.vector);
      counts[clusterIdx] += 1;
    }

    centroids = centroids.map((_, idx) =>
      counts[idx] === 0 ? zeroVec(dim) : scale(sums[idx], 1 / counts[idx]),
    );
  }

  return { centroids, assignments };
}

// --- Cluster-level restaurant preferences ------------------------------------

function buildClusterRatings(assignments: Record<string, number>): Record<
  number,
  Record<string, { sum: number; count: number }>
> {
  const byCluster: Record<number, Record<string, { sum: number; count: number }>> = {};

  for (const log of USER_LOGS) {
    const clusterIdx = assignments[log.userId];
    if (clusterIdx == null) continue;
    if (!byCluster[clusterIdx]) byCluster[clusterIdx] = {};
    const clusterBucket = byCluster[clusterIdx];
    if (!clusterBucket[log.restaurantId]) {
      clusterBucket[log.restaurantId] = { sum: 0, count: 0 };
    }
    clusterBucket[log.restaurantId].sum += log.rating;
    clusterBucket[log.restaurantId].count += 1;
  }

  return byCluster;
}

function normalizeRatingTo01(rating: number | undefined): number {
  if (!rating) return 0.5; // neutral if no data
  const clamped = Math.max(0, Math.min(10, rating));
  return clamped / 10;
}

// --- Public API: getDiscoverRecommendations ----------------------------------

const CURRENT_USER_ID = 'you';

export function getDiscoverRecommendations(userId: string = CURRENT_USER_ID): DiscoverApiResponse {
  const userLogs = USER_LOGS.filter((l) => l.userId === userId);
  const isColdStart = userLogs.length === 0;

  const userTasteVectors = buildUserTasteVectors();
  const selfVector = userTasteVectors.find((u) => u.userId === userId);

  // Cold start: not enough data, return popular overall
  if (!selfVector || isColdStart) {
    const popularity: Record<string, { sum: number; count: number }> = {};
    for (const log of USER_LOGS) {
      if (!popularity[log.restaurantId]) {
        popularity[log.restaurantId] = { sum: 0, count: 0 };
      }
      popularity[log.restaurantId].sum += log.rating;
      popularity[log.restaurantId].count += 1;
    }

    const recs: DiscoverApiRecommendation[] = RESTAURANTS.map((r) => {
      const stats = popularity[r.id];
      const avgRating = stats ? stats.sum / stats.count : 7;
      const percentMatch = Math.round(normalizeRatingTo01(avgRating) * 100);
      return {
        restaurant: r,
        percentMatch,
        explanations: ['Popular with BiteRight diners while we learn your taste'],
        sourceClusterId: 0,
        isExploratory: true,
      };
    }).sort((a, b) => b.percentMatch - a.percentMatch);

    return {
      userId,
      isColdStart: true,
      recommendations: recs,
    };
  }

  // Cluster all users by taste
  const clusterCount = Math.min(3, userTasteVectors.length);
  const { centroids, assignments } = kMeans(userTasteVectors, clusterCount);
  const clusterRatings = buildClusterRatings(assignments);

  // Identify current user's cluster and nearest neighboring cluster
  const myCluster = assignments[userId] ?? 0;
  let adjacentCluster = myCluster;
  let bestOtherDist = Number.POSITIVE_INFINITY;
  centroids.forEach((c, idx) => {
    if (idx === myCluster) return;
    const dist = norm(selfVector.vector.map((v, i) => v - c[i]));
    if (dist < bestOtherDist) {
      bestOtherDist = dist;
      adjacentCluster = idx;
    }
  });

  const visitedIds = new Set(userLogs.map((l) => l.restaurantId));

  const recs: DiscoverApiRecommendation[] = [];

  for (const r of RESTAURANTS) {
    if (visitedIds.has(r.id)) continue;

    const sim = cosineSimilarity(selfVector.vector, r.vector); // 0–1

    const primaryClusterStats = clusterRatings[myCluster]?.[r.id];
    const adjacentStats = clusterRatings[adjacentCluster]?.[r.id];

    const primaryPref = normalizeRatingTo01(
      primaryClusterStats ? primaryClusterStats.sum / primaryClusterStats.count : undefined,
    );
    const adjacentPref = normalizeRatingTo01(
      adjacentStats ? adjacentStats.sum / adjacentStats.count : undefined,
    );

    // Percent match formula:
    // match(u, r) = 100 * (0.7 * cosine_similarity + 0.3 * normalized_cluster_preference)
    const baseScore = 0.7 * sim + 0.3 * primaryPref;
    const percentMatch = Math.round(Math.max(0, Math.min(1, baseScore)) * 100);

    const explanations: string[] = [];
    if (primaryPref > 0.7) {
      explanations.push('Loved by people with a similar taste profile');
    }
    if (sim > 0.75) {
      explanations.push('Very close to places you’ve rated highly');
    } else if (adjacentPref > 0.65) {
      explanations.push('Popular in a nearby taste cluster – a gentle stretch pick');
    }
    if (!explanations.length) {
      explanations.push('Recommended based on your broader taste cluster');
    }

    const isExploratory = adjacentPref > primaryPref && adjacentCluster !== myCluster;
    const sourceClusterId = isExploratory ? adjacentCluster : myCluster;

    recs.push({
      restaurant: r,
      percentMatch,
      explanations,
      sourceClusterId,
      isExploratory,
    });
  }

  // Encourage some exploration: keep list sorted but slightly favor a few exploratory picks
  recs.sort((a, b) => b.percentMatch - a.percentMatch);

  const exploratory = recs.filter((r) => r.isExploratory).slice(0, 2);
  const core = recs.filter((r) => !r.isExploratory);

  const combined = [...core.slice(0, 6), ...exploratory].slice(0, 10);

  return {
    userId,
    isColdStart: false,
    recommendations: combined,
  };
}

