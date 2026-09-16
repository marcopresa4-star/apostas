-- Schema for the "apostas" (bets tracker) app
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- countries
-- ---------------------------------------------------------------------------
create table if not exists countries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- competitions (ligas / competições), each belongs to a country
-- ---------------------------------------------------------------------------
create table if not exists competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_id uuid not null references countries(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (name, country_id)
);

create index if not exists competitions_country_id_idx on competitions(country_id);

-- ---------------------------------------------------------------------------
-- teams (equipas), each belongs to a country
-- ---------------------------------------------------------------------------
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_id uuid not null references countries(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (name, country_id)
);

create index if not exists teams_country_id_idx on teams(country_id);

-- ---------------------------------------------------------------------------
-- bets (apostas)
-- ---------------------------------------------------------------------------
create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  competition_id uuid not null references competitions(id) on delete restrict,
  home_team_id uuid not null references teams(id) on delete restrict,
  away_team_id uuid not null references teams(id) on delete restrict,
  match_date date not null,
  match_time time not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'green', 'red', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bets_teams_different check (home_team_id <> away_team_id)
);

create index if not exists bets_user_id_idx on bets(user_id);
create index if not exists bets_status_idx on bets(status);
create index if not exists bets_match_date_idx on bets(match_date);

-- keep updated_at fresh
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bets_set_updated_at on bets;
create trigger bets_set_updated_at
  before update on bets
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table countries enable row level security;
alter table competitions enable row level security;
alter table teams enable row level security;
alter table bets enable row level security;

-- countries: any authenticated user can read the reference list
drop policy if exists "countries_select_authenticated" on countries;
create policy "countries_select_authenticated"
  on countries for select
  to authenticated
  using (true);

-- competitions: authenticated users can read and add new ones
drop policy if exists "competitions_select_authenticated" on competitions;
create policy "competitions_select_authenticated"
  on competitions for select
  to authenticated
  using (true);

drop policy if exists "competitions_insert_authenticated" on competitions;
create policy "competitions_insert_authenticated"
  on competitions for insert
  to authenticated
  with check (true);

-- teams: authenticated users can read and add new ones
drop policy if exists "teams_select_authenticated" on teams;
create policy "teams_select_authenticated"
  on teams for select
  to authenticated
  using (true);

drop policy if exists "teams_insert_authenticated" on teams;
create policy "teams_insert_authenticated"
  on teams for insert
  to authenticated
  with check (true);

-- bets: strictly scoped to the owning user
drop policy if exists "bets_select_own" on bets;
create policy "bets_select_own"
  on bets for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "bets_insert_own" on bets;
create policy "bets_insert_own"
  on bets for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "bets_update_own" on bets;
create policy "bets_update_own"
  on bets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bets_delete_own" on bets;
create policy "bets_delete_own"
  on bets for delete
  to authenticated
  using (auth.uid() = user_id);
