-- Personal live feed: up to 5 games the user follows, each with its own
-- evolution chart. Added before kickoff; snapshots start when the game does.
-- Run in the Supabase SQL editor BEFORE deploying the code that uses it.
create table if not exists feed_games (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id integer not null,
  home text not null,
  away text not null,
  tournament text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

alter table feed_games enable row level security;

drop policy if exists "feed_games_select_own" on feed_games;
create policy "feed_games_select_own"
  on feed_games for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "feed_games_write_own" on feed_games;
create policy "feed_games_write_own"
  on feed_games for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "feed_games_delete_own" on feed_games;
create policy "feed_games_delete_own"
  on feed_games for delete
  to authenticated
  using (auth.uid() = user_id);
