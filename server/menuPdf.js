/**
 * PDF menu pipeline.
 *
 * Pipeline:
 *   1. detectMenuPdfUrls(html, baseUrl) — scan for likely menu PDFs
 *   2. extractMenuFromPdfUrl(url)       — download + pdf-parse + structure
 *
 * Heuristics, not magic. Works well for text-layer PDFs (the majority).
 * Image-only PDFs would need OCR — out of scope for Phase 2.
 */

const axios = require('axios');
// pdf-parse@2 is a complete API rewrite — it exports a `PDFParse` class
// instead of a default function. Calling the old `pdfParse(buf)` shape
// throws TypeError, which our try/catch silently swallowed, so PDF menus
// looked like "discovery works but extraction returns empty" for every
// restaurant. New shape: `new PDFParse({ data: buf }).getText()`.
const { PDFParse } = require('pdf-parse');

const PDF_MAX_BYTES = 5 * 1024 * 1024;     // 5MB cap to avoid abuse
const PDF_FETCH_TIMEOUT_MS = 8000;

const PDF_DOWNLOAD_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/pdf,*/*;q=0.8',
};

// ─── 1. Detect ──────────────────────────────────────────────────────────────

/**
 * Find candidate PDF URLs in HTML, ranked by likelihood of being a real menu.
 * Returns up to 3 absolute URLs.
 */
function detectMenuPdfUrls(html, baseUrl) {
  if (typeof html !== 'string' || !html) return [];
  const candidates = new Map(); // url -> score

  // <a href="...pdf"> with surrounding anchor text
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const anchorText = m[2].replace(/<[^>]+>/g, '').toLowerCase();
    const abs = absoluteUrl(href, baseUrl);
    if (!abs) continue;
    const score = scorePdfCandidate(abs, anchorText);
    if (score <= 0) continue;
    candidates.set(abs, Math.max(candidates.get(abs) || 0, score));
  }

  // <embed src="...pdf"> / <iframe src="...pdf"> — usually the primary menu
  const embedRe = /<(?:embed|iframe)\s+[^>]*src\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi;
  while ((m = embedRe.exec(html)) !== null) {
    const abs = absoluteUrl(m[1], baseUrl);
    if (!abs) continue;
    const score = scorePdfCandidate(abs, '') + 30; // embed bias
    candidates.set(abs, Math.max(candidates.get(abs) || 0, score));
  }

  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([url]) => url);
}

