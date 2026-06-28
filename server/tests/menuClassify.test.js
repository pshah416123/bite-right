/**
 * Menu classification + priority selection regression tests.
 *
 * Covers the contract laid out in the menu-ingestion refactor:
 *   - classifyMenuType labels every menu (URL, anchor, title, sections,
 *     items) with one of the 17 enum values + a 0–1 confidence.
 *   - selectPrimaryMenu picks the highest-priority NON-catering candidate.
 *   - Catering / group orders / party packs / family meals are HIDDEN by
 *     default — they only surface as primary when allowCateringFallback
 *     is explicitly set. The default product behavior is "Menu
 *     unavailable" over "show the user a 100-person tray menu".
 *   - Item-level signals (serves N, feeds N, tray, dozen, etc.)
 *     contribute to catering classification on their own.
 */

const {
  MENU_TYPES,
  MENU_TYPE_PRIORITY,
  classifyMenuType,
  selectPrimaryMenu,
} = require('../menuClassify');

let passed = 0;
let failed = 0;
const fail = (msg) => { failed += 1; console.log('  ✗', msg); };
const pass = (msg) => { passed += 1; console.log('  ✓', msg); };
const eq = (got, want, msg) => {
  if (got === want) pass(`${msg} (${JSON.stringify(got)})`);
  else fail(`${msg} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const truthy = (got, msg) => {
  if (got) pass(msg);
  else fail(`${msg} — got ${JSON.stringify(got)}`);
};

// ─── classifyMenuType ──────────────────────────────────────────────────────

console.log('\n── classifyMenuType: catering family ──');

eq(
  classifyMenuType({ urlPath: '/catering', anchorText: 'Catering' }).type,
  MENU_TYPES.CATERING,
  'classifies /catering URL as catering',
);
eq(
  classifyMenuType({ urlPath: '/group-ordering', anchorText: 'Group Orders' }).type,
  MENU_TYPES.GROUP_ORDERS,
  'classifies /group-ordering as group_orders',
);
eq(
  classifyMenuType({ urlPath: '/party-packs', anchorText: 'Party Packs' }).type,
  MENU_TYPES.PARTY_PACKS,
  'classifies /party-packs as party_packs',
);
eq(
  classifyMenuType({ urlPath: '/family-meals', anchorText: 'Family Meals' }).type,
  MENU_TYPES.FAMILY_MEALS,
  'classifies /family-meals as family_meals',
);
eq(
  classifyMenuType({
    urlPath: '/order',
    anchorText: 'Order',
    title: 'Order Online',
    sectionTitles: ['Tray of Bagels (serves 8)', 'Office Lunch Boxed'],
    itemNames: ['Tray of Lox (serves 12)', 'Boxed Lunch (feeds 1)', '3 dozen bagels'],
  }).type,
  MENU_TYPES.CATERING,
  'classifies item-level catering even when URL is generic',
);

console.log('\n── classifyMenuType: meal periods ──');
eq(classifyMenuType({ urlPath: '/lunch' }).type, MENU_TYPES.LUNCH, '/lunch → lunch');
eq(classifyMenuType({ urlPath: '/dinner-menu' }).type, MENU_TYPES.DINNER, '/dinner-menu → dinner');
eq(classifyMenuType({ urlPath: '/brunch' }).type, MENU_TYPES.BRUNCH, '/brunch → brunch');
eq(classifyMenuType({ urlPath: '/breakfast' }).type, MENU_TYPES.BREAKFAST, '/breakfast → breakfast');
eq(classifyMenuType({ anchorText: 'Late Night Menu' }).type, MENU_TYPES.DINNER, 'late night anchor → dinner');

console.log('\n── classifyMenuType: drinks / dessert / kids / happy hour ──');
eq(classifyMenuType({ urlPath: '/cocktails' }).type, MENU_TYPES.DRINKS, '/cocktails → drinks');
eq(classifyMenuType({ urlPath: '/wine-list' }).type, MENU_TYPES.DRINKS, '/wine-list → drinks');
eq(classifyMenuType({ urlPath: '/dessert' }).type, MENU_TYPES.DESSERT, '/dessert → dessert');
eq(classifyMenuType({ urlPath: '/kids-menu' }).type, MENU_TYPES.KIDS, '/kids-menu → kids');
eq(classifyMenuType({ urlPath: '/happy-hour' }).type, MENU_TYPES.HAPPY_HOUR, '/happy-hour → happy_hour');
eq(classifyMenuType({ anchorText: 'Social Hour' }).type, MENU_TYPES.HAPPY_HOUR, 'social hour anchor → happy_hour');

console.log('\n── classifyMenuType: main / all-day ──');
eq(classifyMenuType({ urlPath: '/menu' }).type, MENU_TYPES.MAIN, '/menu → main');
eq(classifyMenuType({ urlPath: '/the-menu' }).type, MENU_TYPES.MAIN, '/the-menu → main');
eq(classifyMenuType({ urlPath: '/food' }).type, MENU_TYPES.MAIN, '/food → main');
eq(classifyMenuType({ urlPath: '/all-day-menu' }).type, MENU_TYPES.ALL_DAY, 'all-day → all_day');

console.log('\n── classifyMenuType: specials / seasonal / unknown ──');
eq(classifyMenuType({ anchorText: "Chef's Specials" }).type, MENU_TYPES.SPECIALS, "chef's specials → specials");
eq(classifyMenuType({ urlPath: '/winter-menu' }).type, MENU_TYPES.SEASONAL, 'winter menu → seasonal');
eq(classifyMenuType({}).type, MENU_TYPES.UNKNOWN, 'no signals → unknown');
eq(classifyMenuType({ urlPath: '/about' }).type, MENU_TYPES.UNKNOWN, '/about URL → unknown');

console.log('\n── classifyMenuType: returns a 0–1 confidence ──');
const cat = classifyMenuType({ urlPath: '/catering' });
truthy(cat.confidence > 0 && cat.confidence <= 1, 'catering URL produces a 0–1 confidence');
const unk = classifyMenuType({});
eq(unk.confidence, 0, 'unknown menus get confidence 0');

// ─── selectPrimaryMenu ─────────────────────────────────────────────────────

console.log('\n── selectPrimaryMenu: catering loses to standard menu ──');

const result1 = selectPrimaryMenu([
  {
    sourceUrl: 'https://example.com/catering',
    anchorText: 'Catering',
    sections: [{ title: 'Trays', items: [{ name: 'Bagel Tray (serves 12)' }, { name: 'Lox Platter (feeds 8)' }] }],
  },
  {
    sourceUrl: 'https://example.com/menu',
    anchorText: 'Menu',
    sections: [{ title: 'Bagels', items: [{ name: 'Plain' }, { name: 'Everything' }, { name: 'Sesame' }] }],
  },
]);
eq(result1.primary?.menuType, MENU_TYPES.MAIN, 'primary is the main menu, not catering');
eq(result1.hidden.length, 1, 'catering candidate is held aside as hidden-by-default');
eq(result1.hidden[0].menuType, MENU_TYPES.CATERING, 'hidden candidate is classified as catering');

console.log('\n── selectPrimaryMenu: lunch + dinner + brunch + catering → lunch (priority order) ──');
const result2 = selectPrimaryMenu([
  { sourceUrl: 'https://x.com/catering', sections: [{ items: [{ name: 'Tray (serves 12)' }] }] },
  { sourceUrl: 'https://x.com/dinner', sections: [{ items: [{ name: 'Steak' }] }] },
  { sourceUrl: 'https://x.com/lunch', sections: [{ items: [{ name: 'Salad' }] }] },
  { sourceUrl: 'https://x.com/brunch', sections: [{ items: [{ name: 'Eggs' }] }] },
]);
eq(result2.primary?.menuType, MENU_TYPES.LUNCH, 'lunch wins over dinner/brunch via lower priority number');
eq(result2.others?.length, 2, 'other non-catering menus reported');
eq(result2.hidden.length, 1, 'catering still hidden');

console.log('\n── selectPrimaryMenu: only catering available → no primary (fallback off) ──');
const result3 = selectPrimaryMenu([
  { sourceUrl: 'https://x.com/catering', sections: [{ items: [{ name: 'Tray (serves 12)' }] }] },
  { sourceUrl: 'https://x.com/group-ordering', sections: [{ items: [{ name: 'Box Lunch (feeds 1)' }] }] },
]);
eq(result3.primary, null, 'no primary when only catering/group exist');
eq(result3.trace.reason, 'only_catering_available_suppressed', 'trace reason cites suppression');
truthy(result3.hidden.length === 2, 'both catering candidates surfaced in hidden list');

console.log('\n── selectPrimaryMenu: only catering + fallback on → catering promoted ──');
const result4 = selectPrimaryMenu(
  [{ sourceUrl: 'https://x.com/catering', sections: [{ items: [{ name: 'Tray' }] }] }],
  { allowCateringFallback: true },
);
eq(result4.primary?.menuType, MENU_TYPES.CATERING, 'fallback flag promotes catering');

console.log('\n── selectPrimaryMenu: empty candidates ignored ──');
const result5 = selectPrimaryMenu([
  { sourceUrl: 'https://x.com/menu', sections: [{ items: [{ name: 'Burger' }] }] },
  { sourceUrl: 'https://x.com/lunch', sections: [] },
  { sourceUrl: 'https://x.com/dinner', sections: [{ items: [] }] },
]);
eq(result5.primary?.menuType, MENU_TYPES.MAIN, 'main menu wins even when other candidates are empty');
eq(result5.rejected.length, 2, 'empty candidates rejected');

console.log('\n── selectPrimaryMenu: empty list ──');
const result6 = selectPrimaryMenu([]);
eq(result6.primary, null, 'empty list → no primary');
eq(result6.trace.reason, 'no_candidates', 'trace reason cites no candidates');

console.log('\n── selectPrimaryMenu: drinks-only restaurant (a real bar) ──');
const result7 = selectPrimaryMenu([
  { sourceUrl: 'https://x.com/cocktails', sections: [{ items: [{ name: 'Old Fashioned' }, { name: 'Manhattan' }] }] },
  { sourceUrl: 'https://x.com/wine-list', sections: [{ items: [{ name: 'Pinot Noir' }] }] },
]);
eq(result7.primary?.menuType, MENU_TYPES.DRINKS, 'drinks wins when nothing else exists');

console.log('\n── selectPrimaryMenu: confidence tiebreaker ──');
// Both /menu and /food classify as MAIN. The one with the higher item
// count should win on the second tiebreaker.
const result8 = selectPrimaryMenu([
  { sourceUrl: 'https://x.com/food', sections: [{ items: [{ name: 'A' }] }] },
  { sourceUrl: 'https://x.com/menu', sections: [{ items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }] },
]);
eq(result8.primary?.sections[0].items.length, 3, 'larger menu wins after type+confidence tie');

console.log('\n── selectPrimaryMenu: caller-supplied menuType is trusted ──');
const result9 = selectPrimaryMenu([
  { sourceUrl: 'https://x.com/specials', menuType: MENU_TYPES.SPECIALS, sections: [{ items: [{ name: 'Daily fish' }] }] },
  { sourceUrl: 'https://x.com/menu', sections: [{ items: [{ name: 'Burger' }] }] },
]);
eq(result9.primary?.menuType, MENU_TYPES.MAIN, 'main menu still wins over specials (priority order)');
const result10 = selectPrimaryMenu([
  { sourceUrl: 'https://x.com/some-path', menuType: MENU_TYPES.CATERING, sections: [{ items: [{ name: 'Tray' }] }] },
  { sourceUrl: 'https://x.com/menu', sections: [{ items: [{ name: 'Burger' }] }] },
]);
eq(result10.primary?.menuType, MENU_TYPES.MAIN, 'caller-supplied catering is still hidden');

console.log('\n── Priority table sanity ──');
truthy(
  MENU_TYPE_PRIORITY[MENU_TYPES.MAIN] < MENU_TYPE_PRIORITY[MENU_TYPES.LUNCH],
  'main outranks lunch',
);
truthy(
  MENU_TYPE_PRIORITY[MENU_TYPES.LUNCH] < MENU_TYPE_PRIORITY[MENU_TYPES.DRINKS],
  'lunch outranks drinks',
);
truthy(
  MENU_TYPE_PRIORITY[MENU_TYPES.DRINKS] < MENU_TYPE_PRIORITY[MENU_TYPES.HAPPY_HOUR],
  'drinks outranks happy hour',
);
truthy(
  MENU_TYPE_PRIORITY[MENU_TYPES.HAPPY_HOUR] < MENU_TYPE_PRIORITY[MENU_TYPES.CATERING],
  'happy hour outranks catering',
);
truthy(
  MENU_TYPE_PRIORITY[MENU_TYPES.CATERING] === MENU_TYPE_PRIORITY[MENU_TYPES.GROUP_ORDERS] - 1
  || MENU_TYPE_PRIORITY[MENU_TYPES.CATERING] < MENU_TYPE_PRIORITY[MENU_TYPES.PARTY_PACKS],
  'catering family clustered at the bottom of the priority table',
);

console.log('\n============================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All tests passed.');
