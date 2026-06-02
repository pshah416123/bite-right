-- ============================================================================
-- Add 'page_image_ocr' and 'dine_wp' as valid menu source_types.
--
-- page_image_ocr — used when the restaurant publishes its menu as
--   uploaded screenshots embedded on its own /menu page (common on
--   Squarespace / Wix / Webflow). We OCR those page-embedded images
--   via Claude Haiku Vision. Slotted between Puppeteer and the Google
--   Place Photos OCR fallback.
--
-- dine_wp — the WordPress "Dine Framework" restaurant theme parser
--   added in commit c098a877 (Sabroso Chicago and similar). Was already
--   producing rows but the source value 'dine_wp' wasn't whitelisted,
--   which would have rejected the upsert had anyone tried to persist
--   a cache entry against it.
-- ============================================================================

alter table restaurant_menus
  drop constraint if exists restaurant_menus_source_type_check;

alter table restaurant_menus
  add constraint restaurant_menus_source_type_check
  check (source_type in (
    'toast','popmenu','square','chownow','bentobox','clover',
    'wix','wordpress','yelp_menu','pdf','generic_scrape','chain_curated',
    'llm','google_photo_ocr','page_image_ocr','dine_wp'
  ));