function scorePdfCandidate(url, anchorText) {
  const u = url.toLowerCase();
  const t = anchorText.toLowerCase();
  let score = 10; // baseline for being a PDF link

  // Filename signals
  if (/\bmenu\b/.test(u)) score += 40;
  if (/\bdinner\b/.test(u)) score += 25;
  if (/\blunch\b/.test(u)) score += 20;
  if (/\bbrunch\b/.test(u)) score += 18;
  if (/\bfood\b/.test(u)) score += 15;
  if (/\bdrinks?\b|\bwine\b|\bbeer\b|\bcocktail\b/.test(u)) score += 5; // useful but not primary
  if (/\bcatering\b|\bevent\b|\bprivate\b|\bbuyout\b/.test(u)) score -= 25;
  if (/\bnutrition\b|\ballergens?\b/.test(u)) score -= 30;
  if (/\bcareers?\b|\bjobs?\b|\bemployment\b|\bw2\b/.test(u)) score -= 100;

  // Anchor-text signals
  if (/\bmenu\b/.test(t)) score += 30;
  if (/\bdinner\b/.test(t)) score += 15;
  if (/\bsee our menu\b|\bview menu\b|\bfull menu\b|\bdownload menu\b/.test(t)) score += 25;

  return score;
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

// ─── 2. Download + parse ────────────────────────────────────────────────────

async function downloadPdf(url) {
  try {
    const res = await axios.get(url, {
      timeout: PDF_FETCH_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: PDF_MAX_BYTES,
      maxBodyLength: PDF_MAX_BYTES,
      headers: PDF_DOWNLOAD_HEADERS,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    // Some servers return text/html for redirects we missed; bail.
    if (contentType && !contentType.includes('pdf')) return null;
    const buf = Buffer.from(res.data);
    if (buf.length < 1000) return null; // implausibly small for a menu
    return buf;
  } catch {
    return null;
  }
}

/**
 * Parse extracted PDF text into MenuSection[].
 * Heuristics:
 *   - ALL-CAPS line (≥3 chars, no digits) -> section header
 *   - line ending with $X.XX            -> item + price
 *   - long line right after an item     -> description for that item
 */
function parsePdfTextToSections(text) {
  if (typeof text !== 'string' || text.length < 50) return null;

  // Normalize: keep meaningful newlines; collapse runs of spaces
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim())
    .filter(Boolean);

  if (lines.length < 5) return null;

  const PRICE_LINE_RE = /^(.*?)[\s.…-]+\$?\s*(\d{1,4}(?:\.\d{1,2})?)$/;
  const isAllCaps = (s) =>
    s.length >= 3 && s.length <= 60 &&
    /^[A-Z0-9 &'/-]+$/.test(s) &&
    /[A-Z]/.test(s) &&
    !/\d{2,}/.test(s);
  const NOT_A_DISH_RE =
    /\b(closed|kitchen|opening hours|order online|delivery|takeout|pickup|reservations?|book a table|call us|contact|follow us|visit us|hours|allergen)\b/i;

  const sections = [];
  let current = null;
  const ensureCurrent = (title = 'Menu') => {
    if (!current) {
      current = { title, items: [] };
      sections.push(current);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isAllCaps(line)) {
      // Close current, open a new section keyed off this header.
      current = { title: titleCase(line), items: [] };
      sections.push(current);
      continue;
    }

    const priceMatch = line.match(PRICE_LINE_RE);
    if (priceMatch) {
      const name = priceMatch[1].trim().replace(/[.…-]+$/, '').trim();
      const priceNum = parseFloat(priceMatch[2]);
      if (!name || NOT_A_DISH_RE.test(name) || name.length < 2 || name.length > 80) continue;
      if (!Number.isFinite(priceNum) || priceNum < 1 || priceNum > 500) continue;
      ensureCurrent();
      const item = {
        name,
        description: null,
        price: `$${priceNum.toFixed(2)}`,
        tags: null,
        photoUrl: null,
      };
      // Look ahead: if the next line is sentence-like (lowercase, doesn't match
      // a price, isn't a header), treat it as the description.
      const next = lines[i + 1];
      if (next && !PRICE_LINE_RE.test(next) && !isAllCaps(next) && /[a-z]/.test(next) && next.length > 8 && next.length < 200) {
        item.description = next;
        i++;
      }
      current.items.push(item);
    }
  }

  // Drop sections with no items, and the whole result if it's too thin.
  const cleaned = sections.filter((s) => s.items.length > 0);
  const totalItems = cleaned.reduce((acc, s) => acc + s.items.length, 0);
  if (totalItems < 3) return null;
  return cleaned;
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/**
 * Top-level: download a PDF and return MenuSection[] or null.
 */
async function extractMenuFromPdfUrl(pdfUrl) {
  const buf = await downloadPdf(pdfUrl);
  if (!buf) return null;
  let text = '';
  let pageCount = null;
  let parser;
  try {
    parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    text = result?.text || '';
    pageCount = result?.total ?? (Array.isArray(result?.pages) ? result.pages.length : null);
  } catch (e) {
    console.warn('[menuPdf] parse failed', pdfUrl, e?.message);
    return null;
  } finally {
    try { await parser?.destroy?.(); } catch { /* noop */ }
  }
  const sections = parsePdfTextToSections(text);
  if (!sections) return null;
  return { sections, rawData: { textLength: text.length, pages: pageCount }, source: 'pdf' };
}

module.exports = {
  detectMenuPdfUrls,
  extractMenuFromPdfUrl,
  parsePdfTextToSections, // exported for tests / debugging
};
