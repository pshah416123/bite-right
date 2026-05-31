/**
 * LLM-based extractors via Claude Haiku 4.5.
 *
 * Two functions, both used as upgrades / fallbacks to the regex pipeline:
 *
 *   extractDishesWithLLM(reviews, restaurantId)
 *     Returns [{name, mentionCount}] — replaces the regex
 *     extractPopularDishesFromReviews when an API key is configured. Much
 *     better at:
 *       - chef-y proper-noun dishes ("the Genovese")
 *       - multi-word dishes with no anchor keyword
 *       - collapsing generic + specific into one entry ("Pizza" + "Deep Dish
 *         Pizza" → "Deep Dish Pizza" with summed counts)
 *
 *   extractMenuFromReviewsWithLLM(reviews, cuisine, restaurantId)
 *     Returns [{title, items: [{name, description?, price, tags, photoUrl}]}]
 *     — used as the final fallback when every menu extractor (provider
 *     parsers, PDF, generic scrape) has returned nothing. Inferred from
 *     review text, conservative — only mentions actual dishes.
 *
 * Both return null when:
 *   - ANTHROPIC_API_KEY is unset (so the rest of the app keeps working
 *     without the key, just falling back to the regex extractor)
 *   - the API call fails for any reason (network, 401, 429, timeout, 5xx)
 *   - the model returns an empty/invalid result
 * Callers must handle null and fall back to the regex path.
 *
 * Caching: application-level, in-memory, keyed by restaurantId + sha256 of
 * the review text. Haiku 4.5's prompt-cache minimum is 4096 tokens, larger
 * than our system prompts, so Anthropic's prompt caching wouldn't trigger
 * here. Skipping the API call entirely on cache hits is cheaper anyway.
 *
 * Cost (Haiku 4.5: $1/1M input, $5/1M output):
 *   ~$0.001 per restaurant for dish extraction
 *   ~$0.002 per restaurant for menu inference
 *   Combined: ~$30 for 10k restaurants, one-time per review-set change.
 */

const crypto = require('crypto');

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const REQUEST_TIMEOUT_MS = 12000;

if (!ANTHROPIC_API_KEY) {
  console.log('[menuLlm] ANTHROPIC_API_KEY not set — LLM extractors will return null (regex fallbacks apply)');
}

// In-memory cache. Keyed by `${tag}:${restaurantId}:${reviewHash}`.
// 24h TTL — reviews don't change often, and Google reviews refresh slowly.
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;

function buildCacheKey(tag, restaurantId, payload) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  return `${tag}:${restaurantId}:${hash}`;
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
  // Simple LRU-ish: when at capacity, drop oldest entries by insertion order.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { ts: Date.now(), value });
}

// Single API call helper. Uses output_config.format with a JSON schema so the
// response is guaranteed to be valid JSON matching the shape we expect.
async function callClaude({ system, user, schema, maxTokens }) {
  if (!ANTHROPIC_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema } },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[menuLlm] non-200', res.status, body.slice(0, 300));
      return null;
    }

    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock?.text) return null;

    try {
      return JSON.parse(textBlock.text);
    } catch (e) {
      console.warn('[menuLlm] parse error', e?.message);
      return null;
    }
  } catch (e) {
    if (e?.name === 'AbortError') console.warn('[menuLlm] request timeout');
    else console.warn('[menuLlm] fetch error', e?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Dish extraction ────────────────────────────────────────────────────────

const DISH_SYSTEM = `You extract dish names that diners specifically mention from restaurant reviews.

Rules:
- Return only DISH NAMES — not generic terms like "food", "appetizers", "drinks", "menu", "everything".
- Combine near-duplicate variants: "Deep Dish" and "Deep-Dish Pizza" → "Deep Dish Pizza" (prefer the more specific name).
- Combine generic + specific: if reviews mention both "pizza" and "deep dish pizza", return one entry with the specific name and the combined mention count.
- Title-case each dish (e.g., "Spicy Tuna Roll", "Lamb Biryani", "Cacio e Pepe").
- Order by mentionCount, descending. Return at most 5 dishes.
- mentionCount = your best estimate of how many distinct reviewers mentioned that dish.

If reviews don't mention specific dishes, return an empty dishes array — don't fabricate.`;

const DISH_SCHEMA = {
  type: 'object',
  properties: {
    dishes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          mentionCount: { type: 'integer' },
        },
        required: ['name', 'mentionCount'],
        additionalProperties: false,
      },
    },
  },
  required: ['dishes'],
  additionalProperties: false,
};

