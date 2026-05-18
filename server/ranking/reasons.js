/**
 * Recommendation reason + hero signal + card tag generators.
 *
 * Three outputs per restaurant:
 *   reason    — ONE strong explanation string (shown as badge or first tag)
 *   heroLabel — ONE standout label for the card ("Pilsen staple", "Hidden gem")
 *   cardTags  — 1–2 short cuisine/subcategory tags ("Tacos", "Birria")
 *
 * All are deterministic: same inputs → same outputs.
 */

const { SCORE_WEIGHTS } = require('./config');

/**
 * @typedef {Object} SignalInput
 * @property {number} qualityScore
 * @property {number} popularityScore
 * @property {number} distanceScore
 * @property {number} confidenceScore
 * @property {number} curationBonus     — additive curation bonus applied (0–0.13)
 * @property {number} displayScore      — final display % (58–96)
 * @property {number|null} rating
 * @property {number|null} reviewCount
 * @property {number|null} priceLevel
 * @property {number} distanceMiles
 * @property {string|null} cuisine
 * @property {string|null} neighborhood
 * @property {string|null} neighborhoodKey
 * @property {{ entry: import('./curatedBoosts').CuratedEntry, boost: number, matchType: string }|null} curatedMatch
 * @property {string} chainTier
 */

// ── Dominant factor detection ────────────────────────────────────────

function rankFactors(input) {
  const factors = [
    { factor: 'quality',    contribution: SCORE_WEIGHTS.quality * input.qualityScore },
    { factor: 'popularity', contribution: SCORE_WEIGHTS.popularity * input.popularityScore },
    { factor: 'distance',   contribution: SCORE_WEIGHTS.distance * input.distanceScore },
    { factor: 'confidence', contribution: SCORE_WEIGHTS.confidence * input.confidenceScore },
  ];
  // Curation is additive, but include it for factor ranking
  if (input.curationBonus > 0) {
    factors.push({ factor: 'curation', contribution: input.curationBonus });
  }
  factors.sort((a, b) => b.contribution - a.contribution);
  return factors;
}

// ── Reason generator (ONE string) ────────────────────────────────────

/**
 * Generate ONE strong recommendation reason.
 *
 * For curated restaurants: always leads with the curated signal.
 * For non-curated: uses the dominant scoring factor.
 *
 * @param {SignalInput} input
 * @returns {string}
 */
function generateReason(input) {
  const hood = input.neighborhood || null;
  const isIndependent = input.chainTier === 'independent' || input.chainTier === 'small_local_chain';

  // Curated restaurants: curated signal always wins
  if (input.curatedMatch && isIndependent) {
    const tier = input.curatedMatch.entry.tier;
    const knownFor = input.curatedMatch.entry?.knownFor;
    if (tier === 'icon') {
      return knownFor ? `Known for ${knownFor}` : (hood ? `${hood} favorite` : 'Local favorite');
    }
    if (tier === 'local_favorite') {
      return knownFor ? `Known for ${knownFor}` : (hood ? `Popular in ${hood}` : 'Local favorite');
    }
    if (tier === 'trendy') {
      return hood ? `Trending in ${hood}` : 'Trending pick';
    }
    // editorial
    return knownFor ? `Known for ${knownFor}` : (hood ? `Notable in ${hood}` : 'Notable pick');
  }

  // Non-curated: dominant factor
  const factors = rankFactors(input);
  const dominant = factors[0].factor;

  switch (dominant) {
    case 'quality':
      if (input.rating >= 4.5 && (input.reviewCount ?? 0) >= 500) {
        return hood ? `Loved in ${hood}` : 'People keep coming back';
      }
      if (input.rating >= 4.5 && (input.reviewCount ?? 0) >= 100) {
        return hood ? `${hood} gem` : 'Consistently great';
      }
      if (input.rating >= 4.3 && (input.reviewCount ?? 0) >= 500) {
        return 'Crowd favorite';
      }
      return hood ? `Solid pick in ${hood}` : 'Solid pick nearby';

    case 'popularity':
      if ((input.reviewCount ?? 0) >= 1000) return 'Everyone goes here';
      if ((input.reviewCount ?? 0) >= 300) return 'Popular for a reason';
      return hood ? `Well-known in ${hood}` : 'Worth a look';

    case 'distance':
      if (input.distanceMiles <= 0.3) return 'Steps away';
      if (input.distanceMiles <= 0.8 && input.qualityScore >= 0.5) return 'Great spot nearby';
      return 'Nearby find';

    default:
      // Value signal as tiebreaker
      if (input.priceLevel != null && input.priceLevel <= 2 && input.qualityScore >= 0.6) {
        return 'Great value nearby';
      }
      return input.displayScore >= 80 ? 'Worth trying' : 'Nearby find';
  }
}

