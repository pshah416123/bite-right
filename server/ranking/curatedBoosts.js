/**
 * Curated neighborhood boosts.
 *
 * This module lets you seed "local favorite" restaurants per neighborhood.
 * When a Google Places result matches a curated entry, it gets a controlled
 * score boost — making the feed feel like a smart local recommendation
 * rather than a raw API dump.
 *
 * Design:
 * - Exact match on normalized name is tried first (fast, reliable).
 * - Fuzzy match is used as fallback for name variations ("Birriería Zaragoza"
 *   vs "Birrieria Zaragoza", "S.K.Y." vs "SKY Restaurant").
 * - Boost is gated on quality score: a 2-star curated restaurant won't
 *   magically become #1.
 *
 * Curated tiers:
 *   icon           — true neighborhood landmark (Birrieria Zaragoza, Carnitas Uruapan)
 *   local_favorite — regulars' pick, strong reputation (Dusek's, 5 Rabanitos)
 *   trendy         — currently buzzy, may not be a long-term staple
 *   editorial      — notable for press/concept, not yet proven by locals
 *
 * To add a new neighborhood: add an entry to CURATED_NEIGHBORHOODS below.
 */

const { CURATION } = require('./config');

// tierBonus values are in config.js CURATION.tierBonus

/**
 * @typedef {'icon'|'local_favorite'|'trendy'|'editorial'} CuratedTier
 */

/**
 * @typedef {Object} CuratedEntry
 * @property {string} name — canonical name (will be normalized for matching)
 * @property {string[]} [aliases] — alternate names / spellings
 * @property {CuratedTier} tier — controls boost magnitude and reason text
 * @property {string} [knownFor] — used in recommendation reasons ("Known for birria")
 * @property {string[]} [tags] — subcategory tags for diversity tracking
 */

/**
 * @typedef {Object} NeighborhoodConfig
 * @property {string} displayName — human-readable name
 * @property {string[]} matchNames — names/aliases for matching (lowercase)
 * @property {{ lat: number, lng: number }} center — rough center for proximity check
 * @property {number} radiusMiles — how far from center counts as "in" this neighborhood
 * @property {CuratedEntry[]} curated — seeded restaurant list
 */

