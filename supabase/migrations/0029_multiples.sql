-- Multiple bets ("múltiplas"): one bet that joins two or more games. Each game
-- (a "leg") has its own selection, odd and result; the multiple's total odd and
-- its result are worked out from the legs in the app, so nothing here can drift
-- out of sync. They live in their own tables because a ticket is one game with
-- several independent bets on it, which is a different thing.
-- bet_type says whether it was a pre-game or a live multiple; live legs also
-- keep the game minute you entered at. Run this in the Supabase SQL editor
-- BEFORE deploying the code that uses it.

create table if not exists multiples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bet_type text not null default 'pre_jogo' check (bet_type in ('pre_jogo', 'live')),
  reason text,
  bookmaker_url text,
  created_at timestamptz not null default now()
);

create index if not exists multiples_user_id_idx on multiples(user_id);

create table if not exists multiple_legs (
  id uuid primary key default gen_random_uuid(),
  multiple_id uuid not null references multiples(id) on delete cascade,
  competition_id uuid not null references competitions(id) on delete restrict,
  home_team_id uuid not null references teams(id) on delete restrict,
  away_team_id uuid not null references teams(id) on delete restrict,
  match_date date not null,
  match_time time not null,
  selection text not null,
  category_id uuid references bet_categories(id) on delete set null,
  odd numeric(6,2) not null check (odd > 1),
  entry_minute integer check (entry_minute is null or (entry_minute >= 0 and entry_minute <= 150)),
  status text not null default 'pending'
    check (status in ('pending', 'green', 'red', 'void', 'half_green', 'half_red')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint multiple_legs_teams_different check (home_team_id <> away_team_id)
);

create index if not exists multiple_legs_multiple_id_idx on multiple_legs(multiple_id);
create index if not exists multiple_legs_match_date_idx on multiple_legs(match_date);

drop trigger if exists multiple_legs_set_updated_at on multiple_legs;
create trigger multiple_legs_set_updated_at
  before update on multiple_legs
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: only the owner sees or changes their multiples. They are
-- not published to the Comunidade.
-- ---------------------------------------------------------------------------
alter table multiples enable row level security;
alter table multiple_legs enable row level security;

drop policy if exists "multiples_select_own" on multiples;
create policy "multiples_select_own"
  on multiples for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "multiples_insert_own" on multiples;
create policy "multiples_insert_own"
  on multiples for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "multiples_update_own" on multiples;
create policy "multiples_update_own"
  on multiples for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "multiples_delete_own" on multiples;
create policy "multiples_delete_own"
  on multiples for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "multiple_legs_select_own" on multiple_legs;
create policy "multiple_legs_select_own"
  on multiple_legs for select
  to authenticated
  using (exists (select 1 from multiples m where m.id = multiple_legs.multiple_id and m.user_id = auth.uid()));

drop policy if exists "multiple_legs_insert_own" on multiple_legs;
create policy "multiple_legs_insert_own"
  on multiple_legs for insert
  to authenticated
  with check (exists (select 1 from multiples m where m.id = multiple_legs.multiple_id and m.user_id = auth.uid()));

drop policy if exists "multiple_legs_update_own" on multiple_legs;
create policy "multiple_legs_update_own"
  on multiple_legs for update
  to authenticated
  using (exists (select 1 from multiples m where m.id = multiple_legs.multiple_id and m.user_id = auth.uid()))
  with check (exists (select 1 from multiples m where m.id = multiple_legs.multiple_id and m.user_id = auth.uid()));

drop policy if exists "multiple_legs_delete_own" on multiple_legs;
create policy "multiple_legs_delete_own"
  on multiple_legs for delete
  to authenticated
  using (exists (select 1 from multiples m where m.id = multiple_legs.multiple_id and m.user_id = auth.uid()));
