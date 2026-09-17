-- Adds reusable "bet type" categories (e.g. "Over/Under", "Ambas
-- Marcam", "Handicap Asiatico") that can be attached to any pick,
-- so performance can be tracked by category on the Dashboard.
-- Run this in the Supabase SQL editor.

create table if not exists bet_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table bet_categories enable row level security;

drop policy if exists "bet_categories_select_authenticated" on bet_categories;
create policy "bet_categories_select_authenticated"
  on bet_categories for select
  to authenticated
  using (true);

drop policy if exists "bet_categories_insert_authenticated" on bet_categories;
create policy "bet_categories_insert_authenticated"
  on bet_categories for insert
  to authenticated
  with check (true);

alter table picks add column if not exists category_id uuid references bet_categories(id) on delete set null;
create index if not exists picks_category_id_idx on picks(category_id);
