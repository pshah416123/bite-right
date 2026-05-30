-- ============================================================================
-- BiteRight users table — Phase 1 of the user system
--
-- Stores the application-level user record. id matches the Supabase auth.users
-- id (UUID stored as text, matching the project convention used by
-- logs/saved_restaurants/friendships).
--
-- Rows are auto-created lazily by the server on the first authenticated
-- request (see ensureUserRecord in server/index.js) — we don't use a
-- Supabase trigger so we can control the username derivation in one place.
-- ============================================================================

create table if not exists users (
  id              text        primary key,
  username        text        not null,
  display_name    text        not null,
  email           text,
  avatar_url      text,
  bio             text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Case-insensitive uniqueness on username so @foo and @Foo can't both exist.
create unique index if not exists idx_users_username_lower
  on users (lower(username));

-- Search: trigram-style prefix matches on username + display_name.
create index if not exists idx_users_username on users (lower(username) text_pattern_ops);
create index if not exists idx_users_display_name on users (lower(display_name) text_pattern_ops);

alter table users enable row level security;
create policy "users_read_all"    on users for select using (true);
create policy "users_service_insert" on users for insert with check (true);
create policy "users_service_update" on users for update using (true);
