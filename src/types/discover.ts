export interface RestaurantMeta {
  id: string;
  name: string;
  neighborhood: string;
  state?: string;
  cuisine: string;
  priceLevel?: number;
  tags: string[];
}

export interface DiscoverApiRecommendation {
  restaurant: RestaurantMeta;
  percentMatch: number; // 0–100
  explanations: string[];
  sourceClusterId: number;
  isExploratory: boolean;
}

export interface DiscoverApiResponse {
  userId: string;
  isColdStart: boolean;
  recommendations: DiscoverApiRecommendation[];
}