/** @type {Record<string, NeighborhoodConfig>} */
const CURATED_NEIGHBORHOODS = {
  pilsen: {
    displayName: 'Pilsen',
    matchNames: ['pilsen', 'pilsen chicago', 'lower west side'],
    center: { lat: 41.8523, lng: -87.6564 },
    radiusMiles: 1.5,
    curated: [
      // ── Icons: true neighborhood landmarks ──
      {
        name: 'Birrieria Zaragoza',
        aliases: ['birriería zaragoza', 'zaragoza birrieria', 'birrieria de zaragoza'],
        tier: 'icon',
        knownFor: 'birria',
        tags: ['birria', 'mexican', 'tacos'],
      },
      {
        name: 'Carnitas Uruapan',
        aliases: ['uruapan', 'carnitas uruapan restaurant'],
        tier: 'icon',
        knownFor: 'carnitas',
        tags: ['carnitas', 'mexican', 'casual'],
      },
      {
        name: 'Mi Tocaya Antojería',
        aliases: ['mi tocaya', 'mi tocaya antojeria', 'tocaya'],
        tier: 'icon',
        knownFor: 'modern Mexican',
        tags: ['mexican', 'modern mexican', 'date night'],
      },
      {
        name: 'S.K.Y.',
        aliases: ['sky', 'sky restaurant', 's.k.y. restaurant'],
        tier: 'icon',
        knownFor: 'inventive Asian-American tasting menus',
        tags: ['asian fusion', 'fine dining', 'tasting menu'],
      },

      // ── Local favorites: regulars' picks ──
      {
        name: 'Dusek\'s Board & Beer',
        aliases: ['duseks', 'dusek\'s', 'duseks board and beer'],
        tier: 'local_favorite',
        knownFor: 'elevated pub food',
        tags: ['american', 'gastropub', 'craft beer'],
      },
      {
        name: '5 Rabanitos',
        aliases: ['cinco rabanitos', '5 rabanitos restaurante'],
        tier: 'local_favorite',
        knownFor: 'Oaxacan cuisine',
        tags: ['oaxacan', 'mexican', 'mole'],
      },
      {
        name: 'Honky Tonk BBQ',
        aliases: ['honky tonk', 'honkytonk bbq'],
        tier: 'local_favorite',
        knownFor: 'BBQ and live music',
        tags: ['bbq', 'american', 'live music'],
      },
      {
        name: 'Taquería El Milagro',
        aliases: ['el milagro', 'taqueria el milagro', 'el milagro taqueria'],
        tier: 'local_favorite',
        knownFor: 'street tacos',
        tags: ['tacos', 'mexican', 'casual'],
      },
      {
        name: 'Don Pedro Carnitas',
        aliases: ['don pedro', 'don pedro\'s'],
        tier: 'local_favorite',
        knownFor: 'carnitas',
        tags: ['carnitas', 'mexican', 'casual'],
      },

      // ── Trendy: currently buzzy spots ──
      {
        name: 'Pl-zen',
        aliases: ['plzen', 'pl-zen restaurant'],
        tier: 'trendy',
        knownFor: 'creative Pan-Asian plates',
        tags: ['asian fusion', 'cocktails', 'date night'],
      },

      // ── Editorial: notable but not yet proven by locals ──
      {
        name: 'La Vaca Margarita',
        aliases: ['vaca margarita'],
        tier: 'editorial',
        knownFor: 'tacos and margaritas',
        tags: ['tacos', 'mexican', 'margaritas'],
      },
      {
        name: 'Panaderías (various)',
        aliases: [],
        tier: 'editorial',
        knownFor: 'Mexican bakery',
        tags: ['bakery', 'mexican', 'pastry'],
      },
    ],
  },

  // ── Add more neighborhoods here ──────────────────────────────────
  // Example skeleton:
  // wicker_park: {
  //   displayName: 'Wicker Park',
  //   matchNames: ['wicker park', 'wicker park chicago'],
  //   center: { lat: 41.9088, lng: -87.6796 },
  //   radiusMiles: 1.0,
  //   curated: [
  //     { name: 'Big Star', tier: 'icon', knownFor: 'tacos and whiskey', tags: ['tacos', 'bar'] },
  //     { name: 'Piece Brewery', tier: 'local_favorite', knownFor: 'pizza and craft beer', tags: ['pizza', 'brewery'] },
  //   ],
  // },
};

// ── Name normalization ───────────────────────────────────────────────

/**
 * Normalize a restaurant name for matching.
 * Strips accents, punctuation, extra spaces, and lowercases.
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')   // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Fuzzy matching ───────────────────────────────────────────────────

/**
 * Simple bigram similarity (Dice coefficient).
 * Fast, no dependencies, good enough for restaurant name matching.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1 similarity
 */
function bigramSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bi = a.slice(i, i + 2);
    bigramsA.set(bi, (bigramsA.get(bi) || 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bi = b.slice(i, i + 2);
    const count = bigramsA.get(bi) || 0;
    if (count > 0) {
      matches++;
      bigramsA.set(bi, count - 1);
    }
  }

  return (2 * matches) / (a.length - 1 + b.length - 1);
}

/**
 * Check if `candidateName` contains a curated name as a substring.
 * Handles cases like "Carnitas Uruapan Restaurant & Grocery" matching "Carnitas Uruapan".
 */
function containsMatch(candidateNorm, curatedNorm) {
  return candidateNorm.includes(curatedNorm) || curatedNorm.includes(candidateNorm);
}

// ── Tier → additive bonus ────────────────────────────────────────────

