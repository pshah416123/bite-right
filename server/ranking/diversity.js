/**
 * Diversity reranker.
 *
 * Problem: raw scoring produces runs of similar restaurants
 * (e.g., 5 taco spots in a row in Pilsen). This module reranks
 * the top N results so cuisine/subcategory/price are spread out,
 * while still keeping the strongest restaurants near the top.
 *
 * Algorithm: greedy pick with penalty accumulation.
 * For each slot in the output, pick the candidate with the highest
 * (baseScore − accumulated penalty). Penalties increase each
 * time a cuisine/subcategory/price tier is repeated.
 *
 * Note: diversity reranking may reorder restaurants so a lower-baseScore
 * restaurant appears above a higher one. The pipeline handles this by
 * assigning monotonically non-increasing displayScores after reranking
 * (see pipeline.js).
 */

const { DIVERSITY } = require('./config');

/**
 * Extract the primary cuisine from a cuisine string like "Mexican · Tacos".
 * @param {string} cuisine
 * @returns {string}
 */
function primaryCuisine(cuisine) {
  if (!cuisine) return 'unknown';
  // Take the first segment before any separator
  const first = cuisine.split(/[·•|,/–-]/).map(s => s.trim()).filter(Boolean)[0];
  return (first || cuisine).toLowerCase().trim();
}

/**
 * Extract subcategory tags from cuisine string and explicit tags.
 * E.g., "Mexican · Tacos" → ["tacos"], plus any tags array.
 *
 * @param {string} cuisine
 * @param {string[]} [tags]
 * @returns {string[]}
 */
function extractSubcategories(cuisine, tags) {
  const result = new Set();

  if (cuisine) {
    const parts = cuisine.split(/[·•|,/–-]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    // Skip the first part (primary cuisine), add the rest as subcategories
    for (let i = 1; i < parts.length; i++) {
      result.add(parts[i]);
    }
  }

  if (tags) {
    for (const t of tags) {
      result.add(t.toLowerCase().trim());
    }
  }

  return [...result];
}

/**
 * Rerank a scored restaurant list for diversity.
 *
 * Input must be sorted by baseScore descending. Each item must have a
 * numeric `baseScore` field (0–1 raw composite before chain penalty).
 *
 * @param {Array<{ restaurantId: string, cuisine: string, priceLevel: number, tags?: string[], baseScore: number, [key: string]: any }>} restaurants
 * @param {object} [opts]
 * @param {number} [opts.window] — how many top slots to diversify (default: DIVERSITY.window)
 * @returns {typeof restaurants} — reranked array (full list, only top `window` positions change)
 */
function diversityRerank(restaurants, opts = {}) {
  const window = opts.window ?? DIVERSITY.window;

  if (restaurants.length <= 2) return restaurants;

  const topPool = restaurants.slice(0, Math.min(window * 2, restaurants.length));
  const tail = restaurants.slice(Math.min(window * 2, restaurants.length));

  const picked = [];
  const remaining = new Set(topPool.map((_, i) => i));

  // Track how many times each category has been picked
  const cuisineCount = {};
  const subcategoryCount = {};
  const priceCount = {};

  for (let slot = 0; slot < Math.min(window, topPool.length); slot++) {
    let bestIdx = -1;
    let bestAdjusted = -Infinity;

    for (const idx of remaining) {
      const r = topPool[idx];
      const pc = primaryCuisine(r.cuisine);
      const subs = extractSubcategories(r.cuisine, r.tags);
      const price = r.priceLevel ?? 2;

      // Calculate penalty
      let penalty = 0;

      const cCount = cuisineCount[pc] || 0;
      penalty += cCount * DIVERSITY.cuisinePenalty;

      // Hard cap: if this cuisine already appears maxSameCuisine times, heavy penalty
      if (cCount >= DIVERSITY.maxSameCuisine) {
        penalty += 0.5;
      }

      for (const sub of subs) {
        penalty += (subcategoryCount[sub] || 0) * DIVERSITY.subcategoryPenalty;
      }

      penalty += (priceCount[price] || 0) * DIVERSITY.pricePenalty;

      const adjusted = r.baseScore - penalty;

      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIdx = idx;
      }
    }

    if (bestIdx < 0) break;

    const chosen = topPool[bestIdx];
    picked.push(chosen);
    remaining.delete(bestIdx);

    // Update counts
    const pc = primaryCuisine(chosen.cuisine);
    cuisineCount[pc] = (cuisineCount[pc] || 0) + 1;
    for (const sub of extractSubcategories(chosen.cuisine, chosen.tags)) {
      subcategoryCount[sub] = (subcategoryCount[sub] || 0) + 1;
    }
    const price = chosen.priceLevel ?? 2;
    priceCount[price] = (priceCount[price] || 0) + 1;
  }

  // Append any remaining from the pool that weren't picked
  const pickedSet = new Set(picked.map(p => p.restaurantId));
  const leftover = topPool.filter(r => !pickedSet.has(r.restaurantId));

  return [...picked, ...leftover, ...tail];
}

module.exports = {
  diversityRerank,
  primaryCuisine,
  extractSubcategories,
};
