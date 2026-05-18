/**
 * Individual score components.
 *
 * Each function returns a value in [0, 1]. The pipeline combines them
 * using weights from config.js and maps the result to the display range.
 *
 * Score concepts:
 *   baseScore    — weighted sum of components (0–1)
 *   finalScore   — after chain penalty (0–1)
 *   displayScore — user-facing integer mapped via piecewise breakpoints
 */

const { QUALITY, POPULARITY, DISTANCE, CHAINS, PRESENTATION } = require('./config');

// ── Quality score ────────────────────────────────────────────────────
/**
 * Bayesian-adjusted quality score.
 *
 * Uses a Bayesian average so a 5.0 with 2 reviews doesn't outrank
 * a 4.5 with 800 reviews. The prior pulls sparse ratings toward the
 * platform average, and only lets them shine once enough reviews confirm.
 *
 * @param {number|null} rating    — Google rating (1–5)
 * @param {number|null} reviewCount — total reviews
 * @returns {number} 0–1
 */
function qualityScore(rating, reviewCount) {
  if (rating == null) return 0.3; // no data → below average default

  const n = reviewCount ?? 0;
  const R = Math.max(1, Math.min(5, rating));
  const C = QUALITY.priorRating;
  const m = QUALITY.priorWeight;

  // Bayesian average: (n·R + m·C) / (n + m)
  const bayesian = (n * R + m * C) / (n + m);

  // Map [floor, 5.0] → [0, 1] with a slight curve favoring 4.0+ ratings
  const normalized = Math.max(0, (bayesian - QUALITY.floor) / (5 - QUALITY.floor));

  // Apply a gentle power curve so the 4.2–4.8 range has more spread
  return Math.pow(normalized, 0.85);
}

// ── Popularity score ─────────────────────────────────────────────────
/**
 * Log-scaled popularity so review count differences are meaningful
 * at the low end (50 vs 200 matters) but not at the high end
 * (3000 vs 5000 barely matters).
 *
 * @param {number|null} reviewCount
 * @returns {number} 0–1
 */
function popularityScore(reviewCount) {
  if (reviewCount == null || reviewCount <= 0) return 0.1;

  const n = Math.max(1, reviewCount);
  // log(n) / log(saturation) capped at 1
  const raw = Math.log(n) / Math.log(POPULARITY.saturation);
  return Math.min(1, Math.max(0, raw));
}

// ── Distance score ───────────────────────────────────────────────────
/**
 * Exponential distance decay.
 *
 * Everything within `walkable` is 1.0. Then exponential decay
 * with configurable half-life. Beyond maxUseful → 0.
 *
 * @param {number} distanceMiles
 * @returns {number} 0–1
 */
function distanceScore(distanceMiles) {
  if (distanceMiles <= DISTANCE.walkable) return 1.0;
  if (distanceMiles >= DISTANCE.maxUseful) return 0.0;

  const effectiveDist = distanceMiles - DISTANCE.walkable;
  const effectiveHalfLife = DISTANCE.halfLife - DISTANCE.walkable;

  // Exponential decay: 0.5^(d / halfLife)
  return Math.pow(0.5, effectiveDist / Math.max(0.1, effectiveHalfLife));
}

// ── Data confidence ──────────────────────────────────────────────────
/**
 * Measures how much we can trust the data for this restaurant.
 * Places with ratings, enough reviews, price info, and photos
 * inspire more confidence in the overall score.
 *
 * Renamed from "freshness" — this is about data completeness, not recency.
 *
 * @param {{ rating?: number|null, reviewCount?: number|null, priceLevel?: number|null, hasPhoto?: boolean }} place
 * @returns {number} 0–1
 */
function confidenceScore(place) {
  let score = 0.2; // base

  if (place.rating != null) score += 0.25;
  if (place.reviewCount != null && place.reviewCount >= POPULARITY.minReviews) score += 0.25;
  if (place.priceLevel != null) score += 0.15;
  if (place.hasPhoto) score += 0.15;

  return Math.min(1, score);
}

// ── Chain detection ──────────────────────────────────────────────────

/**
 * @typedef {'major_fast_food'|'regional_chain'|'small_local_chain'|'independent'} ChainTier
 */

/**
 * Determine the chain tier for a restaurant.
 *
 * Priority:
 * 1. Explicit `chainTier` field from input data (if provided)
 * 2. Lookup in CHAINS.knownChains by normalized name
 * 3. Default to 'independent'
 *
 * @param {string} name
 * @param {ChainTier} [explicitTier] — from input data if available
 * @returns {ChainTier}
 */
function detectChainTier(name, explicitTier) {
  if (explicitTier && CHAINS.tierPenalties[explicitTier] != null) {
    return explicitTier;
  }

  if (!name) return 'independent';
  const normalized = name.toLowerCase().replace(/['']/g, "'").trim();
  return CHAINS.knownChains.get(normalized) || 'independent';
}

/**
 * Get the penalty multiplier for a chain tier.
 * @param {ChainTier} tier
 * @returns {number} — multiplier (0.55–1.0)
 */
function chainPenalty(tier) {
  return CHAINS.tierPenalties[tier] ?? 1.0;
}

// ── Display score mapping ────────────────────────────────────────────
/**
 * Piecewise linear mapping from raw finalScore (0–1) to display score.
 *
 * Uses explicit breakpoints from config so each band boundary is
 * precisely controlled:
 *   weak:   58–72  (finalScore 0.00–0.35)
 *   decent: 73–82  (finalScore 0.35–0.55)
 *   strong: 83–89  (finalScore 0.55–0.75)
 *   elite:  90–96  (finalScore 0.75–1.00)
 *
 * Tradeoff: piecewise is more explicit than a single power curve,
 * but requires manual tuning of breakpoints. Worth it because
 * the old power curve clustered too many restaurants in 85–92.
 *
 * @param {number} finalScore — 0–1 composite after all adjustments
 * @returns {number} integer in [minDisplay, maxDisplay]
 */
function toDisplayScore(finalScore) {
  const bp = PRESENTATION.breakpoints;
  const clamped = Math.max(0, Math.min(1, finalScore));

  // Find the segment this score falls into
  for (let i = 0; i < bp.length - 1; i++) {
    const [rawLow, dispLow] = bp[i];
    const [rawHigh, dispHigh] = bp[i + 1];
    if (clamped >= rawLow && clamped <= rawHigh) {
      const t = (rawHigh - rawLow) > 0
        ? (clamped - rawLow) / (rawHigh - rawLow)
        : 0;
      return Math.round(dispLow + t * (dispHigh - dispLow));
    }
  }

  // Fallback (shouldn't happen with well-formed breakpoints)
  return PRESENTATION.maxDisplay;
}

module.exports = {
  qualityScore,
  popularityScore,
  distanceScore,
  confidenceScore,
  detectChainTier,
  chainPenalty,
  toDisplayScore,
};
