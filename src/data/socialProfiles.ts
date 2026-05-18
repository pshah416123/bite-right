import type { SavedRestaurantItem } from '../api/saved';

export interface SocialProfile {
  userName: string;
  displayName: string;
  followerCount: number;
  followingCount: number;
  savedRestaurants: SavedRestaurantItem[];
}

function createSavedRestaurant(
  restaurantId: string,
  name: string,
  neighborhood: string,
  city: string,
  source: 'swipe' | 'manual',
  savedAt: string,
): SavedRestaurantItem {
  return {
    restaurantId,
    place_id: restaurantId,
    name,
    address: null,
    city,
    neighborhood,
    lat: null,
    lng: null,
    previewPhotoUrl: null,
    cover_image_url: null,
    savedAt,
    source,
    rating: null,
    price_level: null,
  };
}

export const SOCIAL_PROFILES: Record<string, SocialProfile> = {
  Maya: {
    userName: 'Maya',
    displayName: 'Maya',
    followerCount: 128,
    followingCount: 92,
    savedRestaurants: [
      createSavedRestaurant('rest_4', 'The Purple Pig', 'Magnificent Mile', 'Chicago', 'manual', '2026-03-18T18:00:00.000Z'),
      createSavedRestaurant('rest_5', 'Au Cheval', 'West Loop', 'Chicago', 'swipe', '2026-03-15T18:00:00.000Z'),
      createSavedRestaurant('rest_mh_4', 'Little Italy Pizza Lab', 'Little Italy', 'New York', 'manual', '2026-03-11T18:00:00.000Z'),
    ],
  },
  Alex: {
    userName: 'Alex',
    displayName: 'Alex',
    followerCount: 94,
    followingCount: 61,
    savedRestaurants: [
      createSavedRestaurant('rest_2', 'Girl & the Goat', 'West Loop', 'Chicago', 'swipe', '2026-03-19T18:00:00.000Z'),
      createSavedRestaurant('rest_3', "Portillo's", 'River North', 'Chicago', 'manual', '2026-03-14T18:00:00.000Z'),
    ],
  },
  Jordan: {
    userName: 'Jordan',
    displayName: 'Jordan',
    followerCount: 76,
    followingCount: 83,
    savedRestaurants: [
      createSavedRestaurant('rest_1', "Lou Malnati's", 'River North', 'Chicago', 'manual', '2026-03-16T18:00:00.000Z'),
      createSavedRestaurant('rest_4', 'The Purple Pig', 'Magnificent Mile', 'Chicago', 'swipe', '2026-03-08T18:00:00.000Z'),
    ],
  },
  Sam: {
    userName: 'Sam',
    displayName: 'Sam',
    followerCount: 58,
    followingCount: 47,
    savedRestaurants: [
      createSavedRestaurant('rest_5', 'Au Cheval', 'West Loop', 'Chicago', 'manual', '2026-03-17T18:00:00.000Z'),
      createSavedRestaurant('rest_mh_2', 'Tribeca Ramen', 'Tribeca', 'New York', 'swipe', '2026-03-09T18:00:00.000Z'),
    ],
  },
  Riley: {
    userName: 'Riley',
    displayName: 'Riley',
    followerCount: 111,
    followingCount: 102,
    savedRestaurants: [
      createSavedRestaurant('rest_2', 'Girl & the Goat', 'West Loop', 'Chicago', 'manual', '2026-03-12T18:00:00.000Z'),
      createSavedRestaurant('rest_4', 'The Purple Pig', 'Magnificent Mile', 'Chicago', 'manual', '2026-03-07T18:00:00.000Z'),
    ],
  },
  Taylor: {
    userName: 'Taylor',
    displayName: 'Taylor',
    followerCount: 66,
    followingCount: 70,
    savedRestaurants: [
      createSavedRestaurant('rest_1', "Lou Malnati's", 'River North', 'Chicago', 'swipe', '2026-03-10T18:00:00.000Z'),
      createSavedRestaurant('rest_3', "Portillo's", 'River North', 'Chicago', 'manual', '2026-03-06T18:00:00.000Z'),
    ],
  },
  Casey: {
    userName: 'Casey',
    displayName: 'Casey',
    followerCount: 49,
    followingCount: 55,
    savedRestaurants: [
      createSavedRestaurant('rest_4', 'The Purple Pig', 'Magnificent Mile', 'Chicago', 'manual', '2026-03-13T18:00:00.000Z'),
      createSavedRestaurant('rest_5', 'Au Cheval', 'West Loop', 'Chicago', 'swipe', '2026-03-05T18:00:00.000Z'),
    ],
  },
};

export function getSocialProfile(userName: string): SocialProfile | null {
  return SOCIAL_PROFILES[userName] ?? null;
}
