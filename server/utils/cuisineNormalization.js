/**
 * Cuisine normalization layer.
 *
 * Provides a config-driven taxonomy that maps raw provider labels, subcategories,
 * and name keywords into canonical cuisine groups. Supports parent → child rollup
 * so "tacos" matches "Mexican", "pizza" matches both "Pizza" and "Italian", etc.
 *
 * Usage:
 *   const { normalizeCuisineLabel, getCuisineGroups, matchesCuisineGroup } = require('./cuisineNormalization');
 *   normalizeCuisineLabel('taqueria')           // → 'Mexican'
 *   getCuisineGroups(['pizza_restaurant'], 'Pizzeria Uno', 'Pizza')
 *     // → ['Pizza', 'Italian']
 *   matchesCuisineGroup(['Pizza'], 'Italian')   // → true  (Pizza is a child of Italian)
 */

// ── Taxonomy ────────────────────────────────────────────────────────────
// Each top-level key is a canonical cuisine group.
//   children  — labels that roll up into this group (selected chip "Italian" matches "Pizza")
//   aliases   — raw strings (lowercased) that normalize TO this label
//   keywords  — additional regex-testable tokens found in restaurant names

const CUISINE_TAXONOMY = {
  Mexican: {
    children: [],
    aliases: [
      'mexican', 'tacos', 'taco', 'taqueria', 'birria', 'birrieria', 'carnitas',
      'tamales', 'tamale', 'enchilada', 'enchiladas', 'burrito', 'burritos',
      'elote', 'churro', 'churros', 'mole', 'pozole', 'torta', 'tortas',
      'quesadilla', 'gordita', 'huarache', 'tlayuda', 'mezcal', 'cantina',
    ],
    keywords: /\b(?:taco|taqueria|birria|birrieria|carnitas|tamale|enchilada|burrito|elote|churro|mole|pozole|torta|cantina|mezcal|mexican)\b/i,
  },
  Italian: {
    children: ['Pizza'],
    aliases: [
      'italian', 'trattoria', 'osteria', 'ristorante', 'risotto',
      'calzone', 'focaccia', 'parmigiana', 'antipasto',
    ],
    keywords: /\b(?:italian|trattoria|osteria|ristorante|risotto|calzone|focaccia|parmigiana)\b/i,
  },
  Pizza: {
    children: [],
    aliases: ['pizza', 'pizzeria', 'deep dish', 'neapolitan', 'sicilian slice'],
    keywords: /\b(?:pizza|pizzeria|deep\s?dish|neapolitan)\b/i,
    parents: ['Italian'],
  },
  American: {
    children: ['Burgers', 'BBQ', 'Brunch', 'Breakfast'],
    aliases: [
      'american', 'diner', 'grill', 'wings', 'cornbread',
      'sandwich', 'sandwich shop', 'sub shop', 'po boy',
    ],
    keywords: /\b(?:american|diner|grill(?:e)?|wings|cornbread|sandwich)\b/i,
  },
  Burgers: {
    children: [],
    aliases: ['burger', 'burgers', 'hamburger', 'smash burger', 'slider'],
    keywords: /\b(?:burger|hamburger|smash\s?burger|slider)\b/i,
    parents: ['American'],
  },
  BBQ: {
    children: [],
    aliases: ['bbq', 'barbecue', 'smokehouse', 'brisket', 'pulled pork', 'ribs', 'smoked'],
    keywords: /\b(?:bbq|barbecue|smokehouse|brisket|ribs|pulled\s?pork|smoked)\b/i,
    parents: ['American'],
  },
  Brunch: {
    children: [],
    aliases: ['brunch', 'mimosa'],
    keywords: /\b(?:brunch|mimosa)\b/i,
    parents: ['American'],
  },
  Breakfast: {
    children: [],
    aliases: ['breakfast', 'pancake', 'waffle', 'omelette'],
    keywords: /\b(?:breakfast|pancake|waffle|omelette|eggs\s?benedict)\b/i,
    parents: ['American'],
  },
  Japanese: {
    children: ['Sushi', 'Ramen'],
    aliases: [
      'japanese', 'izakaya', 'tempura', 'udon', 'soba',
      'omakase', 'teriyaki', 'yakitori', 'tonkatsu', 'matcha',
    ],
    keywords: /\b(?:japanese|izakaya|tempura|udon|soba|omakase|teriyaki|yakitori|tonkatsu|matcha)\b/i,
  },
  Sushi: {
    children: [],
    aliases: ['sushi', 'sashimi', 'nigiri', 'maki', 'chirashi'],
    keywords: /\b(?:sushi|sashimi|nigiri|maki|chirashi)\b/i,
    parents: ['Japanese'],
  },
  Ramen: {
    children: [],
    aliases: ['ramen', 'tonkotsu', 'shoyu', 'miso ramen'],
    keywords: /\b(?:ramen|tonkotsu|shoyu)\b/i,
    parents: ['Japanese'],
  },
  Chinese: {
    children: [],
    aliases: [
      'chinese', 'dim sum', 'dumpling', 'wonton', 'szechuan', 'sichuan',
      'cantonese', 'chow mein', 'kung pao', 'peking', 'hot pot',
    ],
    keywords: /\b(?:chinese|dim\s?sum|dumpling|wonton|szechuan|sichuan|cantonese|chow\s?mein|kung\s?pao|peking|hot\s?pot)\b/i,
  },
  Thai: {
    children: [],
    aliases: ['thai', 'pad thai', 'tom yum', 'satay', 'som tum', 'green curry'],
    keywords: /\b(?:thai|pad\s?thai|tom\s?yum|satay|som\s?tum)\b/i,
  },
  Korean: {
    children: [],
    aliases: ['korean', 'kimchi', 'korean bbq', 'kbbq', 'bibimbap', 'bulgogi', 'japchae', 'tteokbokki'],
    keywords: /\b(?:korean|kimchi|kbbq|bibimbap|bulgogi|japchae|tteokbokki)\b/i,
  },
  Indian: {
    children: [],
    aliases: [
      'indian', 'curry', 'biryani', 'tandoor', 'tandoori', 'chai',
      'nihari', 'desi', 'punjabi', 'gujarati', 'masala', 'naan',
      'dosa', 'tikka', 'samosa',
    ],
    keywords: /\b(?:indian|curry|biryani|tandoor|chai|nihari|desi|punjabi|masala|naan|dosa|tikka|samosa)\b/i,
  },
  Vietnamese: {
    children: [],
    aliases: ['vietnamese', 'pho', 'banh mi', 'bun', 'spring roll', 'vermicelli'],
    keywords: /\b(?:vietnamese|pho|banh\s?mi|bun\b|vermicelli)\b/i,
    parents: ['Asian'],
  },
  Asian: {
    children: ['Chinese', 'Thai', 'Vietnamese', 'Korean', 'Japanese'],
    aliases: ['asian', 'pan-asian', 'pan asian', 'asian fusion', 'fusion'],
    keywords: /\b(?:asian|pan[- ]?asian|fusion)\b/i,
  },
  Mediterranean: {
    children: ['Greek'],
    aliases: ['mediterranean', 'hummus', 'pita', 'tahini'],
    keywords: /\b(?:mediterranean|hummus|pita|tahini)\b/i,
  },
  Greek: {
    children: [],
    aliases: ['greek', 'gyro', 'souvlaki', 'moussaka', 'spanakopita'],
    keywords: /\b(?:greek|gyro|souvlaki|moussaka|spanakopita)\b/i,
    parents: ['Mediterranean'],
  },
  French: {
    children: [],
    aliases: ['french', 'bistro', 'brasserie', 'crepe', 'patisserie', 'croissant', 'boulangerie'],
    keywords: /\b(?:french|bistro|brasserie|crepe|patisserie|croissant|boulangerie)\b/i,
  },
  'Middle Eastern': {
    children: [],
    aliases: ['middle eastern', 'lebanese', 'turkish', 'persian', 'shawarma', 'kebab', 'falafel', 'meze'],
    keywords: /\b(?:middle\s?eastern|lebanese|turkish|persian|shawarma|kebab|falafel|meze)\b/i,
  },
  Seafood: {
    children: [],
    aliases: ['seafood', 'oyster', 'fish', 'lobster', 'crab', 'shrimp', 'clam', 'poke'],
    keywords: /\b(?:seafood|oyster bar|fish|lobster|crab\s?house|shrimp|clam|poke)\b/i,
  },
  Steakhouse: {
    children: [],
    aliases: ['steakhouse', 'steak house', 'chophouse', 'prime rib', 'wagyu'],
    keywords: /\b(?:steakhouse|steak\s?house|chophouse|prime\s?rib|wagyu)\b/i,
  },
  Coffee: {
    children: [],
    aliases: ['coffee', 'cafe', 'espresso', 'espresso bar', 'roast', 'latte', 'cappuccino', 'barista', 'bakery cafe'],
    keywords: /\b(?:coffee|cafe|espresso|roast(?:er)?|latte|cappuccino|barista)\b/i,
  },
  Dessert: {
    children: ['Bakery'],
    aliases: ['dessert', 'gelato', 'ice cream', 'boba', 'frozen yogurt', 'cupcake', 'donut', 'sweets'],
    keywords: /\b(?:dessert|gelato|ice\s?cream|boba|frozen\s?yogurt|cupcake|donut|sweets)\b/i,
  },
  Bakery: {
    children: [],
    aliases: ['bakery', 'bread', 'pastry', 'scone', 'patisserie'],
    keywords: /\b(?:bakery|bread|pastry|scone)\b/i,
    parents: ['Dessert'],
  },
  Vegan: {
    children: [],
    aliases: ['vegan', 'plant-based', 'plant based'],
    keywords: /\b(?:vegan|plant[- ]?based)\b/i,
  },
  Vegetarian: {
    children: [],
    aliases: ['vegetarian', 'veggie'],
    keywords: /\b(?:vegetarian|veggie)\b/i,
  },
};

