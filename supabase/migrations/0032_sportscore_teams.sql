-- What Sportscore calls each club, taught once by pasting a link to one of its
-- matches, so the live widget finds every game of that club without renaming
-- anything in the teams table. Keyed by the club's name (as a slug), not by
-- team id: it also covers games added by hand, which only have names.
-- Run this in the Supabase SQL editor BEFORE deploying the code that uses it.

create table if not exists sportscore_teams (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name_key text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, name_key)
);

alter table sportscore_teams enable row level security;

drop policy if exists "sportscore_teams_select_own" on sportscore_teams;
create policy "sportscore_teams_select_own"
  on sportscore_teams for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "sportscore_teams_insert_own" on sportscore_teams;
create policy "sportscore_teams_insert_own"
  on sportscore_teams for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "sportscore_teams_update_own" on sportscore_teams;
create policy "sportscore_teams_update_own"
  on sportscore_teams for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sportscore_teams_delete_own" on sportscore_teams;
create policy "sportscore_teams_delete_own"
  on sportscore_teams for delete
  to authenticated
  using (auth.uid() = user_id);