async function extractDishesWithLLM(reviews, restaurantId) {
  if (!ANTHROPIC_API_KEY) return null;
  if (!Array.isArray(reviews) || reviews.length === 0) return null;

  const texts = reviews
    .map((r) => (typeof r?.text === 'string' ? r.text.trim() : ''))
    .filter(Boolean)
    .slice(0, 5);
  if (texts.length === 0) return null;

  const key = buildCacheKey('dishes', restaurantId || 'anon', texts);
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const userMsg = texts.map((t, i) => `Review ${i + 1}:\n${t}`).join('\n\n');

  const result = await callClaude({
    system: DISH_SYSTEM,
    user: userMsg,
    schema: DISH_SCHEMA,
    maxTokens: 800,
  });

  if (!result || !Array.isArray(result.dishes)) {
    setCached(key, null);
    return null;
  }

  const dishes = result.dishes
    .filter((d) => d && typeof d.name === 'string' && d.name.trim())
    .map((d) => ({
      name: d.name.trim(),
      mentionCount: typeof d.mentionCount === 'number' ? Math.max(1, Math.floor(d.mentionCount)) : 1,
    }))
    .slice(0, 5);

  const value = dishes.length > 0 ? dishes : null;
  setCached(key, value);
  return value;
}

// ─── Menu inference (last-resort fallback) ──────────────────────────────────

const MENU_SYSTEM = `You infer a plausible menu from restaurant reviews. This is used ONLY as a fallback when no real menu could be scraped from the restaurant's website.

Rules:
- Only include dishes EXPLICITLY MENTIONED or STRONGLY IMPLIED by reviews. Do not invent.
- Group dishes into sensible sections (Appetizers, Entrees, Desserts, Drinks, etc.).
- Be conservative: 5-10 high-confidence items beats 20 speculative ones.
- Include a short description ONLY when reviews describe the dish; otherwise omit description.
- Title-case dish names. Do not include prices (we don't know them).
- If reviews don't describe enough dishes for a useful menu, return an empty sections array.`;

const MENU_SCHEMA = {
  type: 'object',
  properties: {
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
  required: ['sections'],
  additionalProperties: false,
};

async function extractMenuFromReviewsWithLLM(reviews, cuisine, restaurantId) {
  if (!ANTHROPIC_API_KEY) return null;
  if (!Array.isArray(reviews) || reviews.length === 0) return null;

  const texts = reviews
    .map((r) => (typeof r?.text === 'string' ? r.text.trim() : ''))
    .filter(Boolean)
    .slice(0, 5);
  if (texts.length === 0) return null;

  const key = buildCacheKey('menu', restaurantId || 'anon', { texts, cuisine });
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const userMsg =
    `Cuisine type: ${cuisine || 'unknown'}\n\n` +
    texts.map((t, i) => `Review ${i + 1}:\n${t}`).join('\n\n');

  const result = await callClaude({
    system: MENU_SYSTEM,
    user: userMsg,
    schema: MENU_SCHEMA,
    maxTokens: 1500,
  });

  if (!result || !Array.isArray(result.sections) || result.sections.length === 0) {
    setCached(key, null);
    return null;
  }

  // Normalize to the MenuSection[] shape the rest of the pipeline expects.
  const sections = result.sections
    .map((s) => ({
      title: (s.title || 'Menu').trim() || 'Menu',
      items: (s.items || [])
        .filter((it) => it && typeof it.name === 'string' && it.name.trim())
        .map((it) => ({
          name: it.name.trim(),
          description: typeof it.description === 'string' && it.description.trim() ? it.description.trim() : null,
          price: null,
          tags: null,
          photoUrl: null,
        })),
    }))
    .filter((s) => s.items.length > 0);

  const value = sections.length > 0 ? sections : null;
  setCached(key, value);
  return value;
}

module.exports = {
  extractDishesWithLLM,
  extractMenuFromReviewsWithLLM,
  isConfigured: () => !!ANTHROPIC_API_KEY,
};
