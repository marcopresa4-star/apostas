-- In-app notifications for the Comunidade: each pick remembers when it was
-- published, and each user remembers when they last looked at the page, so
-- the app can show a badge/toast for anything published since then.
-- Run this in the Supabase SQL editor BEFORE deploying the code that uses it.

alter table picks add column if not exists published_at timestamptz;

-- Backfill: anything already published counts as published "some time ago".
update picks
set published_at = coalesce(updated_at, created_at)
where is_published = true and published_at is null;

create table if not exists community_reads (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table community_reads enable row level security;

drop policy if exists "community_reads_select_own" on community_reads;
create policy "community_reads_select_own"
  on community_reads for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "community_reads_insert_own" on community_reads;
create policy "community_reads_insert_own"
  on community_reads for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "community_reads_update_own" on community_reads;
create policy "community_reads_update_own"
  on community_reads for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
