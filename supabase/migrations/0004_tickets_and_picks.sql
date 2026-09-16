-- Splits "bets" into two tables so a single game can hold multiple bets:
--   tickets: the game itself (competition, teams, date, time)
--   picks:   each individual bet placed on that game (selection, reason, status)
-- Existing rows in "bets" are migrated 1:1 (one ticket + one pick each) before
-- the old table is dropped. Run this in the Supabase SQL editor.

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  competition_id uuid not null references competitions(id) on delete restrict,
  home_team_id uuid not null references teams(id) on delete restrict,
  away_team_id uuid not null references teams(id) on delete restrict,
  match_date date not null,
  match_time time not null,
  created_at timestamptz not null default now(),
  constraint tickets_teams_different check (home_team_id <> away_team_id)
);

create index if not exists tickets_user_id_idx on tickets(user_id);
create index if not exists tickets_match_date_idx on tickets(match_date);

create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  selection text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'green', 'red', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists picks_ticket_id_idx on picks(ticket_id);
create index if not exists picks_status_idx on picks(status);

drop trigger if exists picks_set_updated_at on picks;
create trigger picks_set_updated_at
  before update on picks
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Migrate existing data from "bets" (if that table still exists)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'bets') then
    insert into tickets (id, user_id, competition_id, home_team_id, away_team_id, match_date, match_time, created_at)
    select id, user_id, competition_id, home_team_id, away_team_id, match_date, match_time, created_at
    from bets
    on conflict (id) do nothing;

    if exists (
      select 1 from information_schema.columns
      where table_name = 'bets' and column_name = 'selection'
    ) then
      insert into picks (ticket_id, selection, reason, status, created_at, updated_at)
      select id, selection, reason, status, created_at, updated_at
      from bets;
    else
      insert into picks (ticket_id, selection, reason, status, created_at, updated_at)
      select id, coalesce(reason, 'Aposta'), reason, status, created_at, updated_at
      from bets;
    end if;

    drop table bets;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table tickets enable row level security;
alter table picks enable row level security;

drop policy if exists "tickets_select_own" on tickets;
create policy "tickets_select_own"
  on tickets for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "tickets_insert_own" on tickets;
create policy "tickets_insert_own"
  on tickets for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "tickets_update_own" on tickets;
create policy "tickets_update_own"
  on tickets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tickets_delete_own" on tickets;
create policy "tickets_delete_own"
  on tickets for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "picks_select_own" on picks;
create policy "picks_select_own"
  on picks for select
  to authenticated
  using (exists (select 1 from tickets t where t.id = picks.ticket_id and t.user_id = auth.uid()));

drop policy if exists "picks_insert_own" on picks;
create policy "picks_insert_own"
  on picks for insert
  to authenticated
  with check (exists (select 1 from tickets t where t.id = picks.ticket_id and t.user_id = auth.uid()));

drop policy if exists "picks_update_own" on picks;
create policy "picks_update_own"
  on picks for update
  to authenticated
  using (exists (select 1 from tickets t where t.id = picks.ticket_id and t.user_id = auth.uid()))
  with check (exists (select 1 from tickets t where t.id = picks.ticket_id and t.user_id = auth.uid()));

drop policy if exists "picks_delete_own" on picks;
create policy "picks_delete_own"
  on picks for delete
  to authenticated
  using (exists (select 1 from tickets t where t.id = picks.ticket_id and t.user_id = auth.uid()));
