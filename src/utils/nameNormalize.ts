/**
 * Restaurant name normalization for fuzzy matching.
 * Handles case, punctuation, suffixes, and common variations.
 */

/** Strip to lowercase alphanumeric + spaces, collapse whitespace. */
export function normalizeRestaurantName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[''`]/g, '')           // curly/straight apostrophes
    .replace(/[^a-z0-9\s]/g, ' ')   // punctuation → space
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

/** Check if two restaurant names are likely the same place. */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeRestaurantName(a);
  const nb = normalizeRestaurantName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // One contains the other (handles suffix differences like "Bar & Grill")
  if (na.includes(nb) || nb.includes(na)) return true;

  // Token-overlap: if 80%+ of shorter's tokens appear in longer
  const tokensA = na.split(' ').filter(Boolean);
  const tokensB = nb.split(' ').filter(Boolean);
  const [shorter, longer] = tokensA.length <= tokensB.length
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  if (shorter.length === 0) return false;

  const longerSet = new Set(longer);
  const overlap = shorter.filter((t) => longerSet.has(t)).length;
  return overlap / shorter.length >= 0.8;
}
