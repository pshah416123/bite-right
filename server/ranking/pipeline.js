/**
 * Ranking pipeline orchestrator.
 *
 * Pipeline:  raw places → organic score → additive curation → chain penalty → sort → diversify → monotonic display → reasons + hero + tags
 *
 * Score concepts:
 *   organicScore  — weighted sum of quality, popularity, distance, confidence (0–1)
 *   baseScore     — organicScore + curated additive bonus, capped at 1
 *   finalScore    — baseScore × chain penalty (0–1)
 *   displayScore  — user-facing integer via piecewise breakpoints (58–96), monotonically non-increasing
 *
 * Section-specific ranking:
 *   rankPlaces() returns a flat ranked list. The caller (server/index.js)
 *   can call rankForSection() to re-score with different weight profiles
 *   for "Trending" vs "Top Rated" sections.
 */

const { SCORE_WEIGHTS, CURATION, SECTION_PROFILES } = require('./config');
const { qualityScore, popularityScore, distanceScore, confidenceScore, detectChainTier, chainPenalty, toDisplayScore } = require('./scoring');
const { findCuratedMatch, detectNeighborhood, detectNeighborhoodFromQuery, getNeighborhoodDisplayName } = require('./curatedBoosts');
const { diversityRerank } = require('./diversity');
const { generateExplanations, generateHeroLabel, generateCardTags } = require('./reasons');

/**
 * Haversine distance in miles.
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute the organic score for a place using a specific weight profile.
 * @param {{ quality: number, popularity: number, distance: number, confidence: number }} components
 * @param {typeof SCORE_WEIGHTS} [weights]
 * @returns {number} 0–1
 */
function organicScore(components, weights = SCORE_WEIGHTS) {
  return (
    weights.quality * components.quality +
    weights.popularity * components.popularity +
    weights.distance * components.distance +
    weights.confidence * components.confidence
  );
}

/**
 * @typedef {Object} RankedResult
 * @property {string} name
 * @property {string} address
 * @property {string|null} neighborhood
 * @property {string} cuisine
 * @property {number} priceLevel
 * @property {number} percentMatch     — displayScore (58–96)
 * @property {string[]} explanations   — 1–2 reason strings
 * @property {string|null} heroLabel   — standout card label
 * @property {string[]} cardTags       — 1–2 short cuisine tags
 * @property {number} distance
 * @property {boolean} inRadius
 * @property {boolean} similarTasteSignal
 * @property {string[]} [tags]
 * @property {string|null} [curatedKnownFor]
 * @property {number} _baseScore
 * @property {number} _finalScore
 */

/**
 * Run the full ranking pipeline on a list of Google Places results.
 *
 * @param {Array<Object>} places — raw places from Google
 * @param {{ lat: number, lng: number }} userLocation
 * @param {object} [opts]
 * @param {string} [opts.locationQuery]
 * @param {number} [opts.radiusMiles]
 * @returns {RankedResult[]}
 */
