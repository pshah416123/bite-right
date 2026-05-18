import type { ItemTags } from "../parsers/types.js";

// ─── Dietary tag detection ───────────────────────────────────

const VEG_RE =
  /\b(vegetarian|veggie|meatless|plant.?based)\b/i;

const VEGAN_RE =
  /\b(vegan|plant.?based|dairy.?free)\b/i;

const SPICY_RE =
  /\b(spicy|hot|jalape[nñ]o|habanero|sriracha|chili|chilli|cayenne|ghost pepper|thai hot|extra hot|buffalo|fire)\b/i;

const GF_RE =
  /\b(gluten.?free|celiac|gf\b)/i;

export function detectTags(text: string): ItemTags {
  return {
    isVeg: VEG_RE.test(text),
    isVegan: VEGAN_RE.test(text),
    isSpicy: SPICY_RE.test(text),
    isGlutenFree: GF_RE.test(text),
  };
}

// ─── Cuisine inference ───────────────────────────────────────

interface CuisinePattern {
  label: string;
  re: RegExp;
  weight: number;
}

const CUISINE_PATTERNS: CuisinePattern[] = [
  { label: "Japanese",   re: /\b(sushi|sashimi|ramen|udon|tempura|teriyaki|miso|edamame|gyoza|tonkotsu|omakase|yakitori|donburi|matcha)\b/gi, weight: 1 },
  { label: "Italian",    re: /\b(pasta|pizza|risotto|gnocchi|bruschetta|tiramisu|parmigiana|carbonara|bolognese|lasagna|ravioli|prosciutto|antipasti?)\b/gi, weight: 1 },
  { label: "Mexican",    re: /\b(taco|burrito|enchilada|quesadilla|guacamole|salsa|churro|tamale|tortilla|mole|elote|pozole|ceviche)\b/gi, weight: 1 },
  { label: "Chinese",    re: /\b(dim sum|dumpling|wonton|kung pao|lo mein|chow mein|fried rice|mapo tofu|peking|szechuan|sichuan|bao)\b/gi, weight: 1 },
  { label: "Indian",     re: /\b(curry|tikka|masala|naan|biryani|samosa|tandoori|paneer|dal|chutney|vindaloo|korma|dosa|idli)\b/gi, weight: 1 },
  { label: "Thai",       re: /\b(pad thai|tom yum|green curry|red curry|satay|som tum|larb|basil fried|massaman|panang)\b/gi, weight: 1 },
  { label: "Korean",     re: /\b(kimchi|bibimbap|bulgogi|galbi|japchae|tteokbokki|soju|gochujang|banchan|kimbap)\b/gi, weight: 1 },
  { label: "Mediterranean", re: /\b(hummus|falafel|shawarma|pita|tahini|tzatziki|halloumi|baba ganoush|fattoush|dolma|kebab)\b/gi, weight: 1 },
  { label: "French",     re: /\b(croissant|cr[eè]me|souffl[eé]|confit|ratatouille|bouillabaisse|b[eé]arnaise|tartar[e]?|foie gras|baguette)\b/gi, weight: 1 },
  { label: "American",   re: /\b(burger|hot dog|bbq|barbecu|mac.?and.?cheese|pulled pork|brisket|coleslaw|cornbread|wings|fries)\b/gi, weight: 0.5 },
  { label: "Seafood",    re: /\b(lobster|crab|shrimp|oyster|clam|mussel|scallop|fish.?and.?chips|ceviche|ahi tuna|salmon)\b/gi, weight: 0.8 },
  { label: "Steakhouse", re: /\b(ribeye|filet mignon|new york strip|porterhouse|wagyu|prime rib|bone.?in|dry.?aged|tomahawk)\b/gi, weight: 0.8 },
  { label: "Pizza",      re: /\b(pizza|deep dish|neapolitan|margherita|calzone|stromboli|thin crust)\b/gi, weight: 0.8 },
  { label: "BBQ",        re: /\b(brisket|pulled pork|ribs|smoked|smoker|bbq|barbecu|cornbread|burnt ends)\b/gi, weight: 0.8 },
];

/**
 * Infer the primary cuisine from menu text using keyword frequency.
 * Returns the top cuisine label or null if no signal.
 */
export function inferCuisine(menuText: string): string | null {
  const scores = new Map<string, number>();

  for (const pattern of CUISINE_PATTERNS) {
    const matches = menuText.match(pattern.re);
    if (matches && matches.length > 0) {
      const current = scores.get(pattern.label) ?? 0;
      scores.set(pattern.label, current + matches.length * pattern.weight);
    }
  }

  if (scores.size === 0) return null;

  // Sort by score descending
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = sorted[0];

  // Require a minimum signal
  if (topScore < 2) return null;

  return topLabel;
}
