export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          username: string;
          full_name: string;
          avatar_url: string;
          city: string;
          state: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          full_name: string;
          avatar_url?: string;
          city?: string;
          state?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          full_name?: string;
          avatar_url?: string;
          city?: string;
          state?: string;
          created_at?: string;
        };
      };
      restaurants: {
        Row: {
          id: string;
          name: string;
          cuisine_tags: string[];
          neighborhood: string;
          city: string;
          price_range: string;
          address: string;
          google_place_id: string;
          cover_image_url: string;
          food_image_urls: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          cuisine_tags?: string[];
          neighborhood?: string;
          city?: string;
          price_range?: string;
          address?: string;
          google_place_id?: string;
          cover_image_url?: string;
          food_image_urls?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          cuisine_tags?: string[];
          neighborhood?: string;
          city?: string;
          price_range?: string;
          address?: string;
          google_place_id?: string;
          cover_image_url?: string;
          food_image_urls?: string[];
          created_at?: string;
        };
      };
      logs: {
        Row: {
          id: string;
          user_id: string;
          restaurant_id: string;
          overall_score: number;
          food_score: number | null;
          service_score: number | null;
          standout_dish: string | null;
          caption: string | null;
          photo_url: string | null;
          visited_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          restaurant_id: string;
          overall_score: number;
          food_score?: number | null;
          service_score?: number | null;
          standout_dish?: string | null;
          caption?: string | null;
          photo_url?: string | null;
          visited_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          restaurant_id?: string;
          overall_score?: number;
          food_score?: number | null;
          service_score?: number | null;
          standout_dish?: string | null;
          caption?: string | null;
          photo_url?: string | null;
          visited_at?: string;
          created_at?: string;
        };
      };
      saved_restaurants: {
        Row: {
          id: string;
          user_id: string;
          restaurant_id: string;
          save_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          restaurant_id: string;
          save_type?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          restaurant_id?: string;
          save_type?: string;
          created_at?: string;
        };
      };
      follows: {
        Row: {
          id: string;
          follower_id: string;
          following_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          follower_id: string;
          following_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          follower_id?: string;
          following_id?: string;
          created_at?: string;
        };
      };
      reactions: {
        Row: {
          id: string;
          user_id: string;
          log_id: string;
          type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          log_id: string;
          type: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          log_id?: string;
          type?: string;
          created_at?: string;
        };
      };
      match_scores: {
        Row: {
          id: string;
          user_id: string;
          restaurant_id: string;
          score: number;
          reason: string;
          calculated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          restaurant_id: string;
          score: number;
          reason?: string;
          calculated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          restaurant_id?: string;
          score?: number;
          reason?: string;
          calculated_at?: string;
        };
      };
    };
  };
}

// Convenience row types
export type UserRow = Database['public']['Tables']['users']['Row'];
export type RestaurantRow = Database['public']['Tables']['restaurants']['Row'];
export type LogRow = Database['public']['Tables']['logs']['Row'];
export type SavedRestaurantRow = Database['public']['Tables']['saved_restaurants']['Row'];
export type FollowRow = Database['public']['Tables']['follows']['Row'];
export type ReactionRow = Database['public']['Tables']['reactions']['Row'];
export type MatchScoreRow = Database['public']['Tables']['match_scores']['Row'];
