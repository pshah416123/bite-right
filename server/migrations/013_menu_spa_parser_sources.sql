-- ============================================================================
-- Add SPA / API-driven parser source_types.
--
-- next_data        — generic Next.js __NEXT_DATA__ walker. Identifies any
--                    array shaped like [{ name, products: [{ name, ... }] }]
--                    in the parsed JSON regardless of property naming.
--                    Catches Taco Bell-style corporate sites + many others.
-- dom_item_name    — generic class-keyed DOM walker. Matches elements with
--                    class containing item-name / product-name / dish-name
--                    plus nearby description / price siblings. Catches
--                    McDonald's-style AEM and other CMS-built restaurant
--                    sites we don't have explicit parsers for.
-- json_ld          — explicit name for schema.org Menu/MenuItem (was
--                    previously written as 'generic_scrape' even though the
--                    parser was JSON-LD-aware).
-- squarespace_text — the <h3>/<p> text-block parser from commit 2637984b.
--                    Was already producing 'squarespace' source rows; this
--                    just exposes the sub-strategy in the constraint so
--                    coverage analysis logs can distinguish it.
-- ============================================================================

alter table restaurant_menus
  drop constraint if exists restaurant_menus_source_type_check;

alter table restaurant_menus
  add constraint restaurant_menus_source_type_check
  check (source_type in (
    'toast','popmenu','square','chownow','bentobox','clover',
    'wix','wordpress','yelp_menu','pdf','generic_scrape','chain_curated',
    'llm','google_photo_ocr','page_image_ocr','dine_wp',
    'next_data','dom_item_name','json_ld','squarespace_text'
  ));
