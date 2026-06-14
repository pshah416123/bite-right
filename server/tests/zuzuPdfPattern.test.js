#!/usr/bin/env node
/**
 * Synthetic regression tests for the Zuzu-pattern PDF (multi-column,
 * ALL-CAPS dish names with no category words, mid-section fragments).
 *
 * Runs against parsePdfTextToSections directly — no network. Each test
 * is a tiny PDF-text fixture that targets one specific failure mode.
 *
 *   $ node server/tests/zuzuPdfPattern.test.js
 *
 * Exits non-zero on failure (suitable for CI / pre-commit).
 */

const { parsePdfTextToSections } = require('../menuPdf');

let pass = 0;
let fail = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(label);
    console.log('  ✗ FAIL:', label);
    return false;
  }
  console.log('  ✓', label);
  return true;
}

function test(name, fn) {
  console.log('\n──', name, '──');
  fn();
}

const flatten = (sections) => {
  const items = [];
  for (const s of sections || []) {
    for (const it of (s.items || [])) items.push({ ...it, _section: s.title });
  }
  return items;
};

const sectionTitles = (sections) => (sections || []).map((s) => s.title);
const hasItem = (sections, namePattern) =>
  flatten(sections).some((it) => namePattern.test(it.name || ''));
const sectionExists = (sections, titlePattern) =>
  (sections || []).some((s) => titlePattern.test(s.title || ''));

// ─── Zuzu-specific PDF text fixtures ──────────────────────────────────

test('Zuzu — ALL-CAPS dish names without category words must NOT become sections', () => {
  const zuzuText = [
    'GEKKEIKAN HAIKY TOKUBETSU JUNMAI......52',
    'Full & Sweet',
    'Nigori Hakutsuru.........................................................27',
    'Full & Sweet',
    'Junmai-Suigei Tokubetou........................................64',
    'Full & Dry',
    'Junmai Ginjo, kikusui...................................................40',
    'Light & Dry',
    'ZUZU ROLLS',
    '5PC / 10 PC',
    'Truffle scallop*Hokkaido Scallop, Toro, Asian Pear, Avocado',
    'ORA KING + Avocado*Ora King Salmon, Cucumber, Avocado',
    'BLUEFIN*Sliced Akami, Toro, Pickled Daikon',
    '13/25',
    '10/19',
    '12/23',
    'LOBSTER TEMPURA',
    'SHRIMP TEMPURA*',
    'Tempura Lobster, Pickled Daikon, Eel Sauce',
    'Junmai Daiginjo Joto......................................59',
    'Light & Dry',
    'Junmai Daiginjo Dassai......................................145',
    'Light & Sweet',
    'Joto Yuzu Infused, Joto..............94',
    'Sweet & Tart',
  ].join('\n');

  const result = parsePdfTextToSections(zuzuText);
  assert(result !== null, 'returns a non-null result');
  if (!result) return;

  const titles = sectionTitles(result);
  console.log('    sections seen:', titles.join(' | '));

  assert(!sectionExists(result, /^lobster\s?tempura$/i), 'LOBSTER TEMPURA is NOT a section title');
  assert(!sectionExists(result, /^shrimp\s?tempura$/i), 'SHRIMP TEMPURA is NOT a section title');
  assert(!sectionExists(result, /^bluefin$/i), 'BLUEFIN is NOT a section title');
  assert(!sectionExists(result, /^jalape/i), 'JALAPEÑO HAMACHI / JALAPEÑO would not become a section');
  assert(hasItem(result, /Gekkeikan/i), 'Gekkeikan dish is captured');
  assert(hasItem(result, /Junmai Daiginjo Joto/i), 'Junmai Daiginjo Joto is captured');
  // Category-consistency pass: sake items must NOT live under a food
  // header. With this fixture only sake items get prices (sushi prices
  // are split across columns), so "Zuzu Rolls" ends up empty/sake-only
  // and gets relabeled into Sake.
  const sakeItems = flatten(result).filter((it) =>
    /Junmai|Gekkeikan|Nigori|Hakutsuru/i.test(it.name),
  );
  assert(sakeItems.length >= 4, `sake items survive (got ${sakeItems.length})`);
  assert(
    sakeItems.every((it) => /sake|beverage/i.test(it._section)),
    'all sake items live under a Sake/Beverage section, not under a food header',
  );
});

test('Zuzu — mid-section fragments like "Your choice of $2" are rejected', () => {
  const fragText = [
    'APPETIZERS',
    'Edamame.....6',
    'Wakame Salad.....8',
    'Your choice of.....2',
    'Add to any roll.....3',
    'Tuna Tartare.....14',
  ].join('\n');
  const result = parsePdfTextToSections(fragText);
  assert(result !== null, 'returns a non-null result');
  if (!result) return;
  const items = flatten(result);
  console.log('    items extracted:', items.map((i) => `${i.name} ${i.price}`).join(' | '));
  assert(!items.some((i) => /your choice of/i.test(i.name)), '"Your choice of" rejected');
  assert(!items.some((i) => /^add (to|a)/i.test(i.name)), '"Add to any" rejected');
  assert(items.some((i) => /Edamame/i.test(i.name)), 'real item Edamame survives');
  assert(items.some((i) => /Tuna Tartare/i.test(i.name)), 'real item Tuna Tartare survives');
});

