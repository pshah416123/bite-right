// Restaurant types for saved / categorized lists
export type RestaurantType =
  | 'date_night'
  | 'casual'
  | 'solo_dining'
  | 'group'
  | 'quick_bite'
  | 'special_occasion';

export const RESTAURANT_TYPE_LABELS: Record<RestaurantType, string> = {
  date_night: 'Date night',
  casual: 'Casual',
  solo_dining: 'Solo dining',
  group: 'Group',
  quick_bite: 'Quick bite',
  special_occasion: 'Special occasion',
};

export interface TopRestaurant {
  id: string;
  name: string;
  cuisine: string;
  neighborhood: string;
  yourScore: number;
  visitCount?: number;
}

export interface SavedRestaurant {
  id: string;
  name: string;
  cuisine?: string;
  neighborhood: string;
  type?: RestaurantType;
  priceLevel?: number;
  address?: string | null;
  savedAt?: string;
}
