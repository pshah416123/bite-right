#!/usr/bin/env node
/**
 * Test harness for the URL-based menu extraction pipeline.
 *
 * Takes a list of restaurant menu URLs (file or inline args), runs each
 * through extractMenuFromUrl + assignMenuGroups + scoreMenu, and prints:
 *   - per-URL row (provider, sections, items, score, groups, latency, status)
 *   - per-provider roll-up (where extraction succeeds vs falls back to generic)
 *   - per-group roll-up (how often we surface food vs drinks vs wine etc.)
 *
 * The point: before building a generic HTML fallback, measure the actual gap
 * on real restaurant sites so the fallback's selector patterns come from
 * observed failure modes, not guesses.
 *
 * Usage:
 *   node server/scripts/testMenuExtraction.js urls.txt
 *   node server/scripts/testMenuExtraction.js https://site1.com/menu https://site2.com/menu
 *   node server/scripts/testMenuExtraction.js --out results.json urls.txt
 *
 * URL file format: one URL per line. Lines beginning with `#` are comments.
 */

const fs = require('fs');
const path = require('path');

const {
  detectProvider,
  extractMenuFromUrl,
  extractMenuFromHtml,
  assignMenuGroups,
  scoreMenu,
} = require('../menuExtractors');

const MENU_QUALITY_THRESHOLD = 50;

// Lazy-load Puppeteer only when --with-puppeteer is set. Module load alone
// is slow, and we don't want to require it for the static-only path.
let _puppeteer = null;
let _browser = null;
async function getBrowser() {
  if (_browser) return _browser;
  if (!_puppeteer) _puppeteer = require('puppeteer');
  _browser = await _puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return _browser;
}
async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch { /* noop */ }
    _browser = null;
  }
}

/**
 * Render `url` with headless Chrome and return the fully-rendered HTML.
 * Mirrors production's renderAndScrapeMenu but returns the HTML so the
 * harness can run our normal extractor chain on it.
 */
async function renderHtml(url) {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) req.abort();
      else req.continue();
    });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => {});
    const html = await page.content();
    return html && html.length >= 200 ? html : null;
  } catch (e) {
    return { error: e?.message || String(e) };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ─── Args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { urls: [], outPath: null, withPuppeteer: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') {
      args.outPath = argv[++i];
    } else if (a === '--with-puppeteer' || a === '-p') {
      args.withPuppeteer = true;
    } else if (/^https?:\/\//i.test(a)) {
      args.urls.push(a);
    } else {
      // Treat as file path
      const abs = path.resolve(process.cwd(), a);
      if (!fs.existsSync(abs)) {
        console.error(`Not found: ${a}`);
        process.exit(1);
      }
      const lines = fs.readFileSync(abs, 'utf-8').split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (/^https?:\/\//i.test(line)) args.urls.push(line);
      }
    }
  }
  return args;
}

// ─── Run ───────────────────────────────────────────────────────────────────

function summarizeExtract(extracted) {
  const sections = assignMenuGroups(extracted.sections || []);
  const items = sections.reduce((n, s) => n + s.items.length, 0);
  const { score } = scoreMenu(sections);
  const groups = [...new Set(sections.map((s) => s.group))].sort();
  const status =
    items === 0 ? 'empty' :
    score >= MENU_QUALITY_THRESHOLD ? 'ok' :
    'low_quality';
  return { sectionCount: sections.length, items, score, groups, status };
}

