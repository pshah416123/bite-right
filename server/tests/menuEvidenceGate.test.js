/**
 * Menu-evidence gate regression tests.
 *
 * Guards against false-positive menu extraction from marketing/about-style
 * pages. The trigger case is Gotham Bagels (gothambagels.com): a Squarespace
 * homepage whose hero text + about-us blocks were getting parsed by the
 * generic Squarespace text parser into three "sections" — "Traditional
 * Ingredients", "Need More Bagels?", "Cater with Gotham" — with paragraph
 * copy as item names and zero prices.
 *
 * The fix has two parts:
 *   1. isMarketingTitle() — recognizes titles that read like CTAs,
 *      About-page nav items, taglines, or page chrome.
 *   2. hasMenuEvidence() — rejects extractions where every section title
 *      looks like marketing, where there's no pricing anywhere AND the
 *      item names are paragraph-length prose, or where the total item
 *      count is implausibly low.
 *
 * Network-free. We load the saved homepage fixture and exercise the
 * detectors directly.
 */

const fs = require('fs');
const path = require('path');

const {
  extractMenuFromHtml,
  hasMenuEvidence,
  isMarketingTitle,
} = require('../menuExtractors');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gothamBagelsHomepage.html');
const FIXTURE_URL = 'https://www.gothambagels.com/';

let passed = 0;
let failed = 0;
const fail = (msg) => { failed += 1; console.log('  ✗', msg); };
const pass = (msg) => { passed += 1; console.log('  ✓', msg); };
const eq = (got, want, msg) => {
  if (got === want) pass(`${msg} (got ${JSON.stringify(got)})`);
  else fail(`${msg} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const truthy = (got, msg) => {
  if (got) pass(msg);
  else fail(`${msg} — expected truthy, got ${JSON.stringify(got)}`);
};

console.log('\n── isMarketingTitle ──');
// Marketing chrome that has been observed showing up as "section titles":
[
  'Traditional Ingredients',
  'Need More than a Dozen Bagels?',
  'Cater with Gotham Bagels!',
  'Looking For Bagel News?',
  'Our Story',
  'Locations',
  'Follow All Things Gotham',
  'Subscribe',
  'Gift Cards',
  'Private Dining',
  'About',
  'Contact',
  'Authentic Bagels Made by Hand',          // tagline phrase
  'Family-Owned Since 1995',                 // since-year tagline
].forEach((t) => eq(isMarketingTitle(t), true, `marketing rejected: ${JSON.stringify(t)}`));

// Real menu section titles that should NEVER be rejected:
[
  'Bagels',
  'Cream Cheese',
  'Schmears',
  'Sandwiches',
  'Coffee',
  'Drinks',
  'Appetizers',
  'Sides',
  'Desserts',
  'Catering Menu',  // the noun "menu" disambiguates from "Catering" alone
  'Lunch',
  'Dinner',
  'Brunch',
].forEach((t) => eq(isMarketingTitle(t), false, `real menu accepted: ${JSON.stringify(t)}`));

console.log('\n── hasMenuEvidence: Gotham Bagels homepage ──');

const html = fs.readFileSync(FIXTURE_PATH, 'utf8');

(async () => {
  const direct = await extractMenuFromHtml(html, FIXTURE_URL);
  // We don't care what the heuristic parsers produced — only that the
  // evidence gate refuses it. (If a future parser change makes them
  // return null directly, that's also fine — the gate just isn't needed.)
  if (direct) {
    const ev = hasMenuEvidence(direct);
    eq(ev.ok, false, 'gate rejects the Gotham homepage extraction');
    truthy(
      ['all_titles_marketing', 'prose_not_menu', 'marketing_majority_no_prices'].includes(ev.reason),
      `gate cites a meaningful reason (got ${ev.reason})`,
    );
  } else {
    pass('extractMenuFromHtml returned null directly — no gating needed');
  }

  console.log('\n── hasMenuEvidence: legitimate menu (synthetic) ──');

  // A plausible real menu: short section titles, items with prices.
  const realMenu = {
    sections: [
      { title: 'Bagels', items: [
        { name: 'Plain', price: '$3' },
        { name: 'Everything', price: '$3' },
        { name: 'Sesame', price: '$3' },
      ] },
      { title: 'Sandwiches', items: [
        { name: 'Lox', price: '$14' },
        { name: 'Egg & Cheese', price: '$9' },
      ] },
    ],
  };
  eq(hasMenuEvidence(realMenu).ok, true, 'real menu passes evidence gate');

  // No-price beverage list — should still pass because titles are real
  // menu sections and item names are short.
  const drinksMenu = {
    sections: [
      { title: 'Coffee', items: [
        { name: 'Drip Coffee' },
        { name: 'Cold Brew' },
        { name: 'Latte' },
        { name: 'Cappuccino' },
      ] },
    ],
  };
  eq(hasMenuEvidence(drinksMenu).ok, true, 'no-price drinks menu passes evidence gate');

  // Marketing chrome with no prices — should be rejected.
  const marketingMenu = {
    sections: [
      { title: 'Traditional Ingredients', items: [
        { name: 'Our bagels are made from unbleached, never-bromated flour and our dough is hand-rolled.' },
      ] },
      { title: 'Need More Bagels?', items: [
        { name: 'Order a dozen and save!' },
      ] },
      { title: 'Cater with Gotham', items: [
        { name: 'Platters for every occasion.' },
      ] },
    ],
  };
  eq(hasMenuEvidence(marketingMenu).ok, false, 'marketing chrome rejected');

  console.log('\n============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('All tests passed.');
})();
