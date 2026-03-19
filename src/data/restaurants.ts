import { NEUTRAL_RESTAURANT_PLACEHOLDER_URI } from '../constants/restaurantMedia';

export interface RestaurantOption {
  id: string;
  name: string;
  neighborhood: string;
  /** State (e.g. "CA") for location display: "Neighborhood, State" */
  state?: string;
  cuisine: string;
  /** Optional: full address for API; UI shows neighborhood, state only. */
  address?: string;
  websiteUrl?: string;
  /** Google Places place_id when enriched (see server/data/restaurantEnrichment.json). */
  googlePlaceId?: string;
  /** Canonical fields for enrichment / display parity with server. */
  city?: string;
  canonicalAddress?: string;
  lat?: number;
  lng?: number;
  /**
   * @deprecated Do not use cuisine-themed or stock food URLs. Prefer API-resolved images.
   * If set, should only be the global neutral placeholder.
   */
  samplePhotoUrl?: string;
}

// 5 Chicago restaurants for Feed + Discover
export const RESTAURANTS: RestaurantOption[] = [
  {
    id: 'rest_1',
    name: "Lou Malnati's",
    neighborhood: 'River North',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Pizza · Deep dish',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_2',
    name: 'Girl & the Goat',
    neighborhood: 'West Loop',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'American · Small plates',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_3',
    name: "Portillo's",
    neighborhood: 'River North',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Hot dogs · Chicago classics',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_4',
    name: 'The Purple Pig',
    neighborhood: 'Magnificent Mile',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Mediterranean · Shared plates',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_5',
    name: 'Au Cheval',
    neighborhood: 'West Loop',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Burgers · American',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  // ---- Temporary location mock restaurants (must stay in sync with Discover mock ids) ----
  {
    id: 'rest_tokyo_1',
    name: 'Sushi Sakura',
    neighborhood: 'Ginza',
    state: 'Tokyo',
    cuisine: 'Sushi · Omakase',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_tokyo_2',
    name: 'Ramen Shogun',
    neighborhood: 'Shinjuku',
    state: 'Tokyo',
    cuisine: 'Ramen · Tonkotsu',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_tokyo_3',
    name: 'Tempura Kyo',
    neighborhood: 'Asakusa',
    state: 'Tokyo',
    cuisine: 'Tempura · Seasonal',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_tokyo_4',
    name: 'Yakiniku Minato',
    neighborhood: 'Ebisu',
    state: 'Tokyo',
    cuisine: 'Yakiniku · Wagyu',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_tokyo_5',
    name: 'Shibuya Street Eats',
    neighborhood: 'Shibuya',
    state: 'Tokyo',
    cuisine: 'Japanese · Izakaya',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_mh_1',
    name: 'Katsu & Co.',
    neighborhood: 'Chelsea',
    state: 'NY',
    city: 'New York',
    cuisine: 'Japanese · Katsu',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_mh_2',
    name: 'Tribeca Ramen',
    neighborhood: 'Tribeca',
    state: 'NY',
    city: 'New York',
    cuisine: 'Ramen · Broth bar',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_mh_3',
    name: 'Saffron & Steak',
    neighborhood: 'Midtown',
    state: 'NY',
    city: 'New York',
    cuisine: 'Steakhouse · Modern',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_mh_4',
    name: 'Little Italy Pizza Lab',
    neighborhood: 'Little Italy',
    state: 'NY',
    city: 'New York',
    cuisine: 'Pizza · Neapolitan',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_mh_5',
    name: 'Smoked Palates',
    neighborhood: 'West Village',
    state: 'NY',
    city: 'New York',
    cuisine: 'BBQ · American',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  // Catch-all Discover mocks for "other" locations.
  {
    id: 'rest_other_1',
    name: 'Signature Kitchen',
    neighborhood: 'Downtown',
    state: '',
    cuisine: 'Modern · Local favorites',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_other_2',
    name: 'Chef’s Table',
    neighborhood: 'Central',
    state: '',
    cuisine: 'Contemporary · Seasonal',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_other_3',
    name: 'Corner Noodles',
    neighborhood: 'Old Town',
    state: '',
    cuisine: 'Noodles · Comfort',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_other_4',
    name: 'The Social Table',
    neighborhood: 'Market District',
    state: '',
    cuisine: 'Shared plates · Crowd-pleaser',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
  {
    id: 'rest_other_5',
    name: 'Fire & Spice',
    neighborhood: 'Harbor',
    state: '',
    cuisine: 'Global · Spiced bowls',
    samplePhotoUrl: NEUTRAL_RESTAURANT_PLACEHOLDER_URI,
  },
];

export function searchRestaurants(query: string): RestaurantOption[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  return RESTAURANTS.filter(
    (r) =>
      r.name.toLowerCase().includes(lower) ||
      r.cuisine.toLowerCase().includes(lower) ||
      r.neighborhood.toLowerCase().includes(lower),
  ).slice(0, 8);
}

/**
 * @deprecated Use getNeutralRestaurantPlaceholderUri from ~/src/utils/restaurantImage.
 * Kept for call sites that still expect a per-id function; returns neutral only (no cuisine stock).
 */
export function getFallbackRestaurantPhoto(_restaurantId: string): string | undefined {
  return NEUTRAL_RESTAURANT_PLACEHOLDER_URI;
}
