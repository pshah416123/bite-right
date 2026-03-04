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
  googlePlaceId?: string;
  samplePhotoUrl?: string; // used as a stand‑in until real photo fetch is wired
}

// 5 Chicago restaurants for Feed + Discover
export const RESTAURANTS: RestaurantOption[] = [
  {
    id: 'rest_1',
    name: "Lou Malnati's",
    neighborhood: 'River North',
    state: 'IL',
    cuisine: 'Pizza · Deep dish',
    samplePhotoUrl: 'https://placehold.co/800x600/e5e7eb/6b7280?text=No+photo',
  },
  {
    id: 'rest_2',
    name: 'Girl & the Goat',
    neighborhood: 'West Loop',
    state: 'IL',
    cuisine: 'American · Small plates',
    samplePhotoUrl:
      'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
  {
    id: 'rest_3',
    name: "Portillo's",
    neighborhood: 'River North',
    state: 'IL',
    cuisine: 'Hot dogs · Chicago classics',
    samplePhotoUrl:
      'https://images.pexels.com/photos/461198/pexels-photo-461198.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
  {
    id: 'rest_4',
    name: 'The Purple Pig',
    neighborhood: 'Magnificent Mile',
    state: 'IL',
    cuisine: 'Mediterranean · Shared plates',
    samplePhotoUrl:
      'https://images.pexels.com/photos/4194626/pexels-photo-4194626.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
  {
    id: 'rest_5',
    name: 'Au Cheval',
    neighborhood: 'West Loop',
    state: 'IL',
    cuisine: 'Burgers · American',
    samplePhotoUrl:
      'https://images.pexels.com/photos/1639557/pexels-photo-1639557.jpeg?auto=compress&cs=tinysrgb&w=800',
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

// Placeholder for later: fetch photo from restaurant website or Google Places.
// For now we return a curated sample photo if available.
export function getFallbackRestaurantPhoto(restaurantId: string): string | undefined {
  const r = RESTAURANTS.find((rest) => rest.id === restaurantId);
  return r?.samplePhotoUrl;
}