/**
 * Get the additive bonus for a curated tier.
 * @param {CuratedTier} tier
 * @returns {number} 0–0.13
 */
function tierToBonus(tier) {
  return CURATION.tierBonus[tier] ?? 0;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Find the best matching curated entry for a restaurant name
 * within a specific neighborhood.
 *
 * @param {string} restaurantName
 * @param {string} neighborhoodKey — key into CURATED_NEIGHBORHOODS
 * @returns {{ entry: CuratedEntry, boost: number, matchType: 'exact'|'alias'|'fuzzy'|'contains' } | null}
 */
function findCuratedMatch(restaurantName, neighborhoodKey) {
  const config = CURATED_NEIGHBORHOODS[neighborhoodKey];
  if (!config) return null;

  const candidateNorm = normalizeName(restaurantName);
  if (!candidateNorm) return null;

  for (const entry of config.curated) {
    const entryNorm = normalizeName(entry.name);

    // 1. Exact match
    if (candidateNorm === entryNorm) {
      return { entry, boost: tierToBonus(entry.tier), matchType: 'exact' };
    }

    // 2. Alias exact match
    for (const alias of (entry.aliases || [])) {
      if (candidateNorm === normalizeName(alias)) {
        return { entry, boost: tierToBonus(entry.tier), matchType: 'alias' };
      }
    }

    // 3. Substring containment (handles "Carnitas Uruapan Restaurant & Grocery")
    if (entryNorm.length >= 5 && containsMatch(candidateNorm, entryNorm)) {
      return { entry, boost: tierToBonus(entry.tier), matchType: 'contains' };
    }
    for (const alias of (entry.aliases || [])) {
      const aliasNorm = normalizeName(alias);
      if (aliasNorm.length >= 5 && containsMatch(candidateNorm, aliasNorm)) {
        return { entry, boost: tierToBonus(entry.tier), matchType: 'contains' };
      }
    }

    // 4. Fuzzy match
    const allNames = [entryNorm, ...(entry.aliases || []).map(normalizeName)];
    for (const name of allNames) {
      const sim = bigramSimilarity(candidateNorm, name);
      if (sim >= CURATION.fuzzyThreshold) {
        // Slight discount for fuzzy matches (80% of tier bonus)
        return { entry, boost: tierToBonus(entry.tier) * 0.8, matchType: 'fuzzy' };
      }
    }
  }

  return null;
}

/**
 * Detect which neighborhood a coordinate is in.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {string|null} — neighborhood key or null
 */
function detectNeighborhood(lat, lng) {
  for (const [key, config] of Object.entries(CURATED_NEIGHBORHOODS)) {
    const dLat = (lat - config.center.lat) * 69.0; // rough miles per degree lat
    const dLng = (lng - config.center.lng) * 69.0 * Math.cos(config.center.lat * Math.PI / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist <= config.radiusMiles) return key;
  }
  return null;
}

/**
 * Detect neighborhood from a location query string.
 *
 * @param {string} query — e.g. "Pilsen", "Pilsen Chicago", "Lower West Side"
 * @returns {string|null} — neighborhood key or null
 */
function detectNeighborhoodFromQuery(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();
  for (const [key, config] of Object.entries(CURATED_NEIGHBORHOODS)) {
    for (const name of config.matchNames) {
      if (q.includes(name) || name.includes(q)) return key;
    }
  }
  return null;
}

/**
 * Get the display name for a neighborhood key.
 * @param {string} key
 * @returns {string|null}
 */
function getNeighborhoodDisplayName(key) {
  return CURATED_NEIGHBORHOODS[key]?.displayName ?? null;
}

module.exports = {
  CURATED_NEIGHBORHOODS,
  normalizeName,
  bigramSimilarity,
  findCuratedMatch,
  detectNeighborhood,
  detectNeighborhoodFromQuery,
  getNeighborhoodDisplayName,
  tierToBonus,
};
