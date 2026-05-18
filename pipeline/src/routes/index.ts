import { Router } from "express";
import { db } from "../lib/db.js";
import { childLogger } from "../lib/logger.js";
import { discoverAndStore } from "../services/places.js";
import { ingestRestaurant, processBatch } from "../services/queue.js";

const log = childLogger("routes");

export const router = Router();

// ─── GET /restaurants ────────────────────────────────────────
// List restaurants, optionally filtered by location.

router.get("/restaurants", async (req, res) => {
  try {
    const { lat, lng, radius, cursor, limit: rawLimit } = req.query;
    const limit = Math.min(Number(rawLimit) || 50, 200);

    const where: Record<string, unknown> = {};

    // If lat/lng provided, discover from Google first, then return DB results
    if (lat && lng) {
      const latNum = Number(lat);
      const lngNum = Number(lng);
      const radiusNum = Number(radius) || 1500;

      if (!isNaN(latNum) && !isNaN(lngNum)) {
        await discoverAndStore(latNum, lngNum, radiusNum);

        // Bounding box filter (rough)
        const latDelta = radiusNum / 111_000;
        const lngDelta = radiusNum / (111_000 * Math.cos((latNum * Math.PI) / 180));
        where.lat = { gte: latNum - latDelta, lte: latNum + latDelta };
        where.lng = { gte: lngNum - lngDelta, lte: lngNum + lngDelta };
      }
    }

    const restaurants = await db.restaurant.findMany({
      where,
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: String(cursor) } } : {}),
      orderBy: { name: "asc" },
      include: {
        _count: { select: { menuSections: true } },
      },
    });

    res.json({
      data: restaurants,
      nextCursor: restaurants.length === limit ? restaurants[restaurants.length - 1]?.id : null,
    });
  } catch (err) {
    log.error({ err }, "GET /restaurants failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /restaurants/:id/menu ───────────────────────────────
// Return structured menu for a restaurant.

router.get("/restaurants/:id/menu", async (req, res) => {
  try {
    const { id } = req.params;

    const restaurant = await db.restaurant.findUnique({
      where: { id },
    });

    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    const sections = await db.menuSection.findMany({
      where: { restaurantId: id },
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          orderBy: { name: "asc" },
        },
      },
    });

    // Include latest crawl info
    const lastCrawl = await db.crawlRun.findFirst({
      where: { restaurantId: id },
      orderBy: { startedAt: "desc" },
    });

    return res.json({
      restaurant: {
        id: restaurant.id,
        placeId: restaurant.placeId,
        name: restaurant.name,
        address: restaurant.address,
        cuisineInferred: restaurant.cuisineInferred,
      },
      sections: sections.map((s) => ({
        id: s.id,
        name: s.name,
        items: s.items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          price: item.price,
          currency: item.currency,
          confidence: item.confidenceScore,
          tags: {
            isVeg: item.isVeg,
            isVegan: item.isVegan,
            isSpicy: item.isSpicy,
            isGlutenFree: item.isGlutenFree,
          },
        })),
      })),
      meta: {
        lastCrawledAt: lastCrawl?.finishedAt ?? null,
        parserUsed: lastCrawl?.parserUsed ?? null,
        status: lastCrawl?.status ?? null,
      },
    });
  } catch (err) {
    log.error({ err }, "GET /restaurants/:id/menu failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /restaurants/by-place/:placeId/menu ─────────────────
// Lookup menu by Google place_id — used by the mobile app which
// passes place_id (or mock IDs like rest_1) as the restaurant key.
// Returns the same shape as the legacy server so the frontend
// MenuTemplate component works without changes.

router.get("/restaurants/by-place/:placeId/menu", async (req, res) => {
  try {
    const { placeId } = req.params;

    // Find restaurant by placeId
    const restaurant = await db.restaurant.findUnique({
      where: { placeId },
    });

    if (!restaurant) {
      return res.status(404).json({ sections: [], menuPhotos: [], source: null });
    }

    const sections = await db.menuSection.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { sortOrder: "asc" },
      include: {
        items: { orderBy: { name: "asc" } },
      },
    });

    if (sections.length === 0) {
      return res.json({ sections: [], menuPhotos: [], source: null });
    }

    // Map to the legacy RestaurantMenu shape the frontend expects
    return res.json({
      sections: sections.map((s) => ({
        title: s.name,
        items: s.items.map((item) => ({
          name: item.name,
          description: item.description,
          price: item.price != null ? `$${item.price.toFixed(2)}` : null,
          tags: [
            ...(item.isVeg ? ["vegetarian"] : []),
            ...(item.isVegan ? ["vegan"] : []),
            ...(item.isSpicy ? ["spicy"] : []),
            ...(item.isGlutenFree ? ["gluten-free"] : []),
          ],
          photoUrl: null,
        })),
      })),
      menuPhotos: [],
      source: "scraped" as const,
    });
  } catch (err) {
    log.error({ err }, "GET /restaurants/by-place/:placeId/menu failed");
    res.status(500).json({ sections: [], menuPhotos: [], source: null });
  }
});

// ─── POST /crawl/:restaurantId ───────────────────────────────
// Trigger a crawl for a single restaurant.

router.post("/crawl/:restaurantId", async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const restaurant = await db.restaurant.findUnique({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

    // Run ingestion in background — respond immediately
    ingestRestaurant(restaurantId).catch((err) => {
      log.error({ restaurantId, err }, "background crawl failed");
    });

    return res.json({
      message: "Crawl started",
      restaurantId,
      status: "RUNNING",
    });
  } catch (err) {
    log.error({ err }, "POST /crawl/:restaurantId failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /crawl/batch ───────────────────────────────────────
// Trigger crawl for multiple restaurants.

router.post("/crawl/batch", async (req, res) => {
  try {
    const { restaurantIds } = req.body as { restaurantIds?: string[] };

    if (!Array.isArray(restaurantIds) || restaurantIds.length === 0) {
      return res.status(400).json({ error: "restaurantIds array required" });
    }

    if (restaurantIds.length > 100) {
      return res.status(400).json({ error: "Max 100 restaurants per batch" });
    }

    // Run in background
    processBatch(restaurantIds).catch((err) => {
      log.error({ err }, "batch crawl failed");
    });

    return res.json({
      message: "Batch crawl started",
      count: restaurantIds.length,
      status: "RUNNING",
    });
  } catch (err) {
    log.error({ err }, "POST /crawl/batch failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /crawl/:restaurantId/status ─────────────────────────
// Check the status of recent crawl runs.

router.get("/crawl/:restaurantId/status", async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 5, 20);

    const runs = await db.crawlRun.findMany({
      where: { restaurantId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    res.json({ data: runs });
  } catch (err) {
    log.error({ err }, "GET /crawl/:restaurantId/status failed");
    res.status(500).json({ error: "Internal server error" });
  }
});
