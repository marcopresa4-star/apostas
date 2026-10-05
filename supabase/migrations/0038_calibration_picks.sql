-- Continuous calibration: every suggested pick the Comparar tab shows is logged
-- once per game (first suggestion wins), then settled when the fixture gains a
-- result. Hit-rate vs predicted chance, per market family. Run in the
-- Supabase SQL editor BEFORE deploying the code that uses it.
create table if not exists calibration_picks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  league text not null,
  home text not null,
  away text not null,
  match_date text not null,
  pick_key text not null,
  pick_group text not null,
  label text not null,
  p double precision not null,
  base double precision not null,
  fair double precision not null,
  result text null check (result in ('won', 'lost', 'void')),
  settled_at timestamptz null,
  created_at timestamptz not null default now(),
  primary key (user_id, league, home, away, match_date, pick_key)
);

alter table calibration_picks enable row level security;

drop policy if exists "calibration_picks_select_own" on calibration_picks;
create policy "calibration_picks_select_own"
  on calibration_picks for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "calibration_picks_write_own" on calibration_picks;
create policy "calibration_picks_write_own"
  on calibration_picks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "calibration_picks_update_own" on calibration_picks;
create policy "calibration_picks_update_own"
  on calibration_picks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "calibration_picks_delete_own" on calibration_picks;
create policy "calibration_picks_delete_own"
  on calibration_picks for delete
  to authenticated
  using (auth.uid() = user_id);
