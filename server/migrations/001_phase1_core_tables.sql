-- ============================================================================
-- BiteRight Phase 1: Core persistence tables (APPLIED)
-- Tables: restaurants, logs, saved_restaurants
--
-- This migration has been applied. The restaurants table pre-existed with 11
-- columns; ALTER TABLE statements added the remaining 9.
-- ============================================================================

-- Extension
create extension if not exists "uuid-ossp";

-- restaurants: pre-existed with (id, place_id, name, address, lat, lng, website, phone, cuisine_inferred, created_at)
-- Added columns:
--   city, neighborhood, website_url, google_maps_url, reservation_url,
--   display_image_url, display_image_source_type, display_image_last_resolved_at,
--   display_image_photo_reference

create table if not exists restaurants (
  id              text        primary key,
  place_id        text        unique,
  name            text        not null,
  address         text,
  city            text,
  neighborhood    text,
  lat             double precision,
  lng             double precision,
  website         text,
  website_url     text,
  google_maps_url text,
  phone           text,
  reservation_url text,
  cuisine_inferred text,
  display_image_url             text,
  display_image_source_type     text,
  display_image_last_resolved_at timestamptz,
  display_image_photo_reference text,
  created_at      timestamptz not null default now()
);

create table if not exists logs (
  id              text        primary key,
  restaurant_id   text        not null references restaurants(id) on delete cascade,
  user_id         text        not null default 'default',
  rating          numeric(3,1) not null,
  notes           text,
  photos          text[],
  preview_photo_url text,
  created_at      timestamptz not null default now()
);

create table if not exists saved_restaurants (
  id              text        primary key,
  user_id         text        not null default 'default',
  restaurant_id   text        not null references restaurants(id) on delete cascade,
  source          text        not null default 'manual',
  note            text,
  snapshot        jsonb,
  saved_at        timestamptz not null default now(),
  unique (user_id, restaurant_id)
);

-- Indexes
create index if not exists idx_restaurants_place_id
  on restaurants (place_id) where place_id is not null;
create index if not exists idx_logs_user_id_created
  on logs (user_id, created_at desc);
create index if not exists idx_logs_restaurant_id
  on logs (restaurant_id);
create index if not exists idx_saved_user_id
  on saved_restaurants (user_id);
create index if not exists idx_saved_restaurant_id
  on saved_restaurants (restaurant_id);

-- RLS
alter table restaurants enable row level security;
create policy "restaurants_read_all" on restaurants for select using (true);
create policy "restaurants_service_insert" on restaurants for insert with check (true);
create policy "restaurants_service_update" on restaurants for update using (true);

alter table logs enable row level security;
create policy "logs_read_all" on logs for select using (true);
create policy "logs_service_insert" on logs for insert with check (true);
create policy "logs_service_update" on logs for update using (true);

alter table saved_restaurants enable row level security;
create policy "saved_read_own" on saved_restaurants for select using (true);
create policy "saved_service_insert" on saved_restaurants for insert with check (true);
create policy "saved_service_update" on saved_restaurants for update using (true);
create policy "saved_service_delete" on saved_restaurants for delete using (true);
