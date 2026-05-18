import "dotenv/config";
import { logger } from "./lib/logger.js";
import { db } from "./lib/db.js";
import { ingestRestaurant, processAll, processBatch } from "./services/queue.js";
import { discoverAndStore } from "./services/places.js";
import { closeBrowser } from "./services/crawler.js";

const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    // ── Crawl a single restaurant by DB id ──
    case "crawl": {
      const restaurantId = args[0];
      if (!restaurantId) {
        console.error("Usage: tsx src/cli.ts crawl <restaurantId>");
        process.exit(1);
      }
      const ok = await ingestRestaurant(restaurantId);
      logger.info({ restaurantId, ok }, "crawl finished");
      break;
    }

    // ── Crawl all stale restaurants ──
    case "ingest": {
      const stats = await processAll({
        concurrency: Number(args[0]) || undefined,
      });
      logger.info(stats, "full ingest finished");
      break;
    }

    // ── Discover restaurants near a point ──
    case "discover": {
      const lat = Number(args[0]);
      const lng = Number(args[1]);
      const radius = Number(args[2]) || 1500;
      if (isNaN(lat) || isNaN(lng)) {
        console.error("Usage: tsx src/cli.ts discover <lat> <lng> [radius]");
        process.exit(1);
      }
      const restaurants = await discoverAndStore(lat, lng, radius);
      logger.info({ count: restaurants.length }, "discovery finished");
      for (const r of restaurants) {
        console.log(`  ${r.id} | ${r.name} | ${r.website ?? "(no website)"}`);
      }
      break;
    }

    // ── Discover + immediately crawl ──
    case "discover-and-crawl": {
      const lat = Number(args[0]);
      const lng = Number(args[1]);
      const radius = Number(args[2]) || 1500;
      if (isNaN(lat) || isNaN(lng)) {
        console.error("Usage: tsx src/cli.ts discover-and-crawl <lat> <lng> [radius]");
        process.exit(1);
      }
      const restaurants = await discoverAndStore(lat, lng, radius);
      const withWebsite = restaurants.filter((r) => r.website);
      logger.info(
        { discovered: restaurants.length, withWebsite: withWebsite.length },
        "discovery done, starting crawl",
      );
      const stats = await processBatch(withWebsite.map((r) => r.id));
      logger.info(stats, "discover-and-crawl finished");
      break;
    }

    // ── List restaurants in DB ──
    case "list": {
      const restaurants = await db.restaurant.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { menuSections: true } } },
      });
      console.log(`\n${restaurants.length} restaurants:\n`);
      for (const r of restaurants) {
        const menuIcon = r._count.menuSections > 0 ? "✓" : "✗";
        console.log(
          `  ${menuIcon} ${r.id} | ${r.name} | ${r.cuisineInferred ?? "-"} | ${r.website ?? "(no site)"}`,
        );
      }
      break;
    }

    default:
      console.error(
        `Unknown command: ${command}\n\nAvailable commands:\n` +
          "  crawl <restaurantId>              Crawl a single restaurant\n" +
          "  ingest [concurrency]              Crawl all stale restaurants\n" +
          "  discover <lat> <lng> [radius]     Discover restaurants from Google\n" +
          "  discover-and-crawl <lat> <lng>    Discover + crawl in one step\n" +
          "  list                              List all restaurants in DB",
      );
      process.exit(1);
  }
}

main()
  .then(() => closeBrowser())
  .then(() => db.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "CLI error");
    process.exit(1);
  });
