#!/usr/bin/env node
/**
 * Manual test runner for menuVision.extractMenuFromPhoto.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node server/scripts/testMenuVision.js <path-or-url> [more...]
 *
 *   # Single local file:
 *   node server/scripts/testMenuVision.js ./test-photos/menu1.jpg
 *
 *   # Mix of files and URLs:
 *   node server/scripts/testMenuVision.js \
 *     ./test-photos/menu1.jpg \
 *     https://example.com/menu2.jpg \
 *     ./test-photos/food1.jpg  # negative case — should classify isMenu=false
 *
 *   # All photos in a directory (handy for the 20-photo Phase 2 sample):
 *   node server/scripts/testMenuVision.js ./test-photos
 *
 * For each input it prints:
 *   • isMenu / confidence / section + item counts
 *   • a 5-line preview of the first section's items
 *   • token usage and rough $ cost
 *
 * At the end it prints a roll-up: how many were classified as menus, mean
 * confidence, total spend. Use this to validate the "16/20" Phase 2 assumption
 * before building the rest of the pipeline.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { extractMenuFromPhoto, isConfigured } = require('../menuVision');

// Haiku 4.5 pricing — keep in sync with shared/models.md
const PRICE_INPUT_PER_M = 1.0;
const PRICE_OUTPUT_PER_M = 5.0;

function estimateCostUSD(usage) {
  if (!usage) return 0;
  const input = (usage.input_tokens || 0) / 1_000_000;
  const output = (usage.output_tokens || 0) / 1_000_000;
  return input * PRICE_INPUT_PER_M + output * PRICE_OUTPUT_PER_M;
}

function expandInputs(args) {
  const out = [];
  for (const arg of args) {
    if (/^https?:\/\//i.test(arg)) {
      out.push(arg);
      continue;
    }
    const abs = path.resolve(process.cwd(), arg);
    if (!fs.existsSync(abs)) {
      console.warn(`[skip] not found: ${arg}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(abs).sort()) {
        if (/\.(jpe?g|png|webp)$/i.test(f)) out.push(path.join(abs, f));
      }
    } else {
      out.push(abs);
    }
  }
  return out;
}

function shortLabel(input) {
  if (/^https?:\/\//i.test(input)) {
    try { return new URL(input).pathname.split('/').pop() || input; } catch { return input; }
  }
  return path.basename(input);
}

function previewItems(sections, n = 5) {
  const lines = [];
  outer: for (const s of sections) {
    for (const it of s.items) {
      const price = it.price ? `  ${it.price}` : '';
      lines.push(`     • ${it.name}${price}`);
      if (lines.length >= n) break outer;
    }
  }
  return lines.join('\n');
}

async function main() {
  if (!isConfigured()) {
    console.error('ANTHROPIC_API_KEY is not set. Aborting.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node server/scripts/testMenuVision.js <path-or-url> [more...]');
    process.exit(1);
  }

  const inputs = expandInputs(args);
  if (inputs.length === 0) {
    console.error('No usable inputs after expansion.');
    process.exit(1);
  }

  console.log(`Testing ${inputs.length} image(s) against claude-haiku-4-5\n`);

  const results = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const label = shortLabel(input);
    const idx = `[${i + 1}/${inputs.length}]`;
    process.stdout.write(`${idx} ${label} ... `);

    const t0 = Date.now();
    const result = await extractMenuFromPhoto(input);
    const ms = Date.now() - t0;

    if (!result) {
      console.log(`FAILED (${ms}ms)`);
      results.push({ label, ok: false, ms });
      continue;
    }

    const itemCount = result.sections.reduce((n, s) => n + s.items.length, 0);
    const cost = estimateCostUSD(result.usage);
    console.log(
      `isMenu=${result.isMenu} conf=${result.confidence.toFixed(2)} ` +
        `sections=${result.sections.length} items=${itemCount} ${ms}ms $${cost.toFixed(4)}`,
    );

    if (result.isMenu && result.sections.length > 0) {
      console.log(previewItems(result.sections));
    }

    results.push({
      label,
      ok: true,
      ms,
      isMenu: result.isMenu,
      confidence: result.confidence,
      sectionCount: result.sections.length,
      itemCount,
      cost,
    });
  }

  // ── Roll-up ──
  console.log('\n──────── Summary ────────');
  const ok = results.filter((r) => r.ok);
  const menus = ok.filter((r) => r.isMenu && r.itemCount >= 3);
  const totalCost = ok.reduce((sum, r) => sum + (r.cost || 0), 0);
  const meanConf = menus.length
    ? menus.reduce((s, r) => s + r.confidence, 0) / menus.length
    : 0;
  const meanItems = menus.length
    ? menus.reduce((s, r) => s + r.itemCount, 0) / menus.length
    : 0;
  const meanMs = ok.length ? ok.reduce((s, r) => s + r.ms, 0) / ok.length : 0;

  console.log(`Attempted:           ${results.length}`);
  console.log(`API succeeded:       ${ok.length}`);
  console.log(`Classified as menu:  ${menus.length} (≥3 items)`);
  console.log(`Mean confidence:     ${meanConf.toFixed(2)} (menus only)`);
  console.log(`Mean items/menu:     ${meanItems.toFixed(1)}`);
  console.log(`Mean latency:        ${meanMs.toFixed(0)}ms`);
  console.log(`Total spend:         $${totalCost.toFixed(4)}`);
  console.log(`Per-photo avg:       $${ok.length ? (totalCost / ok.length).toFixed(4) : '0.0000'}`);

  // Hint at the Phase 2 go/no-go decision.
  const hitRate = results.length ? menus.length / results.length : 0;
  console.log('');
  if (hitRate >= 0.8) {
    console.log(`✅ Hit rate ${(hitRate * 100).toFixed(0)}% — ship Phase 3+.`);
  } else if (hitRate >= 0.5) {
    console.log(`⚠️  Hit rate ${(hitRate * 100).toFixed(0)}% — try Sonnet retry path on low-confidence images before scaling.`);
  } else {
    console.log(`❌ Hit rate ${(hitRate * 100).toFixed(0)}% — rethink before building the queue.`);
  }
}

main().catch((e) => {
  console.error('test runner crashed:', e);
  process.exit(1);
});
