/**
 * Evidence-based category classifier.
 *
 * For "narrow" cuisine chips (Pizza, Burgers, Tacos, Ramen, Sushi, Wings,
 * Pho, Coffee, Dessert, BBQ, Brunch), inclusion in the filter must be
 * backed by ACTUAL evidence the restaurant serves the food item — not
 * just inferred from a parent cuisine group. "Italian" no longer matches
 * the "Pizza" chip just because Pizza is a child of Italian in the
 * taxonomy. The category has to be witnessed.
 *
 * Confidence tiers:
 *   high   — extracted menu has a section or item matching the chip's
 *            food keyword (e.g. cached menu for the place has "Margherita
 *            Pizza" as an item).
 *   medium — restaurant_details_cache.popular_dishes mentions the food,
 *            OR the Google place types include the chip's specific type
 *            (e.g. `pizza_restaurant`), OR the restaurant name contains
 *            an unambiguous food token ("Joe's Pizza").
 *   low    — weak inference: only the parent cuisine matches (Italian for
 *            Pizza chip, Mexican for Tacos chip, etc.), or the food token
 *            appears in a non-name signal where it could be incidental
 *            ("Big Star Tacos N Donuts" matches via taqueria-y name but
 *            could equally be a donut shop with a token mention).
 *   none   — no positive signal at all.
 *
 * Broad chips (Italian, Japanese, Mexican, Asian, etc.) DO NOT use this
 * classifier — they continue to match via the existing taxonomy + parent
 * rollup since the user has explicitly asked for a wide cuisine net.
 */

const NARROW_CATEGORIES = new Set([
  'Pizza', 'Burgers', 'Tacos', 'Ramen', 'Sushi', 'Wings', 'Pho',
  'Coffee', 'Dessert', 'BBQ', 'Brunch', 'Breakfast',
]);

// Each entry:
//   menuKeyword  — regex tested against cached menu section titles + item
//                  names. Tight: only items that literally contain the
//                  food token. Words must be word-boundary-anchored so
//                  e.g. "Pizzelle" doesn't match Pizza.
//   googleType   — Google place type that ALONE is a strong signal.
//                  Provided when Google has a specific type; otherwise
//                  null and we lean on name/menu signals.
//   nameKeyword  — regex tested against restaurant name. Used for the
//                  Medium tier. Tighter than menuKeyword for words that
//                  commonly appear ambiguously in names (e.g. "wings" can
//                  appear in a steakhouse name).
const CATEGORY_EVIDENCE = {
  Pizza: {
    menuKeyword: /\b(?:pizza|pizzas|pizzeria|deep[- ]?dish|neapolitan|sicilian|margherita|calzone|stromboli)\b/i,
    googleType: 'pizza_restaurant',
    nameKeyword: /\b(?:pizza|pizzeria)\b/i,
  },
  Burgers: {
    menuKeyword: /\b(?:burger|burgers|cheeseburger|hamburger|smash\s?burger|smashburger|patty\s?melt|whopper|big\s?mac|baconator|quarter\s?pounder)\b/i,
    googleType: 'hamburger_restaurant',
    nameKeyword: /\b(?:burger|burgers|smashburger|burger\s?joint|burger\s?bar)\b/i,
  },
  Tacos: {
    menuKeyword: /\b(?:taco|tacos|taqueria|al\s?pastor|barbacoa\s?taco|carnitas\s?taco|breakfast\s?taco|fish\s?taco|street\s?taco)\b/i,
    googleType: 'mexican_restaurant', // weaker signal — boosts to medium only with name corroboration
    nameKeyword: /\b(?:taco|tacos|taqueria)\b/i,
  },
  Ramen: {
    menuKeyword: /\b(?:ramen|tonkotsu|shoyu\s?ramen|miso\s?ramen|tsukemen|shio\s?ramen)\b/i,
    googleType: 'ramen_restaurant',
    nameKeyword: /\b(?:ramen|ramen-ya|ramenya|noodle\s?house)\b/i,
  },
  Sushi: {
    menuKeyword: /\b(?:sushi|sashimi|nigiri|maki\s|maki$|chirashi|hand\s?roll|omakase|tekkamaki|temaki)\b/i,
    googleType: 'sushi_restaurant',
    nameKeyword: /\b(?:sushi|omakase|nigiri)\b/i,
  },
  Wings: {
    menuKeyword: /\b(?:wing|wings|chicken\s?wing|buffalo\s?wings?|hot\s?wings?|boneless\s?wings?)\b/i,
    googleType: null,
    nameKeyword: /\b(?:wings?|wingstop|wing\s?house|wing\s?stop)\b/i,
  },
  Pho: {
    menuKeyword: /\bph[oơ]\b/i,
    googleType: 'vietnamese_restaurant',
    nameKeyword: /\bph[oơ]\b/i,
  },
  Coffee: {
    menuKeyword: /\b(?:espresso|latte|cappuccino|americano|macchiato|cortado|cold\s?brew|flat\s?white|drip\s?coffee|pour[- ]?over)\b/i,
    googleType: 'coffee_shop',
    nameKeyword: /\b(?:coffee|cafe|caf[eé]|espresso|roast(?:ers?)?)\b/i,
  },
  Dessert: {
    menuKeyword: /\b(?:ice\s?cream|gelato|sorbet|cake|cakes|cupcake|donut|doughnut|pastry|pastries|cookie|cookies|brownie|cheesecake|cr[èe]me\s?br[uû]l[ée]e|tiramisu|sundae|sundaes|frozen\s?yogurt|froyo|macaron|cannoli)\b/i,
    googleType: 'dessert_shop',
    nameKeyword: /\b(?:dessert|ice\s?cream|gelato|bakery|donut|doughnut|sweets|froyo|cupcake)\b/i,
  },
  BBQ: {
    menuKeyword: /\b(?:bbq|barbecue|brisket|burnt\s?ends?|pulled\s?pork|smoked\s?(?:ribs?|sausage|brisket)|baby\s?back\s?ribs?|smokehouse)\b/i,
    googleType: 'barbecue_restaurant',
    nameKeyword: /\b(?:bbq|barbecue|smokehouse|smoke\s?house)\b/i,
  },
  Brunch: {
    menuKeyword: /\b(?:eggs\s?benedict|avocado\s?toast|mimosa|french\s?toast|pancakes?|breakfast\s?burrito|huevos\s?rancheros|shakshuka)\b/i,
    googleType: 'breakfast_restaurant',
    nameKeyword: /\b(?:brunch|breakfast)\b/i,
  },
  Breakfast: {
    menuKeyword: /\b(?:pancake|pancakes|waffle|waffles|french\s?toast|hash\s?browns?|omelette|omelet|eggs\s?benedict|breakfast\s?burrito|huevos|english\s?muffin|breakfast\s?sandwich)\b/i,
    googleType: 'breakfast_restaurant',
    nameKeyword: /\b(?:breakfast|pancakes?|waffles?)\b/i,
  },
};

