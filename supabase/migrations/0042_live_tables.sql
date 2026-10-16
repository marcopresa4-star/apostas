-- Planeamento Live: user-defined tables (pattern filters) over upcoming games.
-- Run in the Supabase SQL editor BEFORE deploying the code that uses it.
create table if not exists live_tables (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  leagues_mode text not null default 'all' check (leagues_mode in ('favs', 'all', 'custom')),
  leagues text[] not null default '{}',
  sample text not null default 'last10' check (sample in ('last10', 'season')),
  venue_split boolean not null default false,
  criteria jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table live_tables enable row level security;

drop policy if exists "live_tables_select_own" on live_tables;
create policy "live_tables_select_own"
  on live_tables for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "live_tables_write_own" on live_tables;
create policy "live_tables_write_own"
  on live_tables for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "live_tables_update_own" on live_tables;
create policy "live_tables_update_own"
  on live_tables for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "live_tables_delete_own" on live_tables;
create policy "live_tables_delete_own"
  on live_tables for delete
  to authenticated
  using (auth.uid() = user_id);
