import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GOOGLE_PLACES_API_KEY: z.string().min(1),
  PORT: z.coerce.number().default(4100),
  LOG_LEVEL: z.string().default("info"),
  CRAWL_CONCURRENCY: z.coerce.number().default(3),
  CRAWL_DELAY_MS: z.coerce.number().default(2000),
  CRAWL_STALE_AFTER_HOURS: z.coerce.number().default(168), // 7 days
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = envSchema.parse(process.env);
  }
  return _config;
}
