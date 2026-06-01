-- ============================================================================
-- Add 'google_photo_ocr' as a valid menu source_type.
--
-- Used when no other extractor (provider parsers, PDF, scrape, Puppeteer)
-- yielded a menu but Google Place Photos contains photos that read as menus
-- via Claude Haiku vision. Slotted just before the LLM review-text fallback.
-- ============================================================================

alter table restaurant_menus
  drop constraint if exists restaurant_menus_source_type_check;

alter table restaurant_menus
  add constraint restaurant_menus_source_type_check
  check (source_type in (
    'toast','popmenu','square','chownow','bentobox','clover',
    'wix','wordpress','yelp_menu','pdf','generic_scrape','chain_curated',
    'llm','google_photo_ocr'
  ));
