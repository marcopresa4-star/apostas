-- Lets you add a live widget for a match you have no bet on at all — just
-- two team names, shown in the "Ao vivo agora" section.
-- Run this in the Supabase SQL editor.

create table if not exists watched_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  home_team text not null,
  away_team text not null,
  created_at timestamptz not null default now()
);

create index if not exists watched_matches_user_id_idx on watched_matches(user_id);

alter table watched_matches enable row level security;

drop policy if exists "watched_matches_select_own" on watched_matches;
create policy "watched_matches_select_own"
  on watched_matches for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "watched_matches_insert_own" on watched_matches;
create policy "watched_matches_insert_own"
  on watched_matches for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "watched_matches_delete_own" on watched_matches;
create policy "watched_matches_delete_own"
  on watched_matches for delete
  to authenticated
  using (auth.uid() = user_id);
