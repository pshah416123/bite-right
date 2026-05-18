/**
 * Mock data for Test Mode — edge-case scenarios for UI testing.
 * All IDs prefixed with `test_` to avoid collisions with real data.
 */
import type { FeedLog, VibeTag } from '../components/FeedCard';
import type { DiscoverItem } from '../components/RestaurantCard';
import type { CompareRestaurant } from '../context/CompareContext';

// ── Feed Logs ────────────────────────────────────────────────────────────────

export const TEST_FEED_LOGS: FeedLog[] = [
  // 1. No image at all
  {
    id: 'test_feed_1',
    userName: 'You',
    restaurantName: 'The Vanishing Photo Bistro',
    restaurantId: 'test_rest_1',
    score: 7.5,
    cuisine: 'American · New',
    neighborhood: 'West Loop',
    state: 'IL',
    note: 'Great food but no pics to show for it.',
    dishes: ['Truffle fries', 'Wagyu slider'],
    vibeTags: ['casual'] as VibeTag[],
  },

  // 2. Very long restaurant name + long note
  {
    id: 'test_feed_2',
    userName: 'Alexandrina Bartholomew-Kensington III',
    restaurantName:
      'The Extraordinarily Long-Named Artisanal Farm-to-Table Gastropub & Craft Cocktail Lounge of Downtown Chicago',
    restaurantId: 'test_rest_2',
    score: 8.8,
    cuisine: 'Mediterranean · Fusion · Small Plates · Wine Bar',
    neighborhood: 'Lincoln Park',
    state: 'IL',
    note: 'This place has the most incredible atmosphere I have ever experienced in my entire life. The food was beyond anything I could have imagined — every single dish was a masterpiece of culinary art. The chef came out and explained each course in detail, and the sommelier paired wines perfectly. I would come back every single week if I could afford it. Absolutely worth the two-hour wait.',
    dishes: [
      'Saffron risotto',
      'Lamb shank',
      'Burrata',
      'Grilled octopus',
      'Chocolate fondant',
      'Tuna tartare',
      'Duck confit',
      'Lobster bisque',
      'Crème brûlée',
      'Tiramisu',
    ],
    vibeTags: ['date_night', 'celebration', 'group'] as VibeTag[],
    standoutDish: { label: 'Standout', name: 'Saffron risotto with truffle shavings' },
    highlight: 'food',
    previewPhotoUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
  },

  // 3. Minimal data — only required fields
  {
    id: 'test_feed_3',
    userName: 'You',
    restaurantName: 'Taco Spot',
    restaurantId: 'test_rest_3',
    score: 5.0,
    cuisine: 'Mexican',
  },

  // 4. Return visit with rating change
  {
    id: 'test_feed_4',
    userName: 'You',
    restaurantName: 'Girl & the Goat',
    restaurantId: 'test_rest_4',
    score: 9.5,
    cuisine: 'American · Small plates',
    neighborhood: 'West Loop',
    state: 'IL',
    note: 'Even better the fifth time. The goat empanadas never disappoint.',
    dishes: ['Goat empanadas', 'Wood-oven pig face'],
    vibeTags: ['date_night'] as VibeTag[],
    visitNumber: 5,
    visitCount: 5,
    previousRating: 7.2,
    highlight: 'food',
    previewPhotoUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800',
  },

  // 5. Friend's post (not "You")
  {
    id: 'test_feed_5',
    userName: 'Sarah M.',
    userAvatar: 'https://i.pravatar.cc/100?u=sarah',
    restaurantName: 'Alinea',
    restaurantId: 'test_rest_5',
    score: 9.9,
    cuisine: 'Molecular gastronomy',
    neighborhood: 'Lincoln Park',
    state: 'IL',
    note: 'Life-changing. The dessert on the table was unreal.',
    dishes: ['The balloon', 'Table dessert'],
    vibeTags: ['celebration'] as VibeTag[],
    highlight: 'food',
    previewPhotoUrl: 'https://images.unsplash.com/photo-1551218808-94e220e084d2?w=800',
  },

  // 6. Very low score
  {
    id: 'test_feed_6',
    userName: 'You',
    restaurantName: 'Sad Sandwich Shop',
    restaurantId: 'test_rest_6',
    score: 2.1,
    cuisine: 'Deli',
    neighborhood: 'Loop',
    state: 'IL',
    note: 'Would not recommend.',
  },

  // 7. All vibe tags
  {
    id: 'test_feed_7',
    userName: 'Mike R.',
    userAvatar: 'https://i.pravatar.cc/100?u=mike',
    restaurantName: 'The Versatile Kitchen',
    restaurantId: 'test_rest_7',
    score: 8.0,
    cuisine: 'Eclectic',
    neighborhood: 'Wicker Park',
    state: 'IL',
    vibeTags: ['date_night', 'casual', 'solo_dining', 'group', 'celebration', 'quick_bite'] as VibeTag[],
    previewPhotoUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800',
  },
];

// ── Discover Items ───────────────────────────────────────────────────────────

