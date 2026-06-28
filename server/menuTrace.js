/**
 * Structured menu-ingestion trace.
 *
 * Replaces the previous scattered `console.log('[BiteRight] menu: …')`
 * calls with a single trace builder per request. Every stage of the
 * ingestion pipeline reports through this object — cache lookup, website
 * fetch, provider parse, link discovery, candidate scrape, PDF download,
 * Vision OCR, Puppeteer render. Each entry records:
 *
 *   - stage      — short label ("cache", "fetch_website", "provider_parse",
 *                  "link_discovery", "candidate_scrape", "pdf_pipeline",
 *                  "page_images_ocr", "puppeteer", "google_photos",
 *                  "review_llm", …)
 *   - status     — 'ok' | 'fail' | 'skip'
 *   - details    — small JSON object with anything useful for debugging
 *                  (URL, item counts, parser name, sourcePlatform, …)
 *   - timestamp  — ms since trace start (helps spot slow stages)
 *
 * At the end of the request the trace is:
 *   1. Emitted as a single readable multi-line log so we can grep one
 *      blob per request instead of hunting through interleaved lines.
 *   2. Returned to the client on the menu response when the extraction
 *      fails — so "No menu available" is never silent; the API carries
 *      `diagnostic.stages[]` + `diagnostic.summary` explaining exactly
 *      which strategies were tried and why each one fell through.
 *
 * The trace is small (<5KB JSON for the worst cases) and only attached
 * to fail/empty responses by default — successful menu responses don't
 * need it.
 */

const STATUS_GLYPH = { ok: '✓', fail: '✗', skip: '∘' };

class MenuTrace {
  constructor(meta = {}) {
    this.startedAt = Date.now();
    this.meta = meta;             // { restaurantId, restaurantName, websiteUrl, … }
    this.stages = [];
  }

  /**
   * Record a stage. `details` is folded into the log line — keep it
   * lightweight (URLs, counts, source labels, error messages).
   */
  add(stage, status, details = {}) {
    if (!STATUS_GLYPH[status]) status = 'fail';
    const entry = {
      stage,
      status,
      elapsedMs: Date.now() - this.startedAt,
      details: details || {},
    };
    this.stages.push(entry);
    return entry;
  }

  ok(stage, details)    { return this.add(stage, 'ok', details); }
  fail(stage, details)  { return this.add(stage, 'fail', details); }
  skip(stage, details)  { return this.add(stage, 'skip', details); }

  /** Internal `restaurantId`/`websiteUrl` etc. for the log header. */
  setMeta(patch) {
    this.meta = { ...this.meta, ...patch };
    return this;
  }

  /**
   * Single multi-line log blob. Stable shape so log aggregators can
   * filter to '[BiteRight][MenuPipeline]' once and see every stage.
   */
  toLog() {
    const lines = [];
    lines.push(`[BiteRight][MenuPipeline] start ${JSON.stringify(this.meta)}`);
    for (const s of this.stages) {
      const glyph = STATUS_GLYPH[s.status] || '?';
      const detail = Object.keys(s.details || {}).length
        ? ` ${JSON.stringify(s.details)}`
        : '';
      lines.push(`  ${glyph} ${s.stage} (+${s.elapsedMs}ms)${detail}`);
    }
    lines.push(`[BiteRight][MenuPipeline] end (${this.stages.length} stages, ${Date.now() - this.startedAt}ms)`);
    return lines.join('\n');
  }

  /**
   * Compact JSON payload suitable for embedding in an API response. We
   * cap detail strings so a runaway error message can't bloat the
   * response.
   */
  toDiagnostic() {
    const truncate = (v) => {
      if (typeof v !== 'string') return v;
      return v.length > 240 ? `${v.slice(0, 240)}…` : v;
    };
    const compactDetails = (obj) => {
      const out = {};
      for (const [k, v] of Object.entries(obj || {})) out[k] = truncate(v);
      return out;
    };
    return {
      summary: this.summary(),
      stages: this.stages.map((s) => ({
        stage: s.stage,
        status: s.status,
        elapsedMs: s.elapsedMs,
        details: compactDetails(s.details),
      })),
      totalMs: Date.now() - this.startedAt,
      meta: this.meta,
    };
  }

  /**
   * One-line human summary — the FIRST failure or the LAST success.
   * Used as the "Menu unavailable because…" surfaced to the dev/admin.
   */
  summary() {
    if (this.stages.length === 0) return 'no stages recorded';
    const success = this.stages.filter((s) => s.status === 'ok');
    const fail = this.stages.filter((s) => s.status === 'fail');
    if (success.length > 0) {
      const last = success[success.length - 1];
      return `succeeded at ${last.stage}`;
    }
    if (fail.length > 0) {
      const first = fail[0];
      const reason = first.details?.reason || first.details?.error || 'no reason';
      return `${first.stage} failed: ${reason}`;
    }
    return 'no successful or failing stages';
  }
}

function createTrace(meta) { return new MenuTrace(meta); }

module.exports = { MenuTrace, createTrace };
