-- Community publishing: lets the admin mark specific bets visible to every
-- other logged-in user on a new /comunidade page. Regular users get a
-- 'user' role and can only ever see published picks (and, through them,
-- the game/prints they belong to) - nothing else the admin owns.
-- Run this in the Supabase SQL editor.

-- profiles: distinguishes admin from regular users. Only ever written by
-- you directly in the SQL editor below - there is no insert/update policy
-- for authenticated users, so nobody can grant themselves admin.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own"
  on profiles for select
  to authenticated
  using (auth.uid() = id);

-- picks: an is_published flag, plus a new select policy so any
-- authenticated user (not just the owner) can read a published pick.
alter table picks add column if not exists is_published boolean not null default false;

drop policy if exists "picks_select_published" on picks;
create policy "picks_select_published"
  on picks for select
  to authenticated
  using (is_published = true);

-- tickets: readable by anyone if at least one of its picks is published,
-- so the game (teams, competition, date/time) shows up alongside it.
drop policy if exists "tickets_select_published" on tickets;
create policy "tickets_select_published"
  on tickets for select
  to authenticated
  using (exists (select 1 from picks p where p.ticket_id = tickets.id and p.is_published = true));

-- pick_images: same, for prints attached to a published pick.
drop policy if exists "pick_images_select_published" on pick_images;
create policy "pick_images_select_published"
  on pick_images for select
  to authenticated
  using (exists (select 1 from picks p where p.id = pick_images.pick_id and p.is_published = true));

-- After running this, make yourself admin (replace with your login email):
-- insert into profiles (id, role)
-- select id, 'admin' from auth.users where email = 'seu-email@exemplo.com'
-- on conflict (id) do update set role = 'admin';