// ── Pre-built lookup tables (computed once at require-time) ─────────────

// alias string → canonical label  (e.g. "taqueria" → "Mexican")
const _aliasToLabel = new Map();
for (const [label, def] of Object.entries(CUISINE_TAXONOMY)) {
  for (const alias of def.aliases) {
    _aliasToLabel.set(alias.toLowerCase(), label);
  }
  // The label itself is also an alias
  _aliasToLabel.set(label.toLowerCase(), label);
}

// canonical label → Set of all labels that should match when this chip is selected
// (includes self + children, recursively)
const _chipMatchSets = {};
function _collectDescendants(label, visited = new Set()) {
  if (visited.has(label)) return [];
  visited.add(label);
  const def = CUISINE_TAXONOMY[label];
  if (!def) return [label];
  const result = [label];
  for (const child of (def.children || [])) {
    result.push(..._collectDescendants(child, visited));
  }
  return result;
}
for (const label of Object.keys(CUISINE_TAXONOMY)) {
  _chipMatchSets[label] = new Set(_collectDescendants(label));
}

// canonical label → Set of parent groups (e.g. "Pizza" → {"Italian"})
const _parentGroups = {};
for (const [label, def] of Object.entries(CUISINE_TAXONOMY)) {
  _parentGroups[label] = new Set(def.parents || []);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Normalize a single raw cuisine string to its canonical label.
 * Returns the canonical label or the original string if no match.
 *
 * @param {string} raw — e.g. "taqueria", "Pizza", "birria", "pan-asian"
 * @returns {string} — canonical label, e.g. "Mexican", "Pizza", "Asian"
 */
function normalizeCuisineLabel(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const lower = raw.trim().toLowerCase();
  if (_aliasToLabel.has(lower)) return _aliasToLabel.get(lower);

  // Partial match: check if any alias is a substring of the input
  for (const [alias, label] of _aliasToLabel) {
    if (alias.length >= 3 && lower.includes(alias)) return label;
  }
  return raw.trim();
}

/**
 * Derive all cuisine groups for a restaurant from its provider types, name, and hints.
 * Returns direct matches AND their parent groups.
 *
 * @param {string[]} types — Google Place types  (e.g. ['mexican_restaurant', 'restaurant'])
 * @param {string} name — restaurant name
 * @param {string} [cuisineHint] — existing cuisine label if known
 * @returns {string[]} — e.g. ['Mexican'] or ['Pizza', 'Italian']
 */
function getCuisineGroups(types, name, cuisineHint) {
  const labels = new Set();
  const text = `${name || ''} ${cuisineHint || ''}`;

  // 1) Check Google types against taxonomy aliases
  const typeSet = new Set(Array.isArray(types) ? types : []);
  for (const [label, def] of Object.entries(CUISINE_TAXONOMY)) {
    for (const alias of def.aliases) {
      // Match against Google type keys (e.g. "mexican_restaurant" contains "mexican")
      for (const t of typeSet) {
        if (t.includes(alias.replace(/\s+/g, '_'))) {
          labels.add(label);
        }
      }
    }
  }

  // 2) Match restaurant name + cuisine hint against taxonomy keywords
  for (const [label, def] of Object.entries(CUISINE_TAXONOMY)) {
    if (def.keywords && def.keywords.test(text)) {
      labels.add(label);
    }
  }

  // 3) Normalize the cuisineHint itself
  if (cuisineHint) {
    const normalized = normalizeCuisineLabel(cuisineHint);
    if (normalized && CUISINE_TAXONOMY[normalized]) {
      labels.add(normalized);
    }
  }

  // 4) Add parent groups for every matched label
  const withParents = new Set(labels);
  for (const label of labels) {
    const parents = _parentGroups[label];
    if (parents) {
      for (const p of parents) withParents.add(p);
    }
  }

  return Array.from(withParents);
}

/**
 * Check whether a set of derived cuisine labels matches a selected cuisine chip.
 * Uses the taxonomy's parent-child relationships for broad matching:
 *   chip "Italian" matches a restaurant labeled ["Pizza"]
 *   chip "American" matches a restaurant labeled ["BBQ"]
 *   chip "Asian" matches a restaurant labeled ["Vietnamese"]
 *
 * @param {string[]} derivedLabels — from getCuisineGroups or deriveCuisinesFromPlace
 * @param {string} selectedChip — the user-selected cuisine filter
 * @param {string} [name] — restaurant name (fallback keyword match)
 * @param {string} [cuisineHint] — existing cuisine label
 * @returns {boolean}
 */
function matchesCuisineGroup(derivedLabels, selectedChip, name, cuisineHint) {
  if (!selectedChip || !selectedChip.trim()) return true;
  const chip = selectedChip.trim();

  // Get the full set of labels this chip accepts (self + all descendants)
  const acceptSet = _chipMatchSets[chip];
  if (!acceptSet) {
    // Unknown chip: fall back to exact match
    return derivedLabels.some((l) => l.toLowerCase() === chip.toLowerCase());
  }

  // Check if any derived label is in the accept set
  if (derivedLabels.some((l) => acceptSet.has(l))) return true;

  // Also check if any derived label is a PARENT of the chip
  // e.g. derivedLabels=["Italian"], chip="Pizza" → Italian includes Pizza as child → match
  const chipParents = _parentGroups[chip];
  if (chipParents && derivedLabels.some((l) => chipParents.has(l))) return true;

  // Fallback: keyword match against restaurant name
  const text = `${name || ''} ${cuisineHint || ''}`;
  const chipDef = CUISINE_TAXONOMY[chip];
  if (chipDef?.keywords && chipDef.keywords.test(text)) return true;

  // Check children keywords too
  if (acceptSet) {
    for (const childLabel of acceptSet) {
      const childDef = CUISINE_TAXONOMY[childLabel];
      if (childDef?.keywords && childDef.keywords.test(text)) return true;
    }
  }

  return false;
}

/**
 * Get the parent groups for a canonical cuisine label.
 * @param {string} label — e.g. "Pizza"
 * @returns {string[]} — e.g. ["Italian"]
 */
function getParentGroups(label) {
  return Array.from(_parentGroups[label] || []);
}

/**
 * Get all child labels for a canonical cuisine group.
 * @param {string} label — e.g. "Italian"
 * @returns {string[]} — e.g. ["Pizza"]
 */
function getChildLabels(label) {
  const def = CUISINE_TAXONOMY[label];
  return def ? [...(def.children || [])] : [];
}

module.exports = {
  CUISINE_TAXONOMY,
  normalizeCuisineLabel,
  getCuisineGroups,
  matchesCuisineGroup,
  getParentGroups,
  getChildLabels,
};
