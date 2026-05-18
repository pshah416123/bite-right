import { NEUTRAL_RESTAURANT_PLACEHOLDER_URI } from '../constants/restaurantMedia';
import type { RestaurantDisplayImageSourceType, RestaurantIdentity } from '../types/restaurant';

export interface RestaurantOption extends RestaurantIdentity {
  neighborhood: string;
  state?: string;
  city?: string | null;
  cuisine: string;
  address?: string | null;
  websiteUrl?: string;
  googlePlaceId?: string | null;
  canonicalAddress?: string;
  lat: number;
  lng: number;
  displayImageUrl?: string | null;
  displayImageSourceType?: RestaurantDisplayImageSourceType | null;
  displayImageLastResolvedAt?: string | null;
  /**
   * @deprecated Do not use cuisine-themed or stock food URLs. Prefer API-resolved images.
   * If set, should only be the global neutral placeholder.
   */
  samplePhotoUrl?: string;
}

function restaurant(input: RestaurantOption): RestaurantOption {
  return {
    ...input,
    googlePlaceId: input.googlePlaceId ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    displayImageUrl: input.displayImageUrl ?? null,
    displayImageSourceType: input.displayImageSourceType ?? null,
    displayImageLastResolvedAt: input.displayImageLastResolvedAt ?? null,
  };
}

export const RESTAURANTS: RestaurantOption[] = [
  restaurant({
    id: 'rest_1',
    name: "Lou Malnati's",
    neighborhood: 'River North',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Pizza · Deep dish',
    address: '439 N Wells St, Chicago, IL',
    lat: 41.8902,
    lng: -87.6369,
  }),
  restaurant({
    id: 'rest_2',
    name: 'Girl & the Goat',
    neighborhood: 'West Loop',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'American · Small plates',
    address: '809 W Randolph St, Chicago, IL',
    lat: 41.8815,
    lng: -87.6472,
  }),
  restaurant({
    id: 'rest_3',
    name: "Portillo's",
    neighborhood: 'River North',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Hot dogs · Chicago classics',
    address: '100 W Ontario St, Chicago, IL',
    lat: 41.8934,
    lng: -87.6314,
  }),
  restaurant({
    id: 'rest_4',
    name: 'The Purple Pig',
    neighborhood: 'Magnificent Mile',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Mediterranean · Shared plates',
    address: '500 N Michigan Ave, Chicago, IL',
    lat: 41.8904,
    lng: -87.6242,
  }),
  restaurant({
    id: 'rest_5',
    name: 'Au Cheval',
    neighborhood: 'West Loop',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Burgers · American',
    address: '800 W Randolph St, Chicago, IL',
    lat: 41.8845,
    lng: -87.6477,
  }),
  restaurant({
    id: 'rest_tokyo_1',
    name: 'Sushi Sakura',
    neighborhood: 'Lincoln Park',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Sushi · Omakase',
    lat: 41.9258,
    lng: -87.6493,
  }),
  restaurant({
    id: 'rest_tokyo_2',
    name: 'Ramen Shogun',
    neighborhood: 'Wicker Park',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Ramen · Tonkotsu',
    lat: 41.9088,
    lng: -87.6795,
  }),
  restaurant({
    id: 'rest_tokyo_3',
    name: 'Tempura Kyo',
    neighborhood: 'Gold Coast',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Tempura · Seasonal',
    lat: 41.9058,
    lng: -87.6286,
  }),
  restaurant({
    id: 'rest_tokyo_4',
    name: 'Yakiniku Minato',
    neighborhood: 'Logan Square',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'Yakiniku · Wagyu',
    lat: 41.9282,
    lng: -87.7064,
  }),
  restaurant({
    id: 'rest_tokyo_5',
    name: 'Wrigleyville Street Eats',
    neighborhood: 'Wrigleyville',
    state: 'IL',
    city: 'Chicago',
    cuisine: 'American · Izakaya',
    lat: 41.9484,
    lng: -87.6553,
  }),
  restaurant({
    id: 'rest_mh_1',
    name: 'Katsu & Co.',
    neighborhood: 'Chelsea',
    state: 'NY',
    city: 'New York',
    cuisine: 'Japanese · Katsu',
    lat: 40.7465,
    lng: -74.0014,
  }),
  restaurant({
    id: 'rest_mh_2',
    name: 'Tribeca Ramen',
    neighborhood: 'Tribeca',
    state: 'NY',
    city: 'New York',
    cuisine: 'Ramen · Broth bar',
    lat: 40.7195,
    lng: -74.0089,
  }),
  restaurant({
    id: 'rest_mh_3',
    name: 'Saffron & Steak',
    neighborhood: 'Midtown',
    state: 'NY',
    city: 'New York',
    cuisine: 'Steakhouse · Modern',
    lat: 40.7549,
    lng: -73.984,
  }),
  restaurant({
    id: 'rest_mh_4',
    name: 'Little Italy Pizza Lab',
    neighborhood: 'Little Italy',
    state: 'NY',
    city: 'New York',
    cuisine: 'Pizza · Neapolitan',
    lat: 40.7191,
    lng: -73.9973,
  }),
  restaurant({
    id: 'rest_mh_5',
    name: 'Smoked Palates',
    neighborhood: 'West Village',
    state: 'NY',
    city: 'New York',
    cuisine: 'BBQ · American',
    lat: 40.7347,
    lng: -74.0027,
  }),
  restaurant({
    id: 'rest_other_1',
    name: 'Signature Kitchen',
    neighborhood: 'Downtown',
    state: '',
    city: 'Local',
    cuisine: 'Modern · Local favorites',
    lat: 41.8781,
    lng: -87.6298,
  }),
  restaurant({
    id: 'rest_other_2',
    name: 'Chef’s Table',
    neighborhood: 'Central',
    state: '',
    city: 'Local',
    cuisine: 'Contemporary · Seasonal',
    lat: 41.881,
    lng: -87.6238,
  }),
  restaurant({
    id: 'rest_other_3',
    name: 'Corner Noodles',
    neighborhood: 'Old Town',
    state: '',
    city: 'Local',
    cuisine: 'Noodles · Comfort',
    lat: 41.9108,
    lng: -87.6376,
  }),
  restaurant({
    id: 'rest_other_4',
    name: 'The Social Table',
    neighborhood: 'Market District',
    state: '',
    city: 'Local',
    cuisine: 'Shared plates · Crowd-pleaser',
    lat: 41.8857,
    lng: -87.6418,
  }),
  restaurant({
    id: 'rest_other_5',
    name: 'Fire & Spice',
    neighborhood: 'Harbor',
    state: '',
    city: 'Local',
    cuisine: 'Global · Spiced bowls',
    lat: 41.8925,
    lng: -87.6131,
  }),
];

export function searchRestaurants(query: string): RestaurantOption[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  return RESTAURANTS.filter(
    (restaurantItem) =>
      restaurantItem.name.toLowerCase().includes(lower) ||
      restaurantItem.cuisine.toLowerCase().includes(lower) ||
      restaurantItem.neighborhood.toLowerCase().includes(lower),
  ).slice(0, 8);
}

/**
 * @deprecated Use RestaurantImage or getNeutralRestaurantPlaceholderUri instead.
 * Kept only for older call sites that still expect a function.
 */
export function getFallbackRestaurantPhoto(_restaurantId: string): string | undefined {
  return NEUTRAL_RESTAURANT_PLACEHOLDER_URI;
}
