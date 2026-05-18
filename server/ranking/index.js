/**
 * Ranking module — public API.
 *
 * Usage:
 *   const { rankPlaces, rankForSection } = require('./ranking');
 *   const ranked = rankPlaces(places, { lat, lng }, { locationQuery: 'Pilsen' });
 *   const trending = rankForSection(ranked, 'trending').slice(0, 8);
 */

const { rankPlaces, rankForSection } = require('./pipeline');
const { detectNeighborhood, detectNeighborhoodFromQuery, CURATED_NEIGHBORHOODS } = require('./curatedBoosts');
const { diversityRerank } = require('./diversity');
const { generateReason, generateHeroLabel, generateCardTags, generateExplanations, rankFactors } = require('./reasons');
const { qualityScore, popularityScore, distanceScore, confidenceScore, toDisplayScore, detectChainTier, chainPenalty } = require('./scoring');
const { SCORE_WEIGHTS, DIVERSITY, PRESENTATION, CURATION, CHAINS, SECTION_PROFILES } = require('./config');

module.exports = {
  rankPlaces,
  rankForSection,

  detectNeighborhood,
  detectNeighborhoodFromQuery,
  CURATED_NEIGHBORHOODS,

  diversityRerank,
  generateReason,
  generateHeroLabel,
  generateCardTags,
  generateExplanations,
  rankFactors,
  qualityScore,
  popularityScore,
  distanceScore,
  confidenceScore,
  toDisplayScore,
  detectChainTier,
  chainPenalty,

  SCORE_WEIGHTS,
  DIVERSITY,
  PRESENTATION,
  CURATION,
  CHAINS,
  SECTION_PROFILES,
};