// ── Hero label generator ─────────────────────────────────────────────

/**
 * Generate ONE standout label for the card.
 *
 * The hero label is the single most distinctive thing about this restaurant.
 * It's meant to catch the eye and differentiate the card at a glance.
 * Returns null for unremarkable restaurants (chains, low scores).
 *
 * @param {SignalInput} input
 * @returns {string|null}
 */
function generateHeroLabel(input) {
  const hood = input.neighborhood || null;
  const isIndependent = input.chainTier === 'independent' || input.chainTier === 'small_local_chain';

  // Chains never get a hero label
  if (!isIndependent) return null;

  // Curated icons → neighborhood staple
  if (input.curatedMatch) {
    const tier = input.curatedMatch.entry.tier;
    const knownFor = input.curatedMatch.entry?.knownFor;

    if (tier === 'icon') {
      return hood ? `${hood} staple` : 'Neighborhood staple';
    }
    if (tier === 'local_favorite') {
      // "Best for X" if we know what they're known for
      if (knownFor) return `Best for ${knownFor}`;
      return 'Local favorite';
    }
    if (tier === 'trendy') return 'Trending now';
    if (tier === 'editorial') return 'Worth trying';
  }

  // Hidden gem: high quality, low review count → not well-known yet
  if (input.qualityScore >= 0.65 && (input.reviewCount ?? 0) < 150 && (input.reviewCount ?? 0) >= 10) {
    return 'Hidden gem';
  }

  // Top rated: exceptional quality + popularity
  if (input.rating >= 4.5 && (input.reviewCount ?? 0) >= 500) {
    return 'Top rated';
  }

  // Great value: good quality, budget price
  if (input.qualityScore >= 0.6 && input.priceLevel != null && input.priceLevel <= 1) {
    return 'Great value';
  }

  // Walking distance + good quality
  if (input.distanceMiles <= 0.3 && input.qualityScore >= 0.55) {
    return 'Right around the corner';
  }

  // Decent but nothing distinctive
  if (input.displayScore >= 82) return 'Recommended';

  return null;
}

// ── Card tag generator ───────────────────────────────────────────────

/**
 * Generate 1–2 short cuisine/subcategory tags for display on the card.
 *
 * Priority:
 * 1. Curated entry tags (most specific: "Birria", "Oaxacan")
 * 2. Cuisine string subcategories ("Mexican · Tacos" → "Tacos")
 * 3. Primary cuisine as fallback
 *
 * @param {SignalInput} input
 * @returns {string[]} — 1–2 capitalized short tags
 */
function generateCardTags(input) {
  const tags = [];
  const seen = new Set();

  function add(raw) {
    if (!raw) return;
    const clean = raw.trim();
    if (!clean || clean.length > 16) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    // Skip overly generic tags
    if (['restaurant', 'food', 'takeout', 'casual', 'unknown'].includes(key)) return;
    seen.add(key);
    // Capitalize first letter
    tags.push(clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase());
  }

  // 1. Curated tags (most specific)
  if (input.curatedMatch?.entry?.tags) {
    for (const t of input.curatedMatch.entry.tags) {
      if (tags.length >= 2) break;
      add(t);
    }
  }

  // 2. Cuisine subcategories
  if (tags.length < 2 && input.cuisine) {
    const parts = input.cuisine.split(/[·•|,/–-]/).map(s => s.trim()).filter(Boolean);
    // Subcategories first (more specific), then primary
    for (let i = 1; i < parts.length && tags.length < 2; i++) {
      add(parts[i]);
    }
    if (tags.length < 2 && parts[0]) {
      add(parts[0]);
    }
  }

  return tags.slice(0, 2);
}

// ── Legacy compatibility ─────────────────────────────────────────────

/**
 * Generate explanations array (1–2 strings) for backward compatibility.
 * First element is the reason, second is the "Known for X" if available.
 *
 * @param {SignalInput} input
 * @returns {string[]}
 */
function generateExplanations(input) {
  const reason = generateReason(input);
  const explanations = [reason];

  // Add "Known for X" as secondary if not already in the reason
  if (input.curatedMatch?.entry?.knownFor) {
    const knownFor = `Known for ${input.curatedMatch.entry.knownFor}`;
    if (reason !== knownFor && !reason.includes(input.curatedMatch.entry.knownFor)) {
      explanations.push(knownFor);
    }
  }

  return explanations.slice(0, 2);
}

module.exports = {
  generateReason,
  generateHeroLabel,
  generateCardTags,
  generateExplanations,
  rankFactors,
};
