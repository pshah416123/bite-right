import { db } from "../lib/db.js";
import { childLogger } from "../lib/logger.js";
import type { ParseResult } from "../parsers/index.js";

const log = childLogger("storage");

/**
 * Persist a parsed menu result into the database.
 *
 * This is a full replacement — existing sections/items for the restaurant
 * are deleted and re-created. This keeps the data fresh and avoids stale
 * items accumulating across crawl runs.
 */
export async function storeMenuResult(
  restaurantId: string,
  result: ParseResult,
): Promise<{ sectionsCreated: number; itemsCreated: number }> {
  if (result.sections.length === 0) {
    return { sectionsCreated: 0, itemsCreated: 0 };
  }

  // Run inside a transaction for atomicity
  const stats = await db.$transaction(async (tx) => {
    // Delete existing menu data for this restaurant
    await tx.menuItem.deleteMany({
      where: { section: { restaurantId } },
    });
    await tx.menuSection.deleteMany({
      where: { restaurantId },
    });

    let sectionsCreated = 0;
    let itemsCreated = 0;

    for (let si = 0; si < result.sections.length; si++) {
      const section = result.sections[si];

      const dbSection = await tx.menuSection.create({
        data: {
          restaurantId,
          name: section.name,
          sortOrder: si,
        },
      });
      sectionsCreated++;

      const itemData = section.items.map((item) => ({
        sectionId: dbSection.id,
        name: item.name,
        description: item.description,
        price: item.price,
        currency: item.currency,
        confidenceScore: result.confidence,
        parserType: result.parserType,
        isVeg: item.tags.isVeg,
        isVegan: item.tags.isVegan,
        isSpicy: item.tags.isSpicy,
        isGlutenFree: item.tags.isGlutenFree,
      }));

      if (itemData.length > 0) {
        await tx.menuItem.createMany({ data: itemData });
        itemsCreated += itemData.length;
      }
    }

    return { sectionsCreated, itemsCreated };
  });

  log.info(
    {
      restaurantId,
      ...stats,
      parserType: result.parserType,
      confidence: result.confidence,
    },
    "menu stored",
  );

  return stats;
}

/**
 * Record the outcome of a crawl run (success or failure).
 */
export async function recordCrawlRun(
  restaurantId: string,
  opts: {
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    parserUsed?: string;
    sectionsFound?: number;
    itemsFound?: number;
    error?: string;
    startedAt: Date;
  },
) {
  return db.crawlRun.create({
    data: {
      restaurantId,
      status: opts.status,
      parserUsed: opts.parserUsed ?? null,
      sectionsFound: opts.sectionsFound ?? 0,
      itemsFound: opts.itemsFound ?? 0,
      error: opts.error ?? null,
      startedAt: opts.startedAt,
      finishedAt: new Date(),
    },
  });
}

/**
 * Get the last successful crawl timestamp for a restaurant.
 */
export async function lastSuccessfulCrawl(
  restaurantId: string,
): Promise<Date | null> {
  const run = await db.crawlRun.findFirst({
    where: { restaurantId, status: "SUCCESS" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  return run?.finishedAt ?? null;
}
