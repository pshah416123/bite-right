/**
 * Embedded-PDF menu pipeline regression tests.
 *
 * These tests verify that pages whose menu is really a PDF behind a
 * viewer shell (GoDaddy "Download PDF" / wsimg.com-hosted PDFs / file
 * viewer iframes) are detected and routed to the PDF pipeline rather
 * than being handed to the generic HTML scrapers, which return junk
 * (header tracking strings, "Loading files" placeholders, etc.) for
 * these layouts.
 *
 * Reference case: Rebecca's Northville (rebeccasnorthville.com/menu)
 * is a GoDaddy Website Builder shell where the visible HTML is mostly
 * "Download PDF" / "Loading files" and the actual menu sits at a
 * wsimg.com `.pdf` URL. Before the fix, generic HTML parsers happily
 * returned the chrome as a "menu" and the PDF was never fetched.
 *
 * The test does NOT hit the network — it loads a saved HTML fixture
 * and verifies signal detection + URL extraction. Full PDF extraction
 * (download + Vision/text parse) is exercised by integration logs in
 * production; we'd need network or a mocked Vision API to assert here.
 */

const fs = require('fs');
const path = require('path');

const {
  hasPdfMenuSignal,
  detectMenuPdfUrls,
  looksFragmented,
} = require('../menuPdf');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'rebeccasNorthvilleMenu.html');
const FIXTURE_URL = 'https://rebeccasnorthville.com/menu';

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

console.log('\n── PDF-embed signal detection: Rebecca\'s Northville ──');

const html = fs.readFileSync(FIXTURE_PATH, 'utf8');

eq(hasPdfMenuSignal(html), true, 'hasPdfMenuSignal returns true for GoDaddy PDF embed page');

const pdfs = detectMenuPdfUrls(html, FIXTURE_URL);
truthy(pdfs.length > 0, 'detectMenuPdfUrls returns at least one candidate');

const wsimgMatch = pdfs.find((u) => /img1\.wsimg\.com.*Rebeccas.*\.pdf$/i.test(u));
truthy(wsimgMatch, 'detected candidate points at the wsimg.com-hosted menu PDF');

// Protocol-relative `//img1.wsimg.com/...` must be resolved to https://.
truthy(
  pdfs.every((u) => u.startsWith('https://')),
  'all candidate URLs are absolute https',
);

console.log('\n── PDF-embed signal detection: normal HTML pages ──');

// Plain HTML with no embedded-PDF cues — should NOT trip the signal.
const normalHtml = `
  <html><body>
    <h1>Lunch Menu</h1>
    <h2>Sandwiches</h2>
    <ul>
      <li>Reuben — $14</li>
      <li>Turkey Club — $13</li>
    </ul>
  </body></html>
`;
eq(hasPdfMenuSignal(normalHtml), false, 'normal HTML menu does not trip PDF signal');

// HTML with a single benign mention of "menu.pdf" elsewhere (catering
// link, archived menu) — single weak hint shouldn't be enough either.
const benignPdfMention = `
  <html><body>
    <h2>Catering</h2>
    <a href="/catering/old-menu.pdf">Archived 2019 menu</a>
    <h1>Today's Menu</h1>
    <p>Soup, Sandwich, Salad</p>
  </body></html>
`;
eq(hasPdfMenuSignal(benignPdfMention), false, 'archived catering PDF mention alone does not trip signal');

console.log('\n── looksFragmented: garbage text-mode output ──');

// Simulated output from pdf-parse on the Rebecca's design PDF —
// modifier-style "names" with random prices attached.
const fragmentedSections = [
  { title: 'Menu', items: [
    { name: 'Cheese +.50 / Bleu and Feta +', price: '$75.00' },
    { name: 'Extra Lettuce and Tomato +', price: '$75.00' },
    { name: 'Mushroom +.75 | Jalapeño +', price: '$25.00' },
    { name: 'Bowl - 4.99 | Cup - 3.29', price: '$11.99' },
    { name: 'Carry-out orders may be charged a service fee of $1 per', price: '$15.00' },
  ] },
];
eq(looksFragmented(fragmentedSections), true, 'looksFragmented flags modifier/operational item names');

const cleanSections = [
  { title: 'Sandwiches', items: [
    { name: 'Reuben', price: '$14' },
    { name: 'Turkey Club', price: '$13' },
    { name: 'Italian Beef', price: '$15' },
    { name: 'Grilled Cheese', price: '$10' },
  ] },
];
eq(looksFragmented(cleanSections), false, 'looksFragmented does not flag a clean menu');

console.log('\n============================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('All tests passed.');
