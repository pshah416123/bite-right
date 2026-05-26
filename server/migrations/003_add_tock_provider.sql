-- ============================================================================
-- Allow 'tock' as a reservation provider. Existing rows are unaffected.
-- Run once against an already-migrated database.
-- ============================================================================

alter table restaurant_reservation_links
  drop constraint if exists restaurant_reservation_links_provider_check;

alter table restaurant_reservation_links
  add constraint restaurant_reservation_links_provider_check
  check (provider in ('opentable','resy','sevenrooms','tock','yelp','website','phone'));
