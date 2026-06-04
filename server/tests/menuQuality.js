/**
 * Menu quality validation — flags extractions that look broken even if
 * they passed parser-level quality gates. Used by:
 *   - server/scripts/runMenuRegression.js (corpus runner)
 *   - one-off debugging via require('./menuQuality')
 *
 * Each check returns either null (pass) or a string describing the
 * failure. validateMenu() aggregates all checks into a report.
 *
 * NONE of these checks short-circuits extraction itself — the goal is
 * to produce a quality signal we can compare across restaurants and
 * across changes, not to gate caching.
 */

// ─── Token sets ────────────────────────────────────────────────────────
const EVENT_LANGUAGE_RE = /\b(?:sunday\s?swim|industry\s?night|happy\s?hour|trivia|karaoke|live\s?music|pool\s?(?:pass|access)|date\s?night|grazing\s?hour|game\s?night|wine\s?night|ladies\s?night|dj\s?night|bottomless|brunch\s?hours?|lunch\s?hours?|dinner\s?hours?)\b/i;

const TIME_DATE_RE = /\b(?:\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|all\s+day|weekday|weekend|tuesday[-\s]thursday|m-f|sun-thu|24\s?(?:\/|h)|open\s+(?:until|till))\b/i;

const RESERVATION_LANGUAGE_RE = /\b(?:reservations?|book\s+(?:a\s+)?(?:table|now|online)|join\s+us|opentable|resy|sevenrooms|tock|call\s+us|private\s+(?:event|dining|party)|book\s+your\s+event|catering)\b/i;

const FOOD_KEYWORD_RE = /\b(?:chicken|beef|pork|lamb|duck|fish|salmon|tuna|shrimp|crab|lobster|oyster|sushi|sashimi|nigiri|maki|tempura|ramen|udon|noodle|pasta|pizza|burger|sandwich|salad|soup|bread|cheese|cream|garlic|truffle|chocolate|vanilla|caramel|berry|lemon|lime|miso|soy|curry|pho|taco|burrito|enchilada|carnitas|guacamole|crudo|ceviche|tartare|carpaccio|risotto|gnocchi|cocktail|martini|negroni|spritz|aperol|wine|tequila|bourbon|whiskey|mezcal|gin|vodka|amaro|espresso|latte|cappuccino|matcha|fries|wings|nachos|hummus|falafel|kebab|shawarma|gyro|biryani|tandoori|tikka|samosa|naan|dosa|spring\s?roll|dumpling|wonton|pad\s?thai|bibimbap|bulgogi|empanada|pancake|waffle|omelette|brunch|breakfast|dessert|cake|pie|ice\s?cream|gelato|brownie|cookie|tart|appetizer|entree|side\s?dish|main\s?course|beverage|drink|coffee|tea|smoothie|sake|beer|lager|stout|ipa|champagne|prosecco|rose|sparkling)\b/i;