test('Single-item sections are dropped or merged into the previous section', () => {
  const oneItemSec = [
    'APPETIZERS',
    'Bruschetta.....8',
    'Caprese.....12',
    'Edamame.....6',
    'LOBSTER TEMPURA',
    'Whole Maine Lobster.....120',
    'DESSERTS',
    'Tiramisu.....10',
    'Cannoli.....8',
  ].join('\n');
  const result = parsePdfTextToSections(oneItemSec);
  assert(result !== null, 'non-null');
  if (!result) return;
  console.log('    sections:', sectionTitles(result).join(' | '));
  // LOBSTER TEMPURA was not promoted (no category hint) — the lobster item
  // should merge into Appetizers (the previous section) instead of becoming
  // a fake 1-item section.
  assert(!sectionExists(result, /^lobster\s?tempura$/i), 'no LOBSTER TEMPURA fake section');
  assert(hasItem(result, /Whole Maine Lobster/i), 'Whole Maine Lobster is captured somewhere');
});

test('Mixed-bleed: food section with one bleed-in sake item hoists the sake', () => {
  const mixed = [
    'SUSHI ROLLS',
    'Spicy Tuna Roll.....14',
    'California Roll.....10',
    'Dragon Roll.....18',
    'Junmai Daiginjo Dassai.....145',  // column-bleed sake item
    'Rainbow Roll.....20',
    'DESSERTS',
    'Mochi Ice Cream.....8',
    'Green Tea Cake.....9',
  ].join('\n');
  const result = parsePdfTextToSections(mixed);
  assert(result !== null, 'non-null');
  if (!result) return;
  console.log('    sections:', sectionTitles(result).join(' | '));
  const flat = flatten(result);
  const dassai = flat.find((it) => /Dassai/i.test(it.name));
  assert(!!dassai, 'Dassai item survived');
  if (dassai) {
    assert(/sake|beverage/i.test(dassai._section), `Dassai is under Sake/Beverage section (got "${dassai._section}")`);
  }
  assert(
    flat.some((it) => /Spicy Tuna/i.test(it.name) && /sushi|rolls/i.test(it._section)),
    'Spicy Tuna Roll stays under Sushi Rolls',
  );
  assert(
    flat.some((it) => /Mochi/i.test(it.name) && /dessert/i.test(it._section)),
    'Mochi stays under Desserts',
  );
});

test('Beverage flavor descriptors like "Light & Dry" are dropped', () => {
  const flavorText = [
    'SAKE',
    'Junmai Ginjo.....45',
    'Light & Dry.....3',          // tasting note captured with stray price
    'Daiginjo Premium.....95',
    'Full & Sweet.....2',          // tasting note captured with stray price
    'Nigori Hakutsuru.....27',
  ].join('\n');
  const result = parsePdfTextToSections(flavorText);
  assert(result !== null, 'non-null');
  if (!result) return;
  const flat = flatten(result);
  console.log('    items:', flat.map((i) => i.name).join(' | '));
  assert(!flat.some((it) => /^light\s*&\s*dry$/i.test(it.name)), '"Light & Dry" descriptor dropped');
  assert(!flat.some((it) => /^full\s*&\s*sweet$/i.test(it.name)), '"Full & Sweet" descriptor dropped');
  assert(flat.some((it) => /Junmai Ginjo/i.test(it.name)), 'real sake survives');
  assert(flat.some((it) => /Nigori/i.test(it.name)), 'Nigori survives');
});

test('Standard well-structured single-column menu still parses correctly', () => {
  const std = [
    'APPETIZERS',
    'Bruschetta.....8',
    'Calamari Fritti.....14',
    'Caprese.....12',
    'MAINS',
    'Spaghetti Carbonara.....22',
    'Lasagna Bolognese.....24',
    'Osso Buco.....38',
    'DESSERTS',
    'Tiramisu.....10',
    'Cannoli.....8',
    'Panna Cotta.....9',
  ].join('\n');
  const result = parsePdfTextToSections(std);
  assert(result !== null, 'non-null');
  if (!result) return;
  assert(result.length >= 3, `at least 3 sections (got ${result.length})`);
  assert(sectionExists(result, /appetizers/i), 'Appetizers section');
  assert(sectionExists(result, /mains?/i), 'Mains section');
  assert(sectionExists(result, /desserts/i), 'Desserts section');
  const items = flatten(result);
  assert(items.length >= 9, `at least 9 items (got ${items.length})`);
  assert(hasItem(result, /Bruschetta/i), 'Bruschetta captured');
});

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  -', f));
  process.exit(1);
}
console.log('All tests passed.');
process.exit(0);
