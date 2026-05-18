-- ============================================================================
-- BiteRight Phase 2 (part A): seed sample reservation links for the UI to
-- demo against. Uses public restaurant landing pages on each provider —
-- nothing scraped, nothing reverse-engineered.
--
-- Run AFTER 002_reservation_links.sql. Safe to re-run: clears existing rows
-- for the listed restaurants first.
-- ============================================================================

delete from restaurant_reservation_links
where restaurant_id in (
  'rest_1', 'rest_2', 'rest_3', 'rest_4', 'rest_5'
);

-- rest_1 — Lou Malnati's: Resy primary, phone fallback
insert into restaurant_reservation_links
  (restaurant_id, provider, url, is_primary, last_verified_at)
values
  ('rest_1', 'resy', 'https://resy.com/cities/chi/lou-malnatis', true,  now()),
  ('rest_1', 'website', 'https://www.loumalnatis.com/', false, now());
insert into restaurant_reservation_links
  (restaurant_id, provider, phone_number, is_primary, last_verified_at)
values
  ('rest_1', 'phone', '+1-312-828-9800', false, now());

-- rest_2 — Girl & the Goat: OpenTable primary, also Yelp + phone
insert into restaurant_reservation_links
  (restaurant_id, provider, url, is_primary, last_verified_at)
values
  ('rest_2', 'opentable', 'https://www.opentable.com/r/girl-and-the-goat-chicago', true, now()),
  ('rest_2', 'yelp', 'https://www.yelp.com/biz/girl-and-the-goat-chicago', false, now());
insert into restaurant_reservation_links
  (restaurant_id, provider, phone_number, is_primary, last_verified_at)
values
  ('rest_2', 'phone', '+1-312-492-6262', false, now());

-- rest_3 — Portillo's: website only (chain, no reservations)
insert into restaurant_reservation_links
  (restaurant_id, provider, url, is_primary, last_verified_at)
values
  ('rest_3', 'website', 'https://www.portillos.com/', true, now());

-- rest_4 — The Purple Pig: phone only (small spot, no online res)
insert into restaurant_reservation_links
  (restaurant_id, provider, phone_number, is_primary, last_verified_at)
values
  ('rest_4', 'phone', '+1-312-464-1744', true, now());

-- rest_5 — Au Cheval: SevenRooms primary, OpenTable secondary
insert into restaurant_reservation_links
  (restaurant_id, provider, url, is_primary, last_verified_at)
values
  ('rest_5', 'sevenrooms', 'https://www.sevenrooms.com/reservations/aucheval', true, now()),
  ('rest_5', 'opentable', 'https://www.opentable.com/r/au-cheval-chicago', false, now());
