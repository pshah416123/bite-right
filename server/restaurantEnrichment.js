/**
 * Google Places enrichment: resolve place_id from name + location hints.
 * Used for lazy backfill and the backfill CLI script.
 */

/**
 * @param {import('axios').AxiosInstance} axios
 * @param {string} apiKey
 * @param {string} input
 * @param {number|undefined} lat
 * @param {number|undefined} lng
 * @returns {Promise<string|null>}
 */
async function googleFindPlaceFromText(axios, apiKey, input, lat, lng) {
  if (!apiKey || !input || typeof input !== 'string' || !input.trim()) return null;
  const url = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
  const params = {
    input: input.trim(),
    inputtype: 'textquery',
    fields: 'place_id,name,geometry',
    key: apiKey,
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    params.locationbias = `circle:2500@${lat},${lng}`;
  }
  try {
    const { data } = await axios.get(url, { params, timeout: 12000 });
    if (data.status !== 'OK' || !data.candidates?.length) {
      return null;
    }
    return data.candidates[0].place_id || null;
  } catch (e) {
    console.warn('[BiteRight][Enrich] findplacefromtext failed:', e.message);
    return null;
  }
}

/**
 * @param {{ name?: string; neighborhood?: string; city?: string; address?: string }} stat
 */
function buildEnrichmentQuery(stat) {
  const city = stat.city || 'Chicago';
  const state = stat.state || 'IL';
  const parts = [stat.name, stat.neighborhood, stat.address].filter((x) => x && String(x).trim());
  if (parts.length === 0) return '';
  const q = parts.join(' ');
  if (!/\b(IL|Chicago|NY|CA)\b/i.test(q)) {
    return `${q} ${city} ${state}`;
  }
  return q;
}

/**
 * @param {Record<string, unknown>} payload
 */
function logRestaurantImageResolution(payload) {
  console.log('[BiteRight][RestaurantImage]', payload);
}

module.exports = {
  googleFindPlaceFromText,
  buildEnrichmentQuery,
  logRestaurantImageResolution,
};