const PROMOTIONAL_RE = /\b(?:back\s+(?:this|this\s+\w+)|coming\s+soon|now\s+(?:open|serving)|don'?t\s+miss|join\s+us|grab\s+your|follow\s+us|new\s+menu|just\s+launched|gift\s+card|merch(?:andise)?|newsletter|sign\s+up|subscribe|book\s+(?:online|now))\b/i;

// ─── Per-item checks ───────────────────────────────────────────────────
function isEventLike(item) {
  return EVENT_LANGUAGE_RE.test(`${item.name || ''} ${item.description || ''}`);
}
function isTimeDateLike(item) {
  return TIME_DATE_RE.test(`${item.name || ''} ${item.description || ''}`);
}
function isReservationLike(item) {
  return RESERVATION_LANGUAGE_RE.test(`${item.name || ''} ${item.description || ''}`);
}
function isPromotional(item) {
  return PROMOTIONAL_RE.test(`${item.name || ''} ${item.description || ''}`);
}
function hasFoodKeyword(item) {
  return FOOD_KEYWORD_RE.test(`${item.name || ''} ${item.description || ''}`);
}

// ─── Aggregate quality report ──────────────────────────────────────────
/**
 * Validate an extracted menu object: { sections: [{ title, items: [...] }] }.
 * Returns { passed, score, issues, stats, items }.
 */
function validateMenu(menu) {
  const sections = (menu && Array.isArray(menu.sections)) ? menu.sections : [];
  const issues = [];
  const items = [];
  for (const sec of sections) {
    for (const it of (sec.items || [])) items.push(it);
  }
  const total = items.length;

  // Per-section checks
  let zeroItemSections = 0;
  let oneItemSections = 0;
  for (const sec of sections) {
    const n = (sec.items || []).length;
    if (n === 0) zeroItemSections++;
    else if (n === 1) oneItemSections++;
  }
  if (zeroItemSections > 0) {
    issues.push(`section_zero_items=${zeroItemSections}`);
  }
  if (oneItemSections > 0) {
    // Tolerated up to one "special of the day" section; more is suspect.
    if (oneItemSections > 1) {
      issues.push(`section_one_item=${oneItemSections}`);
    }
  }

  // Per-item content checks (only meaningful with ≥3 items)
  let eventCount = 0;
  let timeDateCount = 0;
  let reservationCount = 0;
  let promoCount = 0;
  let foodCount = 0;
  for (const it of items) {
    if (isEventLike(it)) eventCount++;
    if (isTimeDateLike(it)) timeDateCount++;
    if (isReservationLike(it)) reservationCount++;
    if (isPromotional(it)) promoCount++;
    if (hasFoodKeyword(it)) foodCount++;
  }
  if (total >= 3) {
    if (eventCount / total > 0.3) issues.push(`event_language_pct=${Math.round(eventCount / total * 100)}`);
    if (timeDateCount / total > 0.2) issues.push(`time_date_language_pct=${Math.round(timeDateCount / total * 100)}`);
    if (reservationCount / total > 0.2) issues.push(`reservation_language_pct=${Math.round(reservationCount / total * 100)}`);
    if (foodCount / total < 0.5) issues.push(`food_keyword_pct=${Math.round(foodCount / total * 100)}`);
    if (promoCount > foodCount) issues.push(`promo_exceeds_food`);
  }

  const stats = {
    totalSections: sections.length,
    totalItems: total,
    zeroItemSections,
    oneItemSections,
    eventCount,
    timeDateCount,
    reservationCount,
    promoCount,
    foodCount,
    eventPct: total ? eventCount / total : 0,
    timeDatePct: total ? timeDateCount / total : 0,
    reservationPct: total ? reservationCount / total : 0,
    foodPct: total ? foodCount / total : 0,
  };

  // Composite quality score: 100 = perfect, decrements per issue.
  let score = 100;
  if (zeroItemSections > 0) score -= zeroItemSections * 5;
  if (oneItemSections > 1) score -= (oneItemSections - 1) * 4;
  if (stats.eventPct > 0.3) score -= 20;
  if (stats.timeDatePct > 0.2) score -= 15;
  if (stats.reservationPct > 0.2) score -= 15;
  if (stats.foodPct < 0.5 && total >= 3) score -= 20;
  if (promoCount > foodCount && total >= 3) score -= 25;
  score = Math.max(0, score);

  return {
    passed: issues.length === 0,
    score,
    issues,
    stats,
  };
}

module.exports = {
  // Public API
  validateMenu,
  // Predicates exposed for spot checks
  isEventLike,
  isTimeDateLike,
  isReservationLike,
  isPromotional,
  hasFoodKeyword,
  // Regexes exposed for testing
  EVENT_LANGUAGE_RE,
  TIME_DATE_RE,
  RESERVATION_LANGUAGE_RE,
  FOOD_KEYWORD_RE,
  PROMOTIONAL_RE,
};