async function runOne(url, opts = {}) {
  const t0 = Date.now();
  let extracted = null;
  let err = null;
  try {
    extracted = await extractMenuFromUrl(url);
  } catch (e) {
    err = e?.message || String(e);
  }
  const staticMs = Date.now() - t0;

  // Detect provider from the URL alone — without re-fetching the HTML —
  // by giving detectProvider an empty HTML body. URL-only signals catch
  // toasttab.com / popmenu.com / square.site / chownow.com / getbento.com /
  // clover.com / wixsite.com. Sites that need HTML to detect (e.g. WordPress
  // generator meta) will read as 'generic' here, which is fine — the column
  // is for grouping in the roll-up, not for the actual extraction.
  const provider = detectProvider(url, '');

  if (err) return { url, provider, ms: staticMs, status: 'error', error: err };

  if (extracted) {
    const s = summarizeExtract(extracted);
    return {
      url, provider: extracted.source || provider, ms: staticMs, source: 'static',
      status: s.status, sections: s.sectionCount, items: s.items, score: s.score,
      groups: s.groups, pdfUrl: extracted.pdfUrl || null,
    };
  }

  // Static extraction returned nothing. If --with-puppeteer is set, render
  // the page with headless Chrome and re-run the same extractor chain on
  // the JS-rendered HTML. This tells us how much the production Puppeteer
  // stage actually rescues — important since the PDF pipeline was silently
  // broken; Puppeteer might be too.
  if (!opts.withPuppeteer) {
    return { url, provider, ms: staticMs, status: 'empty' };
  }

  const tPup = Date.now();
  const rendered = await renderHtml(url);
  if (rendered && typeof rendered === 'object' && rendered.error) {
    return {
      url, provider, ms: staticMs + (Date.now() - tPup), status: 'puppeteer_error',
      source: 'puppeteer', error: rendered.error,
    };
  }
  if (!rendered) {
    return { url, provider, ms: staticMs + (Date.now() - tPup), status: 'empty', source: 'puppeteer' };
  }
  let pupExtracted = null;
  try {
    pupExtracted = await extractMenuFromHtml(rendered, url);
  } catch (e) {
    return {
      url, provider, ms: staticMs + (Date.now() - tPup), status: 'error',
      source: 'puppeteer', error: e?.message || String(e),
    };
  }
  const totalMs = staticMs + (Date.now() - tPup);
  if (!pupExtracted) {
    return { url, provider, ms: totalMs, status: 'empty', source: 'puppeteer' };
  }
  const s = summarizeExtract(pupExtracted);
  return {
    url, provider: pupExtracted.source || provider, ms: totalMs, source: 'puppeteer',
    status: s.status, sections: s.sectionCount, items: s.items, score: s.score,
    groups: s.groups, pdfUrl: pupExtracted.pdfUrl || null,
  };
}

// ─── Printing ──────────────────────────────────────────────────────────────

function shortUrl(u, max = 44) {
  let s = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (s.length <= max) return s.padEnd(max);
  return (s.slice(0, max - 1) + '…').padEnd(max);
}

function statusGlyph(s) {
  if (s === 'ok') return '✓';
  if (s === 'low_quality') return '⚠';
  if (s === 'empty') return '✗';
  return '!';
}

function printRow(r) {
  const sections = r.sections != null ? String(r.sections).padStart(4) : '   -';
  const items = r.items != null ? String(r.items).padStart(5) : '    -';
  const score = r.score != null ? String(r.score).padStart(3) : '  -';
  const ms = String(r.ms).padStart(5);
  const groups = (r.groups || []).join(',') || '-';
  const tag = r.source === 'puppeteer' ? '[PUP] ' : '';
  console.log(
    `${statusGlyph(r.status)} ${tag}${shortUrl(r.url, 38)} ${(r.provider || '-').padEnd(10)} ` +
      `sec=${sections} items=${items} score=${score} ${ms}ms  ${groups}`,
  );
  if (r.status === 'error' || r.status === 'puppeteer_error') console.log(`    error: ${r.error}`);
}

