/**
 * Vision-based menu extractor via Claude Haiku 4.5.
 *
 *   extractMenuFromPhoto(input, opts) → {isMenu, confidence, sections} | null
 *
 * Used as the late-stage fallback in the menu pipeline, slotted BEFORE the
 * review-LLM extractor and AFTER all scraping attempts. One Claude call does
 * three things at once:
 *   1. Decides whether the photo is actually a menu (vs. food / interior).
 *   2. OCRs the text.
 *   3. Structures it into sections + items + prices.
 *
 * Returns null when:
 *   - ANTHROPIC_API_KEY is unset
 *   - the input can't be loaded
 *   - the API call fails (network / 4xx / 5xx / timeout / invalid JSON)
 *   - the model returned no valid sections
 *
 * Phase 2 of the Google-photo-OCR rollout: this module is callable directly
 * via scripts/testMenuVision.js so we can validate accuracy on real photos
 * before wiring it into the live menu resolver.
 *
 * Cost (Haiku 4.5: $1/1M input, $5/1M output, vision ~1.6k tokens per 1MP):
 *   ~$0.004–0.008 per photo depending on size and menu length.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const REQUEST_TIMEOUT_MS = 30000;          // vision is slower than text
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // Anthropic per-image limit

if (!ANTHROPIC_API_KEY) {
  console.log('[menuVision] ANTHROPIC_API_KEY not set — extractor will return null');
}

// ─── Cache ─────────────────────────────────────────────────────────────────

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

function cacheKeyFor(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { ts: Date.now(), value });
}

// ─── Input resolution ──────────────────────────────────────────────────────
// Accept either a URL (Claude fetches) or a local file path (we base64-encode).

function mediaTypeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg'; // .jpg, .jpeg, anything else
}

function resolveImageBlock(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('input must be a non-empty string (URL or file path)');
  }

  if (/^https?:\/\//i.test(input)) {
    return {
      type: 'image',
      source: { type: 'url', url: input },
      _cacheKey: cacheKeyFor(input),
    };
  }

  // Treat as file path.
  const abs = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`not a file: ${abs}`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`image too large: ${stat.size} bytes (limit ${MAX_IMAGE_BYTES})`);
  }
  const buf = fs.readFileSync(abs);
  const data = buf.toString('base64');
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaTypeFromExt(abs),
      data,
    },
    _cacheKey: cacheKeyFor(`file:${abs}:${stat.size}:${stat.mtimeMs}`),
  };
}

// ─── Prompt + schema ───────────────────────────────────────────────────────

const SYSTEM = `You extract restaurant menus from photos.

First decide: is this image a MENU (printed menu, blackboard menu, multi-page menu)?
- YES if it shows dish names, sections, or prices laid out as a menu.
- NO if it's a dish photo, the dining room, the storefront, a wine bottle, etc.

If NO: return {isMenu: false, confidence: <0.0-1.0>, sections: []}.

If YES, extract the menu as JSON:
{isMenu: true, confidence: <how clearly you could read it, 0.0-1.0>,
 sections: [{title, items: [{name, description?, price?, tags?}]}]}

Rules:
- Preserve section headers exactly as printed ("Small Plates", "Pizza", "Bar").
- name: dish name as printed, trimmed, no leading bullets or numbering.
- description: only when the menu itself lists ingredients/notes under the dish. NEVER invent.
- price: as printed ("$12", "12.", "12.50", "MP" / "market price"). Omit if not visible.
- tags: only when the menu explicitly marks dietary or spice info:
   "V" or vegan symbol → "vegan"
   "VG" or vegetarian symbol → "vegetarian"
   "GF" → "gluten-free"
   "DF" → "dairy-free"
   spice icons (🌶, *) → "spicy"
   Omit otherwise.
- Skip: add-on/modifier lines (extra cheese, half/full, mild/hot), price-only rows,
  operational text ("ask your server", "ALL items served with..."), allergy
  disclaimers, hours, social handles.
- If the menu is partially cut off / blurry / glare-covered, still extract what
  you can read confidently and lower the confidence score accordingly.
- If you cannot read enough to produce at least 3 items, return isMenu: true,
  sections: [], and a low confidence score.

Title-case section titles. Keep dish names exactly as printed.`;

const SCHEMA = {
  type: 'object',
  properties: {
    isMenu: { type: 'boolean' },
    confidence: { type: 'number' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                price: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
              },
              required: ['name'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['isMenu', 'confidence', 'sections'],
  additionalProperties: false,
};

// ─── API call ──────────────────────────────────────────────────────────────

async function callClaudeVision(imageBlock) {
  if (!ANTHROPIC_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const userContent = [
    // Strip the internal _cacheKey before sending.
    { type: imageBlock.type, source: imageBlock.source },
    { type: 'text', text: 'Extract the menu from this photo per the rules.' },
  ];

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: userContent }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[menuVision] non-200', res.status, body.slice(0, 400));
      return null;
    }

    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock?.text) return null;

    try {
      return {
        parsed: JSON.parse(textBlock.text),
        usage: data.usage || null,
      };
    } catch (e) {
      console.warn('[menuVision] parse error', e?.message);
      return null;
    }
  } catch (e) {
    if (e?.name === 'AbortError') console.warn('[menuVision] request timeout');
    else console.warn('[menuVision] fetch error', e?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Normalization ─────────────────────────────────────────────────────────

function normalizeSections(rawSections) {
  if (!Array.isArray(rawSections)) return [];
  return rawSections
    .map((s) => ({
      title: typeof s?.title === 'string' && s.title.trim() ? s.title.trim() : 'Menu',
      items: Array.isArray(s?.items)
        ? s.items
            .filter((it) => it && typeof it.name === 'string' && it.name.trim())
            .map((it) => ({
              name: it.name.trim(),
              description:
                typeof it.description === 'string' && it.description.trim()
                  ? it.description.trim()
                  : null,
              price:
                typeof it.price === 'string' && it.price.trim() ? it.price.trim() : null,
              tags:
                Array.isArray(it.tags) && it.tags.length
                  ? it.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
                  : null,
              photoUrl: null,
            }))
        : [],
    }))
    .filter((s) => s.items.length > 0);
}

// ─── Public ────────────────────────────────────────────────────────────────

/**
 * Extract a menu from a single photo.
 *
 * @param {string} input  URL (http/https) or local file path.
 * @param {object} [opts]
 * @returns {Promise<null | {
 *   isMenu: boolean,
 *   confidence: number,
 *   sections: Array<{title: string, items: Array<{name, description, price, tags, photoUrl}>}>,
 *   usage: object | null,
 * }>}
 */
async function extractMenuFromPhoto(input, _opts = {}) {
  if (!ANTHROPIC_API_KEY) return null;

  let imageBlock;
  try {
    imageBlock = resolveImageBlock(input);
  } catch (e) {
    console.warn('[menuVision] could not load input', e?.message);
    return null;
  }

  const cached = getCached(imageBlock._cacheKey);
  if (cached !== undefined) return cached;

  const result = await callClaudeVision(imageBlock);
  if (!result) {
    setCached(imageBlock._cacheKey, null);
    return null;
  }

  const { parsed, usage } = result;
  const isMenu = parsed?.isMenu === true;
  const confidence =
    typeof parsed?.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  const sections = isMenu ? normalizeSections(parsed?.sections) : [];

  const value = { isMenu, confidence, sections, usage };
  setCached(imageBlock._cacheKey, value);
  return value;
}

module.exports = {
  extractMenuFromPhoto,
  isConfigured: () => !!ANTHROPIC_API_KEY,
};
