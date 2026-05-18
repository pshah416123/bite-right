-- ============================================================================
-- BiteRight Phase 2 (part A): Reservation links
-- Stores external reservation URLs / phone numbers per restaurant.
-- No live availability is scraped or fetched — this table only holds
-- the user-tappable link for each provider.
-- ============================================================================

create table if not exists restaurant_reservation_links (
  id                     uuid        primary key default uuid_generate_v4(),
  restaurant_id          text        not null references restaurants(id) on delete cascade,
  provider               text        not null
    check (provider in ('opentable','resy','sevenrooms','yelp','website','phone')),
  url                    text,                -- optional; not used for provider='phone'
  phone_number           text,                -- used when provider='phone'; ignored otherwise
  provider_restaurant_id text,                -- e.g. OpenTable rid / Resy venue_id, optional
  is_primary             boolean     not null default false,
  last_verified_at       timestamptz,
  created_at             timestamptz not null default now(),
  -- Either url or phone_number must be present
  constraint reservation_link_has_target
    check ((url is not null and length(trim(url)) > 0)
        or (phone_number is not null and length(trim(phone_number)) > 0))
);

-- Indexes
create index if not exists idx_reservation_links_restaurant
  on restaurant_reservation_links (restaurant_id);
create index if not exists idx_reservation_links_primary
  on restaurant_reservation_links (restaurant_id) where is_primary = true;
create unique index if not exists uq_reservation_links_one_primary_per_restaurant
  on restaurant_reservation_links (restaurant_id) where is_primary = true;

-- RLS: read for everyone, write via service role only
alter table restaurant_reservation_links enable row level security;

create policy "reservation_links_read_all"
  on restaurant_reservation_links for select using (true);
create policy "reservation_links_service_insert"
  on restaurant_reservation_links for insert with check (true);
create policy "reservation_links_service_update"
  on restaurant_reservation_links for update using (true);
create policy "reservation_links_service_delete"
  on restaurant_reservation_links for delete using (true);
