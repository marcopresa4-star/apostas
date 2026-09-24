-- Personal bets board: pre-match bets, live bets and games watched for a live
-- entry. Odds only, no stakes. Run in the Supabase SQL editor.

create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('pre', 'watch', 'live')),
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'void')),
  home_team text not null,
  away_team text not null,
  league_label text,
  market_key text not null,
  market_label text not null,
  odd numeric,
  sofascore_id bigint,
  kickoff timestamptz,
  target_odd numeric,
  target_minute integer,
  settled_auto boolean not null default false,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bets_user_id_idx on bets(user_id);
create index if not exists bets_user_status_idx on bets(user_id, status);

alter table bets enable row level security;

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
  using (auth.uid() = user_id);

drop policy if exists "bets_delete_own" on bets;
create policy "bets_delete_own"
  on bets for delete
  to authenticated
  using (auth.uid() = user_id);
