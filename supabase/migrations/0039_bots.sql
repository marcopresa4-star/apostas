-- Live-monitoring bots: user-defined conditions over games in progress,
-- plus the alerts they fired (settled when the game finishes, for hit-rate).
-- Run in the Supabase SQL editor BEFORE deploying the code that uses it.
create table if not exists bots (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  silent boolean not null default false,
  mode text not null default 'and' check (mode in ('and', 'or')),
  leagues text[] not null default '{}',
  minute_from integer not null default 1,
  minute_to integer not null default 90,
  period text not null default 'any' check (period in ('any', 'first', 'second', 'half')),
  score text not null default 'any',
  market text not null default 'mais1',
  min_prob double precision null,
  min_odd double precision null,
  stats jsonb not null default '[]',
  pregame jsonb not null default '[]',
  refire boolean not null default false,
  created_at timestamptz not null default now()
);

alter table bots enable row level security;

drop policy if exists "bots_select_own" on bots;
create policy "bots_select_own"
  on bots for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bots_write_own" on bots;
create policy "bots_write_own"
  on bots for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bots_update_own" on bots;
create policy "bots_update_own"
  on bots for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bots_delete_own" on bots;
create policy "bots_delete_own"
  on bots for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists bot_alerts (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bot_id uuid not null references bots(id) on delete cascade,
  event_id integer not null,
  minute integer not null,
  home text not null,
  away text not null,
  hg integer not null,
  ag integer not null,
  market text not null,
  text text not null,
  hit boolean null,
  created_at timestamptz not null default now(),
  unique (bot_id, event_id, minute, hg, ag)
);

alter table bot_alerts enable row level security;

drop policy if exists "bot_alerts_select_own" on bot_alerts;
create policy "bot_alerts_select_own"
  on bot_alerts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bot_alerts_write_own" on bot_alerts;
create policy "bot_alerts_write_own"
  on bot_alerts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bot_alerts_update_own" on bot_alerts;
create policy "bot_alerts_update_own"
  on bot_alerts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bot_alerts_delete_own" on bot_alerts;
create policy "bot_alerts_delete_own"
  on bot_alerts for delete
  to authenticated
  using (auth.uid() = user_id);
