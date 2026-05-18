/**
 * Centralized cuisine matching utilities.
 *
 * Single source of truth for keyword maps, chip lists, and matching logic
 * used by Discover, Tonight, and any future screens that filter by cuisine.
 */

// ─── Keyword map ────────────────────────────────────────────────────────────────
// Each cuisine label maps to an array of lowercase keywords checked against
// restaurant name, cuisine text, description, and category/tag fields.

export const CUISINE_KEYWORD_MAP: Record<string, string[]> = {
  Italian: ['italian', 'pizza', 'pasta', 'trattoria', 'osteria', 'ristorante', 'gelato', 'risotto', 'calzone', 'focaccia'],
  Mexican: ['mexican', 'taco', 'burrito', 'cantina', 'taqueria', 'enchilada', 'quesadilla', 'tamale', 'elote', 'churro'],
  Chinese: ['chinese', 'dim sum', 'dumpling', 'wonton', 'szechuan', 'sichuan', 'cantonese', 'chow mein', 'kung pao', 'peking'],
  Indian: ['indian', 'curry', 'biryani', 'tandoor', 'chai', 'nihari', 'desi', 'punjabi', 'gujarati', 'masala', 'naan', 'dosa', 'tikka', 'samosa'],
  Japanese: ['japanese', 'sushi', 'ramen', 'izakaya', 'tempura', 'udon', 'soba', 'omakase', 'teriyaki', 'yakitori', 'tonkatsu', 'matcha'],
  Thai: ['thai', 'pad thai', 'tom yum', 'green curry', 'satay', 'som tum', 'basil chicken'],
  Korean: ['korean', 'kimchi', 'korean bbq', 'bibimbap', 'bulgogi', 'japchae', 'tteokbokki', 'kbbq'],
  Mediterranean: ['mediterranean', 'hummus', 'pita', 'tahini', 'shawarma', 'kebab', 'gyro'],
  Greek: ['greek', 'gyro', 'souvlaki', 'moussaka', 'spanakopita', 'baklava'],
  French: ['french', 'bistro', 'brasserie', 'crepe', 'patisserie', 'croissant', 'boulangerie'],
  'Middle Eastern': ['middle eastern', 'lebanese', 'turkish', 'persian', 'shawarma', 'kebab', 'falafel', 'hookah', 'meze'],
  American: ['american', 'diner', 'grill', 'wings', 'mac and cheese', 'cornbread'],
  Asian: ['asian', 'pan-asian', 'pan asian', 'fusion'],
  Steakhouse: ['steakhouse', 'steak house', 'chophouse', 'prime rib', 'wagyu'],
  Seafood: ['seafood', 'oyster', 'fish', 'lobster', 'crab', 'shrimp', 'clam', 'poke'],
  Sushi: ['sushi', 'omakase', 'sashimi', 'nigiri', 'maki'],
  Pizza: ['pizza', 'pizzeria', 'deep dish', 'neapolitan'],
  Burgers: ['burger', 'hamburger', 'smash burger', 'shake shack'],
  BBQ: ['bbq', 'barbecue', 'smokehouse', 'brisket', 'ribs', 'pulled pork', 'smoked'],
  Dessert: ['dessert', 'gelato', 'ice cream', 'boba', 'frozen yogurt', 'cupcake', 'donut', 'candy', 'sweets'],
  Breakfast: ['breakfast', 'pancake', 'waffle', 'omelette', 'eggs benedict'],
  Brunch: ['brunch', 'mimosa', 'eggs benedict', 'benedict'],
  Vegetarian: ['vegetarian', 'veggie'],
  Vegan: ['vegan', 'plant-based', 'plant based'],
  Bakery: ['bakery', 'boulangerie', 'bread', 'pastry', 'croissant', 'scone'],
  Coffee: ['coffee', 'cafe', 'espresso', 'roast', 'latte', 'cappuccino', 'barista'],
};