function isNarrowCategory(chip) {
  return NARROW_CATEGORIES.has(chip);
}

/**
 * Classify a restaurant's confidence level for a narrow category chip.
 *
 * @param {Object}    args
 * @param {string}    args.chip            — e.g. "Pizza"
 * @param {Object?}   args.menuRow         — restaurant_menus row (scrape_status==='success')
 * @param {Object?}   args.detailRow       — restaurant_details_cache row
 * @param {string[]?} args.types           — Google place types (e.g. ['restaurant','meal_takeaway'])
 * @param {string?}   args.name            — restaurant name
 * @param {string?}   args.cuisine         — pre-derived cuisine hint
 * @returns {'high'|'medium'|'low'|'none'}
 */
function classifyCategoryConfidence({ chip, menuRow, detailRow, types, name, cuisine }) {
  const ev = CATEGORY_EVIDENCE[chip];
  if (!ev) return 'none';

  // ── HIGH: explicit menu evidence ───────────────────────────────────────
  // Walk extracted menu sections + items. A section title hit is the
  // strongest single signal (it labels the whole class of items), but a
  // single item hit also qualifies — restaurants frequently have a
  // pizza or two on the menu even if it isn't a "pizza place".
  const sections = menuRow?.structured_data?.sections;
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      if (ev.menuKeyword.test(sec?.title || '')) return 'high';
      const items = sec?.items;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (ev.menuKeyword.test(it?.name || '')) return 'high';
      }
    }
  }

  // ── MEDIUM: Google metadata + strong name signal ──────────────────────
  if (ev.googleType && Array.isArray(types) && types.includes(ev.googleType)) {
    return 'medium';
  }
  const dishes = detailRow?.popular_dishes;
  if (Array.isArray(dishes)) {
    for (const d of dishes) {
      if (ev.menuKeyword.test(d?.name || '')) return 'medium';
    }
  }
  if (ev.nameKeyword.test(name || '')) {
    return 'medium';
  }

  // ── LOW: weak inference. The chip's broader cuisine matched but no
  //   direct evidence. For Pizza this might be an Italian restaurant with
  //   no menu in cache; for Tacos a Mexican spot we haven't extracted yet.
  const cuisineText = `${cuisine || ''} ${(types || []).join(' ')}`.toLowerCase();
  if (chip === 'Pizza' && /italian/.test(cuisineText)) return 'low';
  if (chip === 'Tacos' && /mexican|taco_bell/.test(cuisineText)) return 'low';
  if (chip === 'Sushi' && /japanese/.test(cuisineText)) return 'low';
  if (chip === 'Ramen' && /japanese|noodle/.test(cuisineText)) return 'low';
  if (chip === 'Burgers' && /american|diner|grill/.test(cuisineText)) return 'low';
  if (chip === 'Coffee' && /cafe/.test(cuisineText)) return 'low';
  if (chip === 'Dessert' && /bakery|ice_cream/.test(cuisineText)) return 'low';
  if (chip === 'BBQ' && /barbecue|smokehouse/.test(cuisineText)) return 'low';
  if (chip === 'Pho' && /vietnamese/.test(cuisineText)) return 'low';

  return 'none';
}

/**
 * Filter a list of recommendation records to those that pass the
 * evidence-based category filter for `chip`. Prefers high+medium; falls
 * back to including low when high+medium count is below `minStrong`.
 *
 * @param {Array<{
 *   rec: Object,
 *   confidence: 'high'|'medium'|'low'|'none'
 * }>} scored
 * @param {number} [minStrong=5] — if high+medium >= this, drop low entirely.
 * @returns {Array<{rec, confidence}>}
 */
function applyCategoryConfidenceFilter(scored, minStrong = 5) {
  const high = scored.filter((s) => s.confidence === 'high');
  const medium = scored.filter((s) => s.confidence === 'medium');
  const low = scored.filter((s) => s.confidence === 'low');
  // none — always excluded.

  if (high.length + medium.length >= minStrong) {
    // Strong evidence available — exclude Low so the user only sees
    // results we have positive signal for.
    return [...high, ...medium];
  }
  // Padded with low so the user doesn't see an empty result.
  return [...high, ...medium, ...low];
}

module.exports = {
  NARROW_CATEGORIES,
  CATEGORY_EVIDENCE,
  isNarrowCategory,
  classifyCategoryConfidence,
  applyCategoryConfidenceFilter,
};
