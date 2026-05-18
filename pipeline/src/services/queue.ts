import { db } from "../lib/db.js";
import { getConfig } from "../lib/config.js";
import { childLogger } from "../lib/logger.js";
import { crawlRestaurant, closeBrowser } from "./crawler.js";
import { parseCrawlResults } from "../parsers/index.js";
import { storeMenuResult, recordCrawlRun, lastSuccessfulCrawl } from "./storage.js";
import { inferCuisine } from "../utils/tags.js";

const log = childLogger("queue");

// ─── Types ───────────────────────────────────────────────────

interface QueueJob {
  restaurantId: string;
  attempt: number;
}

interface QueueStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

// ─── Ingestion orchestrator ──────────────────────────────────

/**
 * Full pipeline for a single restaurant: crawl → parse → store.
 * Returns true if new menu data was stored.
 */
export async function ingestRestaurant(restaurantId: string): Promise<boolean> {
  const startedAt = new Date();

  try {
    // Check freshness — skip if recently crawled
    const config = getConfig();
    const lastCrawl = await lastSuccessfulCrawl(restaurantId);
    if (lastCrawl) {
      const hoursAgo =
        (Date.now() - lastCrawl.getTime()) / (1000 * 60 * 60);
      if (hoursAgo < config.CRAWL_STALE_AFTER_HOURS) {
        log.info(
          { restaurantId, hoursAgo: hoursAgo.toFixed(1) },
          "skipping — recently crawled",
        );
        await recordCrawlRun(restaurantId, {
          status: "SKIPPED",
          startedAt,
        });
        return false;
      }
    }

    // Crawl
    const pages = await crawlRestaurant(restaurantId);
    if (pages.length === 0) {
      await recordCrawlRun(restaurantId, {
        status: "FAILED",
        error: "no pages crawled (no website?)",
        startedAt,
      });
      return false;
    }

    // Parse
    const result = await parseCrawlResults(pages);
    if (result.sections.length === 0) {
      await recordCrawlRun(restaurantId, {
        status: "FAILED",
        error: "no menu data extracted",
        startedAt,
      });
      return false;
    }

    // Store
    const { sectionsCreated, itemsCreated } = await storeMenuResult(
      restaurantId,
      result,
    );

    // Update cuisine inference
    const allText = result.sections
      .flatMap((s) => s.items.map((i) => `${i.name} ${i.description ?? ""}`))
      .join(" ");
    const cuisine = inferCuisine(allText);
    if (cuisine) {
      await db.restaurant.update({
        where: { id: restaurantId },
        data: { cuisineInferred: cuisine },
      });
    }

    await recordCrawlRun(restaurantId, {
      status: "SUCCESS",
      parserUsed: result.parserType,
      sectionsFound: sectionsCreated,
      itemsFound: itemsCreated,
      startedAt,
    });

    log.info(
      { restaurantId, sectionsCreated, itemsCreated, parser: result.parserType },
      "ingestion complete",
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ restaurantId, err: message }, "ingestion failed");

    await recordCrawlRun(restaurantId, {
      status: "FAILED",
      error: message.slice(0, 500),
      startedAt,
    }).catch(() => {}); // don't let audit logging failures mask the real error

    return false;
  }
}

// ─── Batch processor ─────────────────────────────────────────

const MAX_RETRIES = 3;

/**
 * Process a batch of restaurants through the ingestion pipeline.
 *
 * - Processes `concurrency` restaurants in parallel.
 * - Adds a delay between batches to avoid hammering upstream servers.
 * - Retries failures up to MAX_RETRIES with exponential backoff.
 */
export async function processBatch(
  restaurantIds: string[],
  opts?: { concurrency?: number; delayMs?: number },
): Promise<QueueStats> {
  const config = getConfig();
  const concurrency = opts?.concurrency ?? config.CRAWL_CONCURRENCY;
  const delayMs = opts?.delayMs ?? config.CRAWL_DELAY_MS;

  const stats: QueueStats = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  const queue: QueueJob[] = restaurantIds.map((id) => ({
    restaurantId: id,
    attempt: 0,
  }));
  const retryQueue: QueueJob[] = [];

  log.info(
    { total: queue.length, concurrency, delayMs },
    "batch processing started",
  );

  // Process in chunks
  while (queue.length > 0) {
    const chunk = queue.splice(0, concurrency);

    const results = await Promise.allSettled(
      chunk.map(async (job) => {
        const ok = await ingestRestaurant(job.restaurantId);
        return { job, ok };
      }),
    );

    for (const result of results) {
      stats.processed++;

      if (result.status === "fulfilled") {
        if (result.value.ok) {
          stats.succeeded++;
        } else {
          // Check if it was a skip vs a real failure
          const lastRun = await db.crawlRun.findFirst({
            where: { restaurantId: result.value.job.restaurantId },
            orderBy: { startedAt: "desc" },
          });

          if (lastRun?.status === "SKIPPED") {
            stats.skipped++;
          } else if (result.value.job.attempt < MAX_RETRIES) {
            retryQueue.push({
              restaurantId: result.value.job.restaurantId,
              attempt: result.value.job.attempt + 1,
            });
          } else {
            stats.failed++;
          }
        }
      } else {
        stats.failed++;
        log.error(
          { restaurantId: chunk[0]?.restaurantId, err: result.reason },
          "unhandled error in batch",
        );
      }
    }

    // Delay between chunks
    if (queue.length > 0) {
      await sleep(delayMs);
    }
  }

  // Process retries with exponential backoff
  for (const job of retryQueue) {
    const backoff = delayMs * Math.pow(2, job.attempt);
    log.info(
      { restaurantId: job.restaurantId, attempt: job.attempt, backoffMs: backoff },
      "retrying",
    );
    await sleep(backoff);

    const ok = await ingestRestaurant(job.restaurantId);
    stats.processed++;
    if (ok) stats.succeeded++;
    else stats.failed++;
  }

  // Clean up browser
  await closeBrowser();

  log.info(stats, "batch processing finished");
  return stats;
}

/**
 * Process ALL restaurants that need crawling (stale or never crawled).
 */
export async function processAll(
  opts?: { concurrency?: number; delayMs?: number },
): Promise<QueueStats> {
  const config = getConfig();
  const staleThreshold = new Date(
    Date.now() - config.CRAWL_STALE_AFTER_HOURS * 60 * 60 * 1000,
  );

  // Find restaurants that either:
  // 1. Have never been crawled successfully, OR
  // 2. Were last crawled before the stale threshold
  const restaurants = await db.restaurant.findMany({
    where: {
      website: { not: null },
      OR: [
        { crawlRuns: { none: { status: "SUCCESS" } } },
        {
          crawlRuns: {
            every: {
              OR: [
                { status: { not: "SUCCESS" } },
                { finishedAt: { lt: staleThreshold } },
              ],
            },
          },
        },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  log.info({ count: restaurants.length }, "restaurants eligible for crawling");
  return processBatch(
    restaurants.map((r) => r.id),
    opts,
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