// Pre-compiled regexes for each cuisine (built once at module load).
const CUISINE_REGEX_MAP: Record<string, RegExp> = {};
for (const [label, keywords] of Object.entries(CUISINE_KEYWORD_MAP)) {
  // Escape special regex chars, join with | , wrap in word boundary.
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  CUISINE_REGEX_MAP[label] = new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

// ─── Chip lists ─────────────────────────────────────────────────────────────────

export const FOOD_CHIP_ALLOWLIST = new Set(Object.keys(CUISINE_KEYWORD_MAP));

export const DEFAULT_FOOD_CHIPS = [
  'Italian',
  'Mexican',
  'American',
  'Mediterranean',
  'Asian',
  'Indian',
  'Seafood',
  'Sushi',
  'Thai',
  'Chinese',
  'Greek',
  'French',
  'Middle Eastern',
  'BBQ',
  'Burgers',
  'Pizza',
  'Dessert',
  'Breakfast',
  'Vegetarian',
  'Steakhouse',
];

// ─── Related-cuisine groups (for filter expansion) ──────────────────────────────

const RELATED_CUISINES: Record<string, string[]> = {
  Italian: ['Italian', 'Pizza'],
  Japanese: ['Japanese', 'Sushi'],
  American: ['American', 'Burgers', 'BBQ', 'Brunch'],
  Dessert: ['Dessert', 'Bakery', 'Coffee'],
  Vegan: ['Vegan', 'Vegetarian'],
  Vegetarian: ['Vegetarian', 'Vegan'],
};

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Extract the primary cuisine label from a compound string.
 * e.g. "Sushi · Omakase" → "Sushi"
 */
export function extractCuisineLabel(cuisine: string): string {
  const raw = (cuisine || '').trim();
  if (!raw) return '';
  return raw.split(/[·•]/)[0]?.trim() || raw;
}

/**
 * Infer all matching cuisine labels for a restaurant by checking its name,
 * cuisine text, and any other descriptive fields against the keyword map.
 *
 * @param texts - One or more strings to match against (name, cuisine, description, tags…).
 *                Falsy values are silently ignored.
 * @returns Array of matched cuisine labels (e.g. ["Indian", "Vegetarian"]).
 */
export function inferCuisineLabels(...texts: (string | null | undefined)[]): string[] {
  const combined = texts.filter(Boolean).join(' ');
  if (!combined.trim()) return [];

  const out: string[] = [];
  for (const [label, re] of Object.entries(CUISINE_REGEX_MAP)) {
    if (re.test(combined)) out.push(label);
  }

  // Bakery places should also carry Dessert intent.
  if (out.includes('Bakery') && !out.includes('Dessert')) out.push('Dessert');

  return out;
}

/**
 * Check whether a restaurant matches a selected cuisine chip.
 *
 * @param derivedLabels - The cuisine labels derived for this restaurant
 *                        (from backend `cuisines` array or `inferCuisineLabels`).
 * @param selectedChip  - The currently selected cuisine filter (e.g. "Indian").
 *                        Returns `true` when no chip is selected.
 */
export function matchesCuisineFilter(
  derivedLabels: string[],
  selectedChip: string | null | undefined,
): boolean {
  if (!selectedChip?.trim()) return true;
  const chip = selectedChip.trim();
  const want = new Set([chip, ...(RELATED_CUISINES[chip] || [])]);
  return derivedLabels.some((l) => want.has(l));
}

// ─── DiscoverItem helper ────────────────────────────────────────────────────────
// Convenience wrapper matching the shape used in discover.tsx / RestaurantCard.

export interface CuisineMatchableItem {
  restaurant: {
    name: string;
    cuisine?: string;
    cuisines?: string[];
  };
}

/**
 * Get the effective cuisine labels for a restaurant item.
 * Prefers the backend-provided `cuisines` array; falls back to inference.
 */
export function getDerivedCuisines(item: CuisineMatchableItem): string[] {
  const existing = Array.isArray(item.restaurant.cuisines) ? item.restaurant.cuisines : [];
  if (existing.length > 0) return existing;
  return inferCuisineLabels(item.restaurant.name, item.restaurant.cuisine);
}
