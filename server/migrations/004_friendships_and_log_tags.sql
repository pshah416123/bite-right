-- ============================================================================
-- BiteRight social tagging — Phase 1
--
-- Adds:
--   1) friendships         — pairwise friend graph with status
--   2) log_tags            — friends tagged on a restaurant log
--
-- Both tables are additive. Existing logs/saves/restaurants tables untouched.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ─── friendships ────────────────────────────────────────────────────────────
-- Canonical ordering (user_a < user_b lexically) — one row per pair, status
-- transitions: pending → accepted, or pending/accepted → blocked.
create table if not exists friendships (
  user_a        text        not null,
  user_b        text        not null,
  status        text        not null default 'pending'
                check (status in ('pending','accepted','blocked')),
  initiated_by  text        not null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create index if not exists idx_friendships_user_a on friendships (user_a) where status = 'accepted';
create index if not exists idx_friendships_user_b on friendships (user_b) where status = 'accepted';

-- ─── log_tags ───────────────────────────────────────────────────────────────
-- Author tags a friend on a log. A tag transitions out of 'active' when
-- either the author removes it or the tagged user removes themselves —
-- preserved for audit instead of being hard-deleted.
create table if not exists log_tags (
  id             uuid        primary key default uuid_generate_v4(),
  log_id         text        not null references logs(id) on delete cascade,
  tagged_user_id text        not null,
  tagged_by      text        not null,                -- denormalized for fast feed reads
  status         text        not null default 'active'
                 check (status in ('active','removed_by_author','removed_by_tagged')),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  unique (log_id, tagged_user_id)
);

-- Fast lookups: log → its active tags
create index if not exists idx_log_tags_log
  on log_tags (log_id) where status = 'active';
-- "What logs am I tagged in?"
create index if not exists idx_log_tags_user
  on log_tags (tagged_user_id) where status = 'active';
-- "Restaurants A and B visited together" — the pair index does the heavy lift
create index if not exists idx_log_tags_pair
  on log_tags (tagged_by, tagged_user_id) where status = 'active';

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table friendships enable row level security;
create policy "friendships_read_all"     on friendships for select using (true);
create policy "friendships_service_insert" on friendships for insert with check (true);
create policy "friendships_service_update" on friendships for update using (true);
create policy "friendships_service_delete" on friendships for delete using (true);

alter table log_tags enable row level security;
create policy "log_tags_read_active"     on log_tags for select using (status = 'active');
create policy "log_tags_service_insert"  on log_tags for insert with check (true);
create policy "log_tags_service_update"  on log_tags for update using (true);
create policy "log_tags_service_delete"  on log_tags for delete using (true);