function summary(results, opts = {}) {
  console.log('\n──────── Summary ────────');
  const total = results.length;
  const ok = results.filter((r) => r.status === 'ok').length;
  const lowQ = results.filter((r) => r.status === 'low_quality').length;
  const empty = results.filter((r) => r.status === 'empty').length;
  const err = results.filter((r) => r.status === 'error' || r.status === 'puppeteer_error').length;
  const meanItems = ok
    ? results.filter((r) => r.status === 'ok').reduce((s, r) => s + r.items, 0) / ok
    : 0;
  const meanMs = total ? results.reduce((s, r) => s + r.ms, 0) / total : 0;

  console.log(`Tested:                 ${total}`);
  console.log(`Above threshold (✓):    ${ok}  (${pct(ok, total)})`);
  console.log(`Low quality (⚠):        ${lowQ}  (${pct(lowQ, total)})`);
  console.log(`Empty / no menu (✗):    ${empty}  (${pct(empty, total)})`);
  if (err) console.log(`Errors (!):             ${err}  (${pct(err, total)})`);
  console.log(`Mean items / ok menu:   ${meanItems.toFixed(0)}`);
  console.log(`Mean latency:           ${meanMs.toFixed(0)}ms`);

  // Static-vs-Puppeteer split — the actual question we're trying to answer.
  if (opts.withPuppeteer) {
    const okStatic = results.filter((r) => r.status === 'ok' && r.source === 'static').length;
    const okPup = results.filter((r) => r.status === 'ok' && r.source === 'puppeteer').length;
    console.log('');
    console.log(`Static parser caught:   ${okStatic}  (${pct(okStatic, total)})`);
    console.log(`Puppeteer rescued:      ${okPup}  (+${pct(okPup, total)})`);
    console.log(`Production coverage:    ${okStatic + okPup}/${total}  (${pct(okStatic + okPup, total)})`);
  }

  // Per-provider breakdown — the most actionable view. "generic" is the
  // bucket the generic HTML fallback would target.
  console.log('\nBy provider:');
  const byProvider = new Map();
  for (const r of results) {
    if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
    byProvider.get(r.provider).push(r);
  }
  const providerRows = [...byProvider.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [p, rs] of providerRows) {
    const o = rs.filter((r) => r.status === 'ok').length;
    const l = rs.filter((r) => r.status === 'low_quality').length;
    const e = rs.filter((r) => r.status === 'empty').length;
    const x = rs.filter((r) => r.status === 'error').length;
    console.log(`  ${p.padEnd(14)} ${rs.length} tested   ok=${o}  low=${l}  empty=${e}  err=${x}`);
  }

  // Per-group breakdown — confirms multi-menu sites are getting tagged.
  console.log('\nBy group (across all successful menus):');
  const groupCounts = {};
  for (const r of results) {
    if (r.status !== 'ok' || !r.groups) continue;
    for (const g of r.groups) groupCounts[g] = (groupCounts[g] || 0) + 1;
  }
  for (const [g, c] of Object.entries(groupCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${g.padEnd(10)} ${c}`);
  }
}

function pct(n, total) {
  return total ? `${Math.round((n / total) * 100)}%` : '0%';
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.urls.length === 0) {
    console.error('Usage: node server/scripts/testMenuExtraction.js <file-or-urls...> [--out results.json]');
    console.error('  File format: one URL per line, # comments allowed.');
    process.exit(1);
  }

  console.log(`Testing ${args.urls.length} URL(s)\n`);
  console.log(
    '  ' +
      'URL'.padEnd(44) +
      ' provider   ' +
      'sec      items   score  latency  groups',
  );
  console.log('  ' + '─'.repeat(116));

  const results = [];
  for (let i = 0; i < args.urls.length; i++) {
    process.stdout.write(`[${i + 1}/${args.urls.length}] `);
    const r = await runOne(args.urls[i], { withPuppeteer: args.withPuppeteer });
    printRow(r);
    results.push(r);
  }

  summary(results, { withPuppeteer: args.withPuppeteer });

  if (args.outPath) {
    fs.writeFileSync(args.outPath, JSON.stringify(results, null, 2));
    console.log(`\nFull results written to ${args.outPath}`);
  }

  await closeBrowser();
}

main().catch((e) => {
  console.error('test harness crashed:', e);
  process.exit(1);
});
