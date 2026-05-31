-- ============================================================================
-- restaurant_menus — provider-aware menu cache
--
-- Replaces the per-request re-scrape with a TTL'd cache. Stores raw + parsed
-- data so we can re-parse with improved code later without re-scraping.
--
-- source_type lineage of trust (best -> worst):
--   chain_curated  hand-written, always-100-quality
--   toast/popmenu  provider-specific JSON, structured
--   square         JSON-LD schema.org
--   chownow/bento  provider-specific
--   pdf            extracted via pdf-parse
--   generic_scrape cheerio + heuristics (the old path)
-- ============================================================================

create table if not exists restaurant_menus (
  restaurant_id     text        primary key references restaurants(id) on delete cascade,
  source_type       text        not null check (source_type in (
    'toast','popmenu','square','chownow','bentobox','clover',
    'wix','wordpress','yelp_menu','pdf','generic_scrape','chain_curated'
  )),
  source_url        text,
  pdf_url           text,
  raw_data          jsonb,
  structured_data   jsonb       not null,
  quality_score     smallint    not null,
  scrape_status     text        not null default 'success'
                    check (scrape_status in ('success','failed','low_quality','blocked')),
  scrape_attempts   smallint    not null default 1,
  last_scraped_at   timestamptz not null default now(),
  next_refresh_at   timestamptz not null,
  last_error        text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_menus_refresh on restaurant_menus (next_refresh_at)
  where scrape_status <> 'blocked';
create index if not exists idx_menus_quality on restaurant_menus (quality_score);

alter table restaurant_menus enable row level security;
create policy "menus_read_all"           on restaurant_menus for select using (true);
create policy "menus_service_insert"     on restaurant_menus for insert with check (true);
create policy "menus_service_update"     on restaurant_menus for update using (true);
create policy "menus_service_delete"     on restaurant_menus for delete using (true);
