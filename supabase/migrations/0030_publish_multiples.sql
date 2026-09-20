-- Lets you publish a multiple to the Comunidade, like a single pick: every
-- other logged-in user can then read that multiple and its games (never the
-- bookmaker link, which the Comunidade queries do not select). Run 0029 first,
-- then this in the Supabase SQL editor BEFORE deploying the code that uses it.
--
-- Unlike tickets/picks (see 0018) there is no policy loop to worry about: the
-- policies of "multiples" never look at "multiple_legs", only the other way
-- round.

alter table multiples add column if not exists is_published boolean not null default false;
alter table multiples add column if not exists published_at timestamptz;

drop policy if exists "multiples_select_published" on multiples;
create policy "multiples_select_published"
  on multiples for select
  to authenticated
  using (is_published = true);

drop policy if exists "multiple_legs_select_published" on multiple_legs;
create policy "multiple_legs_select_published"
  on multiple_legs for select
  to authenticated
  using (exists (select 1 from multiples m where m.id = multiple_legs.multiple_id and m.is_published = true));
