-- ============================================================================
-- BiteRight Phase 2: Extend logs for cross-user feed
--
-- The iOS feed needs more than rating/notes/photos to render its cards. Adds:
--   - user_name: denormalized display name (faster than a users-table join
--     until we have a real users table)
--   - standout_dish: the dish the logger called out as a highlight
--   - dishes: all ordered dishes
--   - vibe_tags: highlighted vibe attributes (cozy, lively, etc.)
--   - quick_tip: short prose tip for the feed
--   - highlight: 'food' | 'vibe' | 'service' | 'value' bucket
--
-- All columns nullable so existing rows remain valid.
-- ============================================================================

alter table logs add column if not exists user_name text;
alter table logs add column if not exists standout_dish text;
alter table logs add column if not exists dishes text[];
alter table logs add column if not exists vibe_tags text[];
alter table logs add column if not exists quick_tip text;
alter table logs add column if not exists highlight text;

-- Speed up the feed query (logs ordered by created_at desc, join on restaurant_id).
create index if not exists idx_logs_created_at_desc on logs (created_at desc);
