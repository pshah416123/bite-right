-- ============================================================================
-- Add 'llm' as a valid menu source_type.
--
-- Used when Claude Haiku infers a menu from Google review text — the
-- last-resort fallback after every real-source extractor (provider parsers,
-- PDF, generic scrape, Puppeteer) has failed.
-- ============================================================================

alter table restaurant_menus
  drop constraint if exists restaurant_menus_source_type_check;

alter table restaurant_menus
  add constraint restaurant_menus_source_type_check
  check (source_type in (
    'toast','popmenu','square','chownow','bentobox','clover',
    'wix','wordpress','yelp_menu','pdf','generic_scrape','chain_curated',
    'llm'
  ));
