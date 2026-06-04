#!/usr/bin/env node
/**
 * Scan restaurant_menus cache for entries that match the failure
 * patterns the Zuzu fix targeted. Useful to validate whether the
 * parser change is likely to improve, leave alone, or regress
 * existing rows.
 *
 * Patterns flagged:
 *   - PDF-sourced menus (source_type='pdf')
 *   - Multi-column-shaped PDFs (>20 sections OR avg items/section < 2)
 *   - High ALL-CAPS section names (>30% of section titles are all-caps)
 *   - Sections with ≤1 item (the bug Zuzu produced)
 *   - Suspiciously few items overall (<5)
 *   - Promotional-language items (validated via menuQuality)
 *
 *   $ node server/scripts/findMenuRiskPatterns.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { validateMenu } = require('../tests/menuQuality');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function isAllCapsTitle(title) {
  const s = String(title || '').trim();
  return (
    s.length >= 3 &&
    s.length <= 60 &&
    /^[A-Z0-9 &'/\-]+$/.test(s) &&
    /[A-Z]/.test(s) &&
    !/\d{2,}/.test(s)
  );
}

(async () => {
  console.log('Scanning restaurant_menus cache for risk patterns…\n');

  const { data: rows, error } = await sb
    .from('restaurant_menus')
    .select('restaurant_id, source_type, source_url, pdf_url, structured_data, quality_score, scrape_status, last_scraped_at')
    .eq('scrape_status', 'success')
    .limit(5000);

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  const buckets = {
    pdf: [],
    multiColumnPdf: [],
    highAllCaps: [],
    singleItemSections: [],
    fewItems: [],
    promotional: [],
    eventLanguage: [],
    timeDateHeavy: [],
  };

  let totalScanned = 0;
  for (const row of rows || []) {
    totalScanned++;
    const sections = row.structured_data?.sections || [];
    const items = sections.flatMap((s) => s.items || []);
    const itemCount = items.length;
    const sectionCount = sections.length;
    const allCapsTitles = sections.filter((s) => isAllCapsTitle(s.title)).length;
    const singleItemSecs = sections.filter((s) => (s.items || []).length === 1).length;
    const avgItemsPerSec = sectionCount ? itemCount / sectionCount : 0;

    const ref = {
      id: row.restaurant_id,
      url: row.source_url || row.pdf_url || '',
      source: row.source_type,
      sections: sectionCount,
      items: itemCount,
      lastScraped: row.last_scraped_at,
    };

    if (row.source_type === 'pdf') buckets.pdf.push(ref);
    if (row.source_type === 'pdf' && (sectionCount > 20 || (sectionCount >= 4 && avgItemsPerSec < 2))) {
      buckets.multiColumnPdf.push({ ...ref, avgItemsPerSec: avgItemsPerSec.toFixed(2) });
    }
    if (sectionCount >= 4 && allCapsTitles / sectionCount > 0.3) {
      buckets.highAllCaps.push({ ...ref, allCapsPct: Math.round(allCapsTitles / sectionCount * 100) });
    }
    if (singleItemSecs > 1) {
      buckets.singleItemSections.push({ ...ref, singleItemSecs });
    }
    if (itemCount < 5) {
      buckets.fewItems.push(ref);
    }

    const quality = validateMenu({ sections });
    if (quality.stats.promoCount > quality.stats.foodCount && itemCount >= 3) {
      buckets.promotional.push({ ...ref, promo: quality.stats.promoCount, food: quality.stats.foodCount });
    }
    if (quality.stats.eventPct > 0.3) {
      buckets.eventLanguage.push({ ...ref, eventPct: Math.round(quality.stats.eventPct * 100) });
    }
    if (quality.stats.timeDatePct > 0.2) {
      buckets.timeDateHeavy.push({ ...ref, timeDatePct: Math.round(quality.stats.timeDatePct * 100) });
    }
  }

  console.log(`Scanned: ${totalScanned} successful menu cache rows`);
  console.log('');
  for (const [bucket, items] of Object.entries(buckets)) {
    console.log(`── ${bucket} (${items.length}) ──`);
    for (const it of items.slice(0, 8)) {
      console.log('  ', JSON.stringify(it));
    }
    if (items.length > 8) console.log(`   …+${items.length - 8} more`);
    console.log('');
  }

  // Composite "likely-to-benefit-from-Zuzu-fix" count
  const beneficiaries = new Set([
    ...buckets.singleItemSections.map((b) => b.id),
    ...buckets.highAllCaps.map((b) => b.id),
    ...buckets.promotional.map((b) => b.id),
    ...buckets.eventLanguage.map((b) => b.id),
  ]);
  console.log(`Restaurants that should benefit from the recent parser hardening: ${beneficiaries.size}`);
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
