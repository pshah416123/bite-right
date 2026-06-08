#!/usr/bin/env node
/**
 * Website-extraction failure audit.
 *
 *   $ node server/scripts/auditWebsiteFailures.js
 *
 * Pulls every restaurant_menus row that ended up at 'failed' or
 * 'low_quality' with zero structured items, fetches each restaurant's
 * homepage once, and runs the multi-location detector against it. The
 * goal is to size the recoverable population: how many of our current
 * failures are actually location-selector sites where we could route
 * to the right city page instead of giving up.
 *
 * Reports:
 *   - Total website failures in cache
 *   - Subset with multi-location signals (the pipeline retry would now
 *     catch these on the next scrape)
 *   - Subset with an address-matching candidate URL (would recover with
 *     pickBestLocationUrl)
 *   - Per-domain rollup of the worst offenders
 *
 * Read-only — does not modify the cache. Run periodically as a sanity
 * check after parser changes.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { detectMultiLocationSite, pickBestLocationUrl, tokenizeAddress } = require('../multiLocation');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_KEY in env');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const SCRAPE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function itemCount(structured) {
  if (!structured || !Array.isArray(structured.sections)) return 0;
  return structured.sections.reduce((n, s) => n + (s.items?.length || 0), 0);
}

function domainOf(url) {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return null; }
}

(async () => {
  console.log('Website-extraction failure audit\n' + '═'.repeat(60));

  // 1. Pull every menu row that's failed or yielded zero items.
  const { data: menuRows, error: menuErr } = await sb
    .from('restaurant_menus')
    .select('restaurant_id, source_url, source_type, scrape_status, structured_data')
    .in('scrape_status', ['failed', 'low_quality'])
    .limit(5000);
  if (menuErr) { console.error(menuErr.message); process.exit(1); }

  const failures = (menuRows || []).filter((r) => r.source_url && itemCount(r.structured_data) === 0);
  console.log(`\nCandidate failures: ${failures.length}`);

  // 2. Pull restaurant address context for these IDs so we can pick a URL.
  const ids = [...new Set(failures.map((r) => r.restaurant_id).filter(Boolean))];
  let contextById = new Map();
  if (ids.length > 0) {
    const { data: rRows } = await sb
      .from('restaurants')
      .select('restaurant_id, address, city, state, neighborhood')
      .in('restaurant_id', ids);
    contextById = new Map((rRows || []).map((r) => [r.restaurant_id, r]));
  }

  // 3. Fetch each homepage and run the detector.
  let detected = 0;
  let pickedSomething = 0;
  const byDomain = new Map();
  const samples = [];

  for (let i = 0; i < failures.length; i++) {
    const row = failures[i];
    const host = domainOf(row.source_url);
    if (host) {
      const d = byDomain.get(host) || { total: 0, detected: 0, picked: 0 };
      d.total += 1;
      byDomain.set(host, d);
    }
    let html = null;
    try {
      const { data } = await axios.get(row.source_url, {
        timeout: 10000,
        headers: SCRAPE_HEADERS,
        maxRedirects: 5,
        responseType: 'text',
      });
      if (typeof data === 'string') html = data;
    } catch (err) {
      // Many fails just won't load — that's not a multi-location case.
      continue;
    }
    if (!html) continue;

    const detection = detectMultiLocationSite(html, row.source_url);
    if (!detection.isMultiLocation) continue;
    detected += 1;
    if (host) byDomain.get(host).detected += 1;

    const ctx = contextById.get(row.restaurant_id) || {};
    const picked = pickBestLocationUrl(detection.candidateLinks, ctx);
    if (picked) {
      pickedSomething += 1;
      if (host) byDomain.get(host).picked += 1;
      if (samples.length < 10) {
        samples.push({
          restaurantId: row.restaurant_id,
          city: ctx.city,
          source: row.source_url,
          picked: picked.url,
          score: tokenizeAddress(ctx).length,
        });
      }
    }

    if ((i + 1) % 25 === 0) {
      process.stdout.write(`\r  scanned ${i + 1}/${failures.length}…`);
    }
  }
  process.stdout.write('\n');

  // ── Report ──
  const pct = (n, d) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—';

  console.log(`\n${'═'.repeat(60)}\nRESULTS\n${'═'.repeat(60)}`);
  console.log(`Total website failures audited:           ${failures.length}`);
  console.log(`Multi-location signal detected:           ${detected}  (${pct(detected, failures.length)})`);
  console.log(`Detector picked a matching location URL: ${pickedSomething}  (${pct(pickedSomething, failures.length)})`);

  // Worst offenders by domain
  const ranked = Array.from(byDomain.entries())
    .sort((a, b) => b[1].detected - a[1].detected)
    .filter(([, v]) => v.detected > 0)
    .slice(0, 15);
  if (ranked.length > 0) {
    console.log(`\nTop multi-location domains (detected / total failures on that domain):`);
    for (const [host, v] of ranked) {
      console.log(`  ${host.padEnd(40)} ${v.detected}/${v.total}   picked-URL: ${v.picked}`);
    }
  }

  if (samples.length > 0) {
    console.log(`\nSample resolutions:`);
    for (const s of samples) {
      console.log(`  [${s.restaurantId}] ${s.city || '(no city)'} → ${s.picked}`);
    }
  }

  console.log(`\n${'═'.repeat(60)}\nRECOMMENDATION\n${'═'.repeat(60)}`);
  if (pickedSomething / Math.max(1, failures.length) >= 0.1) {
    console.log(`The new multi-location pipeline step should recover ≥10% of current failures (${pickedSomething}/${failures.length}). Re-run after invalidating these rows.`);
  } else if (detected / Math.max(1, failures.length) >= 0.1) {
    console.log(`Multi-location sites are common (${detected}/${failures.length}) but address-matching is weak — most picks scored zero. Look at the failed candidates to refine pickBestLocationUrl tokenization.`);
  } else {
    console.log(`Multi-location is NOT the dominant failure mode for this corpus. The recoverable slice is small (${detected}/${failures.length}). Look elsewhere (PDF, OCR, popular_dishes) for the next gain.`);
  }
})().catch((e) => { console.error(e?.message || e); process.exit(1); });
