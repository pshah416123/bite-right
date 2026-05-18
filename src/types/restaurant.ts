export type RestaurantDisplayImageSourceType =
  | 'override'
  | 'user'
  | 'google'
  | 'placeholder';

export interface RestaurantIdentity {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
  googlePlaceId?: string | null;
  displayImageUrl?: string | null;
  displayImageSourceType?: RestaurantDisplayImageSourceType | null;
  displayImageLastResolvedAt?: string | null;
}
