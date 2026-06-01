-- ============================================================================
-- restaurant_details_cache — cached Google Place Details + LLM-extracted fields
--
-- Eliminates the per-request Google Places + Claude Haiku round-trips on
-- /api/restaurants/:id. Without this, every detail load is bottlenecked on
-- the slowest external call (typically the LLM dish extractor, 2–10s).
--
-- Stored fields are the subset that's stable enough to cache (hours, reviews,
-- popular dishes). is_open_now is NOT cached — it's recomputed from the cached
-- `hours_periods` against the current time on every read.
-- ============================================================================

create table if not exists restaurant_details_cache (
  restaurant_id           text        primary key,
  place_id                text,
  formatted_address       text,
  website                 text,
  google_maps_url         text,
  phone                   text,
  lat                     double precision,
  lng                     double precision,
  price_level             smallint,
  google_rating           real,
  google_ratings_total    integer,
  hours_weekday_text      jsonb,          -- string[]
  hours_periods           jsonb,          -- Google's opening_hours.periods (for is_open_now recompute)
  google_reviews          jsonb,          -- trimmed review array
  popular_dishes          jsonb,          -- PopularDish[]
  what_people_are_saying  jsonb,          -- SayingPhrase[]
  last_fetched_at         timestamptz not null default now(),
  next_refresh_at         timestamptz not null
);

create index if not exists idx_details_refresh on restaurant_details_cache (next_refresh_at);

alter table restaurant_details_cache enable row level security;
create policy "details_read_all"           on restaurant_details_cache for select using (true);
create policy "details_service_insert"     on restaurant_details_cache for insert with check (true);
create policy "details_service_update"     on restaurant_details_cache for update using (true);
create policy "details_service_delete"     on restaurant_details_cache for delete using (true);
