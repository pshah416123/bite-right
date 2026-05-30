-- ============================================================================
-- Users: phone + visibility; new blocked_users table
--
-- All additive — existing rows remain valid (defaults applied).
-- ============================================================================

alter table users add column if not exists phone text;
alter table users add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'friends', 'private'));

-- ─── blocked_users ──────────────────────────────────────────────────────────
-- One row per (blocker → blocked) edge. Both columns are text to match the
-- existing users.id / friendships convention. Symmetric reads (the feed
-- filter excludes either direction) are handled in the query layer.
create table if not exists blocked_users (
  blocker_id    text        not null,
  blocked_id    text        not null,
  created_at    timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists idx_blocked_blocker on blocked_users (blocker_id);
create index if not exists idx_blocked_blocked on blocked_users (blocked_id);

alter table blocked_users enable row level security;
create policy "blocked_read_all"    on blocked_users for select using (true);
create policy "blocked_service_insert" on blocked_users for insert with check (true);
create policy "blocked_service_delete" on blocked_users for delete using (true);