export const TEST_DISCOVER_ITEMS: DiscoverItem[] = [
  // 1. No image
  {
    restaurant: {
      id: 'test_disc_1',
      name: 'Mystery Ramen (No Photo)',
      cuisine: 'Ramen · Japanese',
      neighborhood: 'Chinatown',
      state: 'IL',
      priceLevel: 1,
      lat: 41.85,
      lng: -87.63,
    },
    matchScore: 0.85,
    reasonTags: ['Top rated', 'Budget-friendly'],
    heroLabel: 'Hidden gem',
    cardTags: ['Ramen', 'Tonkotsu'],
  },

  // 2. Very long name
  {
    restaurant: {
      id: 'test_disc_2',
      name: 'The Incredibly Long-Named Award-Winning International Fusion Restaurant & Speakeasy Bar',
      cuisine: 'Fusion · International · Pan-Asian · Latin · Mediterranean',
      neighborhood: 'Gold Coast',
      state: 'IL',
      priceLevel: 4,
      lat: 41.90,
      lng: -87.63,
      displayImageUrl: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800',
      displayImageSourceType: 'override',
    },
    matchScore: 1.0,
    reasonTags: ['100% match', 'Fine dining', 'Special occasion'],
    heroLabel: 'Perfect match',
    cardTags: ['Omakase', 'Prix fixe'],
    socialProofBadge: '6 friends saved this',
  },

  // 3. 0% match, no neighborhood, no price
  {
    restaurant: {
      id: 'test_disc_3',
      name: 'Empty Fields Diner',
      cuisine: 'American',
    },
    matchScore: 0,
    reasonTags: [],
    cardTags: [],
  },

  // 4. Edge distance (far away)
  {
    restaurant: {
      id: 'test_disc_4',
      name: 'Worth The Drive BBQ',
      cuisine: 'BBQ · Smokehouse',
      neighborhood: 'Naperville',
      state: 'IL',
      priceLevel: 2,
      lat: 41.77,
      lng: -88.15,
      displayImageUrl: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=800',
      displayImageSourceType: 'override',
    },
    matchScore: 0.72,
    reasonTags: ['Worth the trip', 'Smoky'],
    heroLabel: 'Pilsen staple',
    cardTags: ['Brisket', 'Ribs'],
  },

  // 5. With friend visits
  {
    restaurant: {
      id: 'test_disc_5',
      name: 'Social Proof Pizza',
      cuisine: 'Pizza · Italian',
      neighborhood: 'Bucktown',
      state: 'IL',
      priceLevel: 2,
      lat: 41.91,
      lng: -87.68,
      displayImageUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800',
      displayImageSourceType: 'override',
    },
    matchScore: 0.91,
    reasonTags: ['Friends love it', 'Trending'],
    heroLabel: 'Top rated',
    cardTags: ['Neapolitan', 'Wood-fired'],
    socialProofBadge: '3 friends been here',
    friendVisits: [
      { id: 'fv1', userName: 'Sarah', userAvatar: 'https://i.pravatar.cc/40?u=sarah', score: 9.0 },
      { id: 'fv2', userName: 'Jake', userAvatar: 'https://i.pravatar.cc/40?u=jake', score: 8.5 },
      { id: 'fv3', userName: 'Priya', userAvatar: 'https://i.pravatar.cc/40?u=priya', score: 9.2 },
    ],
  },

  // 6. Very close (walking distance)
  {
    restaurant: {
      id: 'test_disc_6',
      name: 'Right Next Door Café',
      cuisine: 'Coffee · Pastries',
      neighborhood: 'River North',
      state: 'IL',
      priceLevel: 1,
      lat: 41.8902,
      lng: -87.6369,
      displayImageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800',
      displayImageSourceType: 'override',
    },
    matchScore: 0.65,
    reasonTags: ['Walking distance'],
    cardTags: ['Latte', 'Croissant'],
  },
];

// ── Compare Restaurants ──────────────────────────────────────────────────────

export const TEST_COMPARE_RESTAURANTS: CompareRestaurant[] = [
  // Fully populated
  {
    id: 'test_cmp_1',
    name: 'Girl & the Goat',
    cuisine: 'American · Small plates',
    neighborhood: 'West Loop',
    priceLevel: 3,
    score: 9.2,
    matchScore: 0.94,
    dishes: ['Goat empanadas', 'Wood-oven pig face', 'Kohlrabi salad'],
    standoutDish: 'Goat empanadas',
    vibeTags: ['date_night', 'celebration'],
    imageUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800',
  },

  // Minimal fields
  {
    id: 'test_cmp_2',
    name: 'Taco Spot',
    cuisine: 'Mexican',
  },

  // Extreme price + long cuisine
  {
    id: 'test_cmp_3',
    name: 'Alinea',
    cuisine: 'Molecular gastronomy · Tasting menu · Fine dining · Contemporary',
    neighborhood: 'Lincoln Park',
    priceLevel: 4,
    score: 9.9,
    matchScore: 0.99,
    dishes: ['The balloon'],
    standoutDish: 'Table dessert experience',
    vibeTags: ['celebration'],
    imageUrl: 'https://images.unsplash.com/photo-1551218808-94e220e084d2?w=800',
  },
];
