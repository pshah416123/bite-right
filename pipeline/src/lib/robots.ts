import axios from "axios";
import robotsParser from "robots-parser";
import { childLogger } from "./logger.js";

const log = childLogger("robots");

const cache = new Map<string, { allowed: boolean; expiry: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

/**
 * Check whether our crawler is allowed to fetch `url` per robots.txt.
 * Returns true if robots.txt is unreachable (fail-open for small-scale use).
 */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin;
    const now = Date.now();
    const cached = cache.get(origin);
    if (cached && cached.expiry > now) return cached.allowed;

    const robotsUrl = `${origin}/robots.txt`;
    const { data } = await axios.get<string>(robotsUrl, {
      timeout: 5_000,
      responseType: "text",
      validateStatus: () => true,
    });

    const robots = robotsParser(robotsUrl, typeof data === "string" ? data : "");
    const allowed = robots.isAllowed(url, "BiteRightBot") ?? true;

    cache.set(origin, { allowed, expiry: now + CACHE_TTL_MS });
    return allowed;
  } catch (err) {
    log.warn({ url, err }, "robots.txt check failed, allowing by default");
    return true;
  }
}

export function clearRobotsCache() {
  cache.clear();
}
