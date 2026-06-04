#!/usr/bin/env node
/**
 * Source-quality audit: for every restaurant in cache, compare the
 * confidence + content of our PRIMARY menu source vs the ALTERNATIVES
 * Google already provides (popular_dishes_from_reviews, what-people-
 * are-saying highlights, the menu URL on Google Maps, etc.).
 *
 * Answers:
 *   - How many restaurants currently rely on PDF / OCR / generic scrape?
 *   - How many of those have Google review-mined dish data available?
 *   - In how many cases is the lower-confidence source winning the
 *     current pipeline ranking?
 *
 *   $ node server/scripts/auditMenuSources.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { validateMenu } = require('../tests/menuQuality');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL/KEY in env');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Confidence framework (source-type → 0-100) ────────────────────────
//
// Calibrated from observed extraction quality + structural reliability.
// Higher confidence = lower expected error rate.
const SOURCE_CONFIDENCE = {
  // First-party structured (publisher controls the data shape)
  chain_curated:   95,
  toast:           95,
  popmenu:         92,
  square:          92,
  chownow:         90,
  bentobox:        90,
  spotapps:        88,
  lettuce:         88,
  squarespace:     85,
  squarespace_text:78,
  dine_wp:         82,
  next_data:       85,
  json_ld:         82,
  dom_item_name:   75,
  // Generic / fallback
  wix:             70,
  wordpress:       65,
  generic_scrape:  55,
  yelp_menu:       60,
  // Last-resort extraction
  pdf:             55,
  page_image_ocr:  50,
  google_photo_ocr:45,
  llm:             40,
  photos:          30,
  null:            0,
};

function sourceConfidence(src) {
  return SOURCE_CONFIDENCE[src] ?? 50;
}

(async () => {
  console.log('Source-quality audit\n' + '═'.repeat(60));

  const { data: menuRows, error: menuErr } = await sb
    .from('restaurant_menus')
    .select('restaurant_id, source_type, source_url, structured_data, quality_score, scrape_status, last_scraped_at')
    .limit(5000);
  if (menuErr) { console.error(menuErr.message); process.exit(1); }

  const { data: detailRows, error: detailErr } = await sb
    .from('restaurant_details_cache')
    .select('restaurant_id, popular_dishes')
    .limit(5000);
  if (detailErr) { console.error(detailErr.message); process.exit(1); }

  const detailByRestaurant = new Map();
  for (const d of detailRows || []) detailByRestaurant.set(d.restaurant_id, d);

  // ─── Per-restaurant analysis ─────────────────────────────────────────
  const allRows = (menuRows || []).filter((r) => r.scrape_status === 'success' || r.scrape_status === 'low_quality' || r.scrape_status === 'failed');
  const bySource = {};
  const lowConfidenceAlternatives = [];
  const googleStrongerThanExtraction = [];
  const audit = [];

  for (const row of allRows) {
    const src = row.source_type || 'null';
    const detail = detailByRestaurant.get(row.restaurant_id);
    const pds = detail?.popular_dishes;
    const popularDishCount = Array.isArray(pds) ? pds.length : 0;

    const sections = row.structured_data?.sections || [];
    const items = sections.flatMap((s) => s.items || []);
    const itemCount = items.length;
    const sourceConf = sourceConfidence(src);
    const validation = validateMenu({ sections });
    const finalQuality = Math.round((sourceConf + validation.score) / 2);

    bySource[src] = bySource[src] || { count: 0, withPopular: 0, avgItems: 0, avgQuality: 0, _items: [], _quality: [] };
    bySource[src].count += 1;
    if (popularDishCount > 0) bySource[src].withPopular += 1;
    bySource[src]._items.push(itemCount);
    bySource[src]._quality.push(finalQuality);

    // Flag: a low-confidence source is winning when Google has data
    if (sourceConf < 60 && popularDishCount >= 5) {
      lowConfidenceAlternatives.push({
        id: row.restaurant_id,
        url: row.source_url || '',
        current: src,
        currentConf: sourceConf,
        currentItems: itemCount,
        popularDishCount,
        validationScore: validation.score,
      });
    }

    // Flag: our extraction has <3 valid items but Google's review-mined
    // popular dishes has more — Google would win here.
    if (itemCount < 3 && popularDishCount >= 3) {
      googleStrongerThanExtraction.push({
        id: row.restaurant_id,
        url: row.source_url || '',
        current: src,
        currentItems: itemCount,
        popularDishCount,
      });
    }

    audit.push({
      id: row.restaurant_id,
      currentSource: src,
      currentConf: sourceConf,
      currentItems: itemCount,
      validationScore: validation.score,
      hasPopular: popularDishCount > 0,
      popularDishCount,
    });
  }

  // Compute averages per source
  for (const s of Object.keys(bySource)) {
    const arr = bySource[s];
    arr.avgItems = arr._items.reduce((a, b) => a + b, 0) / arr._items.length;
    arr.avgQuality = arr._quality.reduce((a, b) => a + b, 0) / arr._quality.length;
    delete arr._items; delete arr._quality;
  }

  console.log(`\nTotal cached menu rows: ${allRows.length}`);
  console.log(`Total detail rows (with popular_dishes potential): ${detailRows.length}`);

  console.log(`\nBy current source type:`);
  const sortedSources = Object.entries(bySource).sort((a, b) => b[1].count - a[1].count);
  for (const [src, stats] of sortedSources) {
    const conf = sourceConfidence(src);
    console.log(`  ${src.padEnd(20)} count=${String(stats.count).padStart(3)}  conf=${String(conf).padStart(3)}  avgItems=${stats.avgItems.toFixed(1).padStart(6)}  avgQuality=${stats.avgQuality.toFixed(0).padStart(3)}  withPopular=${stats.withPopular}/${stats.count}`);
  }

  console.log(`\n── Where Google data exceeds our current source ──`);
  console.log(`Low-confidence source (<60) AND popular_dishes ≥ 5: ${lowConfidenceAlternatives.length}`);
  for (const a of lowConfidenceAlternatives.slice(0, 12)) {
    console.log(`  ${a.current.padEnd(16)} items=${a.currentItems}  popularDishes=${a.popularDishCount}  conf=${a.currentConf}  ${a.url.slice(0, 50)}`);
  }
  if (lowConfidenceAlternatives.length > 12) console.log(`   …+${lowConfidenceAlternatives.length - 12} more`);

  console.log(`\nExtraction items < 3 AND popular_dishes ≥ 3 (Google would win): ${googleStrongerThanExtraction.length}`);
  for (const a of googleStrongerThanExtraction.slice(0, 8)) {
    console.log(`  ${a.current.padEnd(16)} items=${a.currentItems}  popularDishes=${a.popularDishCount}  ${a.url.slice(0, 50)}`);
  }
  if (googleStrongerThanExtraction.length > 8) console.log(`   …+${googleStrongerThanExtraction.length - 8} more`);

  // ─── Aggregate impact ────────────────────────────────────────────────
  const total = allRows.length;
  const lowConfSources = ['generic_scrape', 'pdf', 'page_image_ocr', 'google_photo_ocr', 'llm', 'photos'];
  const onLowConf = allRows.filter((r) => lowConfSources.includes(r.source_type)).length;
  const onLowConfWithPopular = allRows.filter((r) => {
    if (!lowConfSources.includes(r.source_type)) return false;
    const d = detailByRestaurant.get(r.restaurant_id);
    return d && Array.isArray(d.popular_dishes) && d.popular_dishes.length >= 3;
  }).length;

  console.log(`\n${'═'.repeat(60)}\nIMPACT SUMMARY\n${'═'.repeat(60)}`);
  console.log(`Restaurants on low-confidence sources (PDF/OCR/generic/photos): ${onLowConf}/${total}  (${(onLowConf/total*100).toFixed(1)}%)`);
  console.log(`  …of which Google popular_dishes has ≥3 items: ${onLowConfWithPopular}/${onLowConf}  (${onLowConf ? (onLowConfWithPopular/onLowConf*100).toFixed(1) : 0}%)`);
  console.log(`Restaurants where Google's popular_dishes already exceeds extracted item count: ${googleStrongerThanExtraction.length}/${total}  (${(googleStrongerThanExtraction.length/total*100).toFixed(1)}%)`);

  // ─── Recommendation ──────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}\nRECOMMENDATION\n${'═'.repeat(60)}`);
  if (googleStrongerThanExtraction.length / total > 0.15) {
    console.log('CHANGE PIPELINE ORDER: ≥15% of restaurants would do better with Google review-mined dishes than our current extraction. Move popular_dishes_from_reviews ahead of the PDF/OCR fallback tier.');
  } else if (onLowConfWithPopular / Math.max(1, onLowConf) > 0.3) {
    console.log('PARTIAL REWORK: a meaningful fraction of low-confidence extractions have viable Google fallback data. Add a confidence-based merge: when extraction yields <N items, augment with popular_dishes.');
  } else {
    console.log('PARSER TUNING WAS THE RIGHT CALL: low-confidence sources don\'t reliably have superior Google alternatives. Continue current pipeline with parser improvements.');
  }
})().catch((e) => { console.error(e?.message || e); process.exit(1); });
