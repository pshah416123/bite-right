import { apiClient } from './client';

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    const { data } = await apiClient.get<GeocodeResult>('/api/geo/geocode', {
      params: { query: q },
    });
    return data;
  } catch {
    return null;
  }
}

export async function geocodeAutocomplete(query: string): Promise<GeocodeResult[]> {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    const { data } = await apiClient.get<{ results: GeocodeResult[] }>('/api/geo/autocomplete', {
      params: { query: q },
    });
    return data.results ?? [];
  } catch {
    return [];
  }
}
