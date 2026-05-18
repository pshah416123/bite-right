/**
 * Ranking pipeline configuration.
 *
 * Score concepts:
 *   organicScore  — weighted sum of quality, popularity, distance, confidence (0–1)
 *   baseScore     — organicScore + curated additive bonus (capped at 1)
 *   finalScore    — baseScore after chain penalty (0–1)
 *   displayScore  — user-facing integer mapped from finalScore to [58, 96]
 */

// ── Organic score weights (must sum to 1.0) ──────────────────────────
// These cover the "data-driven" part of the score. Curation is applied
// as an additive bonus afterward so it can reliably lift curated
// restaurants without being diluted by the weight budget.
const SCORE_WEIGHTS = {
  quality:    0.40,  // Bayesian-adjusted rating
  popularity: 0.30,  // log-scaled review count
  distance:   0.16,  // exponential proximity decay
  confidence: 0.14,  // data completeness / metadata richness
};

// ── Quality scoring ──────────────────────────────────────────────────
const QUALITY = {
  goodThreshold: 3.8,
  floor: 3.0,
  priorRating: 3.8,
  priorWeight: 10,
};

// ── Popularity scoring ───────────────────────────────────────────────
const POPULARITY = {
  midpoint: 150,
  saturation: 2000,
  minReviews: 5,
};

// ── Distance scoring ─────────────────────────────────────────────────
const DISTANCE = {
  walkable: 0.3,
  halfLife: 1.5,
  maxUseful: 10,
};

// ── Curation: additive bonus ─────────────────────────────────────────
/**
 * Curation is now an ADDITIVE bonus applied after the organic weighted sum.
 * This means an "icon" restaurant gets +0.13 to its organic score, which
 * is enough to reliably jump 2–4 positions without being diluted by the
 * weight budget.
 *
 * The bonus is quality-gated: restaurants below qualityGate get a reduced
 * bonus proportional to their quality score.
 *
 * Tier descriptions:
 *   icon           — true neighborhood landmark (Birrieria Zaragoza)
 *   local_favorite — regulars' pick (Dusek's)
 *   trendy         — currently buzzy
 *   editorial      — press-notable, not yet proven by locals
 */
const CURATION = {
  /** Minimum quality score to receive full bonus. Below this, bonus is scaled down. */
  qualityGate: 0.35,
  /** Fuzzy match threshold for name matching. */
  fuzzyThreshold: 0.75,
  /** Additive bonus per tier (added directly to organicScore, capped at 1). */
  tierBonus: {
    icon:           0.13,
    local_favorite: 0.08,
    trendy:         0.04,
    editorial:      0.02,
  },
};

// ── Diversity reranking ──────────────────────────────────────────────
const DIVERSITY = {
  window: 15,
  cuisinePenalty: 0.15,
  subcategoryPenalty: 0.10,
  pricePenalty: 0.03,
  maxSameCuisine: 3,
};

// ── Display score presentation ───────────────────────────────────────
/**
 * Target bands:
 *   weak:   58–70  (finalScore 0.00–0.35)   — chains, low-rated, sparse data
 *   decent: 71–79  (finalScore 0.35–0.55)   — average restaurants
 *   strong: 80–88  (finalScore 0.55–0.78)   — good restaurants, curated local_favorites
 *   elite:  89–96  (finalScore 0.78–1.00)   — only 2–3 per feed: icons, exceptional quality+popularity
 *
 * Key change from v2: the strong band is wider (80–88 instead of 83–89)
 * and the elite threshold is higher (0.78 instead of 0.75), so fewer
 * restaurants break into 90+.
 */
const PRESENTATION = {
  minDisplay: 58,
  maxDisplay: 96,
  breakpoints: [
    [0.00, 58],   // absolute floor
    [0.20, 64],   // weak
    [0.35, 70],   // weak → decent boundary
    [0.55, 79],   // decent → strong boundary
    [0.78, 88],   // strong → elite boundary
    [1.00, 96],   // elite ceiling
  ],
};

// ── Section weight profiles ──────────────────────────────────────────
/**
 * Different sections use different weight profiles so "Trending" and
 * "Top Picks" feel meaningfully different.
 *
 * These override SCORE_WEIGHTS for section-specific re-scoring.
 * Each must sum to 1.0.
 */
const SECTION_PROFILES = {
  /** Default: balanced mix (used for topPicksForYou + allNearby). */
  default: SCORE_WEIGHTS,

  /** Top Rated: leans harder on quality + curation, less on popularity/distance. */
  top_rated: {
    quality:    0.48,
    popularity: 0.22,
    distance:   0.14,
    confidence: 0.16,
  },

  /** Trending: leans harder on popularity + recency, less on quality. */
  trending: {
    quality:    0.28,
    popularity: 0.45,
    distance:   0.14,
    confidence: 0.13,
  },
};

// ── Chain detection ──────────────────────────────────────────────────
const CHAINS = {
  tierPenalties: {
    major_fast_food:  0.55,
    regional_chain:   0.78,
    small_local_chain: 0.90,
    independent:      1.00,
  },

  knownChains: new Map([
    ...['mcdonalds', "mcdonald's", 'burger king', "wendy's", 'wendys',
      'subway', 'taco bell', 'chipotle', 'chick-fil-a', 'chickfila',
      'popeyes', "popeye's", 'kfc', 'panda express', "domino's", 'dominos',
      'pizza hut', "papa john's", 'papa johns', 'sonic', "jack in the box",
      'wingstop', "raising cane's", 'raising canes',
      "denny's", 'dennys', 'ihop', 'dunkin', "dunkin'", 'starbucks',
    ].map(n => [n, 'major_fast_food']),

    ...['five guys', 'shake shack', 'panera', 'panera bread',
      "chili's", 'chilis', "applebee's", 'applebees', 'olive garden',
      'red lobster', 'buffalo wild wings', 'bww', 'cheesecake factory',
      "nando's", 'nandos', 'cracker barrel', "bob evans",
      'texas roadhouse', 'outback steakhouse',
    ].map(n => [n, 'regional_chain']),

    ...['sweetgreen', 'cava', 'portillos', "portillo's",
      "lou malnati's", 'lou malnatis', "giordano's", 'giordanos',
    ].map(n => [n, 'small_local_chain']),
  ]),
};

module.exports = {
  SCORE_WEIGHTS,
  QUALITY,
  POPULARITY,
  DISTANCE,
  CURATION,
  DIVERSITY,
  PRESENTATION,
  SECTION_PROFILES,
  CHAINS,
};
