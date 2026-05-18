import axios from "axios";
import { db } from "../lib/db.js";
import { getConfig } from "../lib/config.js";
import { childLogger } from "../lib/logger.js";

const log = childLogger("places");

// ─── Types ───────────────────────────────────────────────────

interface PlaceSearchResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  website: string | null;
}

interface PlaceDetails {
  placeId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  phone: string | null;
}

// ─── Google Places (New) API helpers ─────────────────────────

const PLACES_BASE = "https://places.googleapis.com/v1/places";

/**
 * Search for restaurants near a point using Places (New) Nearby Search.
 * Returns up to 20 results per call. For pagination, call repeatedly
 * with the returned `nextPageToken` (not implemented here for simplicity).
 */
export async function searchRestaurants(
  lat: number,
  lng: number,
  radiusMeters = 1500,
): Promise<PlaceSearchResult[]> {
  const config = getConfig();

  const { data } = await axios.post(
    `${PLACES_BASE}:searchNearby`,
    {
      includedTypes: ["restaurant"],
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
      maxResultCount: 20,
    },
    {
      headers: {
        "X-Goog-Api-Key": config.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.websiteUri",
        ].join(","),
      },
    },
  );

  const places: PlaceSearchResult[] = (data.places ?? []).map(
    (p: Record<string, unknown>) => ({
      placeId: p.id as string,
      name: (p.displayName as { text: string })?.text ?? "",
      address: (p.formattedAddress as string) ?? "",
      lat: (p.location as { latitude: number })?.latitude ?? 0,
      lng: (p.location as { longitude: number })?.longitude ?? 0,
      website: (p.websiteUri as string) ?? null,
    }),
  );

  log.info({ lat, lng, radiusMeters, count: places.length }, "nearby search");
  return places;
}

/**
 * Fetch details for a single place by place_id.
 */
export async function getPlaceDetails(
  placeId: string,
): Promise<PlaceDetails | null> {
  const config = getConfig();

  try {
    const { data } = await axios.get(`${PLACES_BASE}/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": config.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "websiteUri",
          "nationalPhoneNumber",
        ].join(","),
      },
    });

    return {
      placeId: data.id,
      name: data.displayName?.text ?? "",
      address: data.formattedAddress ?? null,
      lat: data.location?.latitude ?? null,
      lng: data.location?.longitude ?? null,
      website: data.websiteUri ?? null,
      phone: data.nationalPhoneNumber ?? null,
    };
  } catch (err) {
    log.error({ placeId, err }, "place details fetch failed");
    return null;
  }
}

// ─── DB persistence ──────────────────────────────────────────

/**
 * Upsert a batch of search results into the database.
 * Dedupes by place_id. Returns the number of new restaurants inserted.
 */
export async function upsertRestaurants(
  results: PlaceSearchResult[],
): Promise<number> {
  let inserted = 0;

  for (const r of results) {
    const existing = await db.restaurant.findUnique({
      where: { placeId: r.placeId },
    });

    if (existing) {
      await db.restaurant.update({
        where: { placeId: r.placeId },
        data: {
          name: r.name,
          address: r.address,
          lat: r.lat,
          lng: r.lng,
          website: r.website ?? existing.website,
        },
      });
    } else {
      await db.restaurant.create({
        data: {
          placeId: r.placeId,
          name: r.name,
          address: r.address,
          lat: r.lat,
          lng: r.lng,
          website: r.website,
        },
      });
      inserted++;
    }
  }

  log.info(
    { total: results.length, inserted, updated: results.length - inserted },
    "upserted restaurants",
  );
  return inserted;
}

/**
 * Discover restaurants near a point, persist them, and return the DB records.
 */
export async function discoverAndStore(
  lat: number,
  lng: number,
  radiusMeters = 1500,
) {
  const results = await searchRestaurants(lat, lng, radiusMeters);
  await upsertRestaurants(results);

  return db.restaurant.findMany({
    where: {
      placeId: { in: results.map((r) => r.placeId) },
    },
    orderBy: { name: "asc" },
  });
}
