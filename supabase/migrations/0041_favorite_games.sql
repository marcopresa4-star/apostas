-- Favorite games to follow: starring a game in Jogos por dia watches it, and
-- the global watcher promotes it automatically when it kicks off (Em direto
-- feed + Jogos dashboard + pinned in Ao vivo). Run in the Supabase SQL editor.
create table if not exists favorite_games (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id integer not null,
  home text not null,
  away text not null,
  tournament text not null default '',
  promoted_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create index if not exists favorite_games_user_id_idx on favorite_games(user_id);

alter table favorite_games enable row level security;

drop policy if exists "favorite_games_select_own" on favorite_games;
create policy "favorite_games_select_own"
  on favorite_games for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "favorite_games_write_own" on favorite_games;
create policy "favorite_games_write_own"
  on favorite_games for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "favorite_games_update_own" on favorite_games;
create policy "favorite_games_update_own"
  on favorite_games for update
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "favorite_games_delete_own" on favorite_games;
create policy "favorite_games_delete_own"
  on favorite_games for delete
  to authenticated
  using (auth.uid() = user_id);
