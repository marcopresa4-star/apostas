-- Phase 1 of "SofaScore only": where each league/team lives on SofaScore, plus a
-- cache of what was read there, so the historic tabs can later be fed from
-- SofaScore instead of the local files. Keyed per user like sportscore_teams.
-- Run this in the Supabase SQL editor BEFORE deploying the code that uses it.

-- kind 'tournament': name_key is the LEAGUES code ("pt.1"), sofascore_id the
-- uniqueTournament id (seasons/rounds/standings endpoints). kind 'team':
-- name_key is the club slug, sofascore_id the team id (phase 2).
create table if not exists sofascore_maps (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('tournament', 'team')),
  name_key text not null,
  sofascore_id integer not null,
  name text not null,
  slug text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, kind, name_key)
);

alter table sofascore_maps enable row level security;

drop policy if exists "sofascore_maps_select_own" on sofascore_maps;
create policy "sofascore_maps_select_own"
  on sofascore_maps for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "sofascore_maps_write_own" on sofascore_maps;
create policy "sofascore_maps_write_own"
  on sofascore_maps for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "sofascore_maps_update_own" on sofascore_maps;
create policy "sofascore_maps_update_own"
  on sofascore_maps for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sofascore_maps_delete_own" on sofascore_maps;
create policy "sofascore_maps_delete_own"
  on sofascore_maps for delete
  to authenticated
  using (auth.uid() = user_id);

-- Raw SofaScore payloads by key ("seasons:238", "round:238:97436:7",
-- "standings:238:97436:total", "team-last:3006:0"...), so seasons are read
-- once and the current one re-read on a TTL. Same data for everyone, but kept
-- per user so RLS stays trivial (single-user app).
create table if not exists sofascore_cache (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table sofascore_cache enable row level security;

drop policy if exists "sofascore_cache_select_own" on sofascore_cache;
create policy "sofascore_cache_select_own"
  on sofascore_cache for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "sofascore_cache_write_own" on sofascore_cache;
create policy "sofascore_cache_write_own"
  on sofascore_cache for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "sofascore_cache_update_own" on sofascore_cache;
create policy "sofascore_cache_update_own"
  on sofascore_cache for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sofascore_cache_delete_own" on sofascore_cache;
create policy "sofascore_cache_delete_own"
  on sofascore_cache for delete
  to authenticated
  using (auth.uid() = user_id);