function rankPlaces(places, userLocation, opts = {}) {
  const { locationQuery, radiusMiles = 10 } = opts;

  // ── Detect neighborhood ─────────────────────────────────────────
  const neighborhoodKey =
    detectNeighborhoodFromQuery(locationQuery) ??
    detectNeighborhood(userLocation.lat, userLocation.lng);

  const neighborhoodDisplayName = neighborhoodKey
    ? getNeighborhoodDisplayName(neighborhoodKey)
    : null;

  // ── Score each place ────────────────────────────────────────────
  const scored = places.map((place) => {
    const dist = (place.lat != null && place.lng != null)
      ? haversine(userLocation.lat, userLocation.lng, place.lat, place.lng)
      : 0;

    const qScore = qualityScore(place.rating, place.userRatingsTotal);
    const pScore = popularityScore(place.userRatingsTotal);
    const dScore = distanceScore(dist);
    const cScore = confidenceScore({
      rating: place.rating,
      reviewCount: place.userRatingsTotal,
      priceLevel: place.priceLevel,
      hasPhoto: !!(place.photos && place.photos.length > 0),
    });

    const components = { quality: qScore, popularity: pScore, distance: dScore, confidence: cScore };

    // Organic score (data-driven, no curation)
    const organic = Math.max(0, Math.min(1, organicScore(components)));

    // Curated additive bonus
    const curatedMatch = neighborhoodKey
      ? findCuratedMatch(place.name, neighborhoodKey)
      : null;

    let curationBonus = 0;
    if (curatedMatch) {
      // Quality gate: scale bonus down if quality is below threshold
      const qualityGate = Math.min(1, qScore / CURATION.qualityGate);
      curationBonus = curatedMatch.boost * qualityGate;
    }

    // baseScore = organic + curation bonus
    const baseScore = Math.max(0, Math.min(1, organic + curationBonus));

    // Chain penalty → finalScore
    const chainTier = detectChainTier(place.name, place.chainTier);
    const finalScore = Math.max(0, Math.min(1, baseScore * chainPenalty(chainTier)));

    const placeNeighborhood = place.address
      ? String(place.address).split(',')[0].trim()
      : null;

    const cuisine = place.cuisine || '';

    return {
      _placeInput: place,
      name: place.name,
      address: place.address || '',
      neighborhood: neighborhoodDisplayName || placeNeighborhood,
      cuisine,
      types: place.types || [],
      priceLevel: place.priceLevel ?? 2,
      distance: dist,
      inRadius: dist <= radiusMiles,
      similarTasteSignal: false,
      tags: curatedMatch?.entry?.tags || [],
      curatedKnownFor: curatedMatch?.entry?.knownFor || null,

      baseScore,
      finalScore,

      _scoring: {
        quality: qScore,
        popularity: pScore,
        distance: dScore,
        confidence: cScore,
        curationBonus,
        curatedMatch,
        chainTier,
        neighborhoodKey,
      },
    };
  });

  // ── Sort by finalScore descending ───────────────────────────────
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // ── Diversity rerank ────────────────────────────────────────────
  const diversified = diversityRerank(scored);

  // ── Monotonic displayScores ─────────────────────────────────────
  let ceiling = Infinity;
  const withDisplay = diversified.map((r) => {
    let displayScore = toDisplayScore(r.finalScore);
    displayScore = Math.min(displayScore, ceiling);
    ceiling = displayScore;
    return { ...r, displayScore };
  });

  // ── Generate reasons, hero labels, card tags ────────────────────
  const results = withDisplay.map((r) => {
    const s = r._scoring;

    const signalInput = {
      qualityScore: s.quality,
      popularityScore: s.popularity,
      distanceScore: s.distance,
      confidenceScore: s.confidence,
      curationBonus: s.curationBonus,
      displayScore: r.displayScore,
      rating: r._placeInput.rating,
      reviewCount: r._placeInput.userRatingsTotal,
      priceLevel: r.priceLevel,
      distanceMiles: r.distance,
      cuisine: r.cuisine,
      neighborhood: r.neighborhood,
      neighborhoodKey: s.neighborhoodKey,
      curatedMatch: s.curatedMatch,
      chainTier: s.chainTier,
    };

    const explanations = generateExplanations(signalInput);
    const heroLabel = generateHeroLabel(signalInput);
    const cardTags = generateCardTags(signalInput);

    return {
      name: r.name,
      address: r.address,
      neighborhood: r.neighborhood,
      cuisine: r.cuisine,
      types: r.types,
      priceLevel: r.priceLevel,
      percentMatch: r.displayScore,
      explanations,
      heroLabel,
      cardTags,
      distance: r.distance,
      inRadius: r.inRadius,
      similarTasteSignal: r.similarTasteSignal,
      tags: r.tags,
      curatedKnownFor: r.curatedKnownFor,
      _baseScore: r.baseScore,
      _finalScore: r.finalScore,
      _scoring: r._scoring,
    };
  });

  return results;
}

/**
 * Re-rank a list of already-scored results using a different weight profile.
 * Used to create differentiated sections (e.g. "Trending" vs "Top Rated").
 *
 * This re-computes organicScore with the new weights, re-adds curation bonus,
 * re-applies chain penalty, and re-sorts. It does NOT re-run diversity.
 *
 * @param {Array<Object>} scoredPlaces — output from rankPlaces (with _scoring)
 * @param {'default'|'top_rated'|'trending'} profileName
 * @returns {Array<Object>} — re-sorted with updated percentMatch
 */
function rankForSection(scoredPlaces, profileName) {
  const weights = SECTION_PROFILES[profileName] || SECTION_PROFILES.default;

  const resorted = scoredPlaces.map((r) => {
    const s = r._scoring || {};
    const components = {
      quality: s.quality ?? 0,
      popularity: s.popularity ?? 0,
      distance: s.distance ?? 0,
      confidence: s.confidence ?? 0,
    };

    const organic = Math.max(0, Math.min(1, organicScore(components, weights)));
    const sectionBase = Math.max(0, Math.min(1, organic + (s.curationBonus ?? 0)));
    const sectionFinal = Math.max(0, Math.min(1, sectionBase * chainPenalty(s.chainTier ?? 'independent')));
    const displayScore = toDisplayScore(sectionFinal);

    return {
      ...r,
      percentMatch: displayScore,
      _sectionScore: sectionFinal,
    };
  });

  resorted.sort((a, b) => b._sectionScore - a._sectionScore);

  // Enforce monotonic display scores after section re-sort
  let sectionCeiling = Infinity;
  for (const r of resorted) {
    r.percentMatch = Math.min(r.percentMatch, sectionCeiling);
    sectionCeiling = r.percentMatch;
  }

  return resorted;
}

module.exports = { rankPlaces, rankForSection, haversine };
