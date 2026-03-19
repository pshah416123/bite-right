# Restaurant enrichment data

- **`restaurantEnrichment.json`** — Maps internal `restaurantId` → `placeId` / `googlePlaceId` (and optional canonical fields). Loaded on API startup to seed in-memory rows for static Chicago venues. Start empty `{}` until you run the backfill script.
- **`seedRestaurantsForEnrichment.json`** — Input list for `npm run backfill:places` (name, address, lat/lng). Edit to add more internal ids, then re-run the script.

From repo root:

```bash
npm run backfill:places
```

Requires `GOOGLE_PLACES_API_KEY` in `server/.env`. Restart the server after updating `restaurantEnrichment.json`.
