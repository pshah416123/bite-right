#!/usr/bin/env node
/**
 * Menu extraction regression runner.
 *
 *   $ node server/scripts/runMenuRegression.js
 *
 * Loads the corpus from server/tests/menuCorpus.json, re-extracts each
 * URL fresh, runs the quality validator, and produces a report:
 *
 *   - Per restaurant: sections / items / quality score / pass-fail flags
 *   - Synthetic PDF fixtures: must-contain / must-not-contain assertions
 *   - Aggregate stats: avg score, pass rate, regressions vs baseline
 *
 * Optional --baseline=path/to/json saves the current run as a baseline
 * for future diff comparisons (--diff=baseline.json). Diff prints
 * IMPROVED / UNCHANGED / WORSENED per restaurant.
 *
 * Exits non-zero if any synthetic fixture fails its assertions (these
 * are the regression-critical cases, e.g. Zuzu's LOBSTER TEMPURA).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { extractMenuFromUrl } = require('../menuExtractors');
const { parsePdfTextToSections } = require('../menuPdf');
const { validateMenu } = require('../tests/menuQuality');

const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'tests', 'menuCorpus.json'), 'utf8'),
);

const args = process.argv.slice(2);
const baselineArg = args.find((a) => a.startsWith('--baseline='));
const diffArg = args.find((a) => a.startsWith('--diff='));
const baselineOutPath = baselineArg ? baselineArg.split('=')[1] : null;
const diffInPath = diffArg ? diffArg.split('=')[1] : null;

const baseline = diffInPath && fs.existsSync(diffInPath)
  ? JSON.parse(fs.readFileSync(diffInPath, 'utf8'))
  : null;

function flatten(sections) {
  return (sections || []).flatMap((s) => (s.items || []).map((it) => ({ ...it, _section: s.title })));
}
function hasItem(sections, pattern) {
  return flatten(sections).some((i) => pattern.test(i.name || ''));
}
function sectionExists(sections, pattern) {
  return (sections || []).some((s) => pattern.test(s.title || ''));
}

const report = { restaurants: [], synthetic: [] };
let syntheticFailures = 0;

(async () => {
  console.log('═'.repeat(60));
  console.log('MENU EXTRACTION REGRESSION');
  console.log('═'.repeat(60));

  // ─── Real restaurant URLs ─────────────────────────────────────────
  for (const r of corpus.restaurants) {
    process.stdout.write(`\n→ ${r.label}\n  ${r.url}\n`);
    let extracted = null;
    try {
      extracted = await extractMenuFromUrl(r.url);
    } catch (e) {
      console.log('  ✗ extraction threw:', e.message);
    }
    const sections = extracted?.sections || [];
    const items = flatten(sections);
    const quality = validateMenu({ sections });
    const source = extracted?.source || 'null';

    const checks = [];
    const e = r.expected || {};
    if (e.minItems && items.length < e.minItems) checks.push(`items ${items.length} < minItems ${e.minItems}`);
    if (e.minSections && sections.length < e.minSections) checks.push(`sections ${sections.length} < minSections ${e.minSections}`);
    if (e.mustContainItem) {
      if (!hasItem(sections, new RegExp(e.mustContainItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) {
        checks.push(`missing required item "${e.mustContainItem}"`);
      }
    }
    if (e.mustNotContainItem) {
      if (sectionExists(sections, new RegExp('^' + e.mustNotContainItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))) {
        checks.push(`forbidden section title "${e.mustNotContainItem}"`);
      }
    }

    const status = checks.length === 0 && quality.issues.length === 0 ? 'PASS' : (extracted ? 'WARN' : 'FAIL');
    const symbol = status === 'PASS' ? '✓' : status === 'WARN' ? '~' : '✗';
    console.log(`  ${symbol} source=${source} sections=${sections.length} items=${items.length} qualityScore=${quality.score}`);
    if (quality.issues.length > 0) console.log('     quality issues:', quality.issues.join(' | '));
    if (checks.length > 0) console.log('     corpus checks:', checks.join(' | '));

    report.restaurants.push({
      label: r.label,
      url: r.url,
      status,
      source,
      sectionCount: sections.length,
      itemCount: items.length,
      qualityScore: quality.score,
      issues: quality.issues,
      checks,
    });
  }

  // ─── Synthetic PDF fixtures (network-free) ────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('SYNTHETIC PDF FIXTURES');
  console.log('═'.repeat(60));
  for (const s of corpus.synthetic) {
    console.log(`\n→ ${s.label}`);
    const sections = parsePdfTextToSections(s.pdfText) || [];
    const items = flatten(sections);
    const failures = [];
    const e = s.expected || {};
    if (e.mustContainItem && !hasItem(sections, new RegExp(e.mustContainItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) {
      failures.push(`missing required item "${e.mustContainItem}"`);
    }
    if (e.mustNotContainItem && sectionExists(sections, new RegExp('^' + e.mustNotContainItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))) {
      failures.push(`forbidden fake section "${e.mustNotContainItem}"`);
    }
    if (e.mustNotContainItem2 && sectionExists(sections, new RegExp('^' + e.mustNotContainItem2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))) {
      failures.push(`forbidden fake section "${e.mustNotContainItem2}"`);
    }
    if (e.noFragments) {
      for (const frag of e.noFragments) {
        if (items.some((i) => new RegExp(frag, 'i').test(i.name || ''))) {
          failures.push(`fragment "${frag}" leaked into items`);
        }
      }
    }
    if (e.minSections && sections.length < e.minSections) {
      failures.push(`sections ${sections.length} < minSections ${e.minSections}`);
    }
    if (e.minItems && items.length < e.minItems) {
      failures.push(`items ${items.length} < minItems ${e.minItems}`);
    }
    const symbol = failures.length === 0 ? '✓' : '✗';
    console.log(`  ${symbol} sections=${sections.length} items=${items.length}`);
    if (failures.length > 0) {
      failures.forEach((f) => console.log('     ✗', f));
      syntheticFailures++;
    }
    report.synthetic.push({ label: s.label, sections: sections.length, items: items.length, failures });
  }

  // ─── Aggregate ────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('AGGREGATE');
  console.log('═'.repeat(60));
  const restaurants = report.restaurants;
  const passed = restaurants.filter((r) => r.status === 'PASS').length;
  const warned = restaurants.filter((r) => r.status === 'WARN').length;
  const failed = restaurants.filter((r) => r.status === 'FAIL').length;
  const avgScore = restaurants.reduce((acc, r) => acc + r.qualityScore, 0) / Math.max(1, restaurants.length);
  console.log(`Restaurants:   ${passed} pass / ${warned} warn / ${failed} fail`);
  console.log(`Avg quality:   ${avgScore.toFixed(1)}/100`);
  console.log(`Synthetic:     ${report.synthetic.length - syntheticFailures} pass / ${syntheticFailures} fail`);

  // ─── Diff against baseline ────────────────────────────────────────
  if (baseline) {
    console.log('\n' + '═'.repeat(60));
    console.log(`DIFF VS BASELINE (${diffInPath})`);
    console.log('═'.repeat(60));
    const byLabel = new Map(restaurants.map((r) => [r.label, r]));
    const baseByLabel = new Map((baseline.restaurants || []).map((r) => [r.label, r]));
    let improved = 0, unchanged = 0, worsened = 0;
    for (const [label, cur] of byLabel) {
      const prev = baseByLabel.get(label);
      if (!prev) { console.log(`  + NEW   ${label} (score ${cur.qualityScore})`); continue; }
      const deltaScore = cur.qualityScore - prev.qualityScore;
      const deltaItems = cur.itemCount - prev.itemCount;
      if (deltaScore > 0 || deltaItems > 5) {
        improved++;
        console.log(`  ↑ IMPROVED   ${label}  score ${prev.qualityScore}→${cur.qualityScore}  items ${prev.itemCount}→${cur.itemCount}`);
      } else if (deltaScore < 0 || deltaItems < -5) {
        worsened++;
        console.log(`  ↓ WORSENED   ${label}  score ${prev.qualityScore}→${cur.qualityScore}  items ${prev.itemCount}→${cur.itemCount}`);
      } else {
        unchanged++;
      }
    }
    console.log(`\n${improved} improved / ${unchanged} unchanged / ${worsened} worsened`);
  }

  if (baselineOutPath) {
    fs.writeFileSync(baselineOutPath, JSON.stringify(report, null, 2));
    console.log(`\nWrote baseline → ${baselineOutPath}`);
  }

  process.exit(syntheticFailures > 0 ? 1 : 0);
})().catch((e) => {
  console.error('Runner crashed:', e?.message || e);
  process.exit(2);
});
