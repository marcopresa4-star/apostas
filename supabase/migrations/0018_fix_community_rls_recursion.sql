-- Fixes "infinite recursion detected in policy for relation picks".
-- tickets_select_published (added in 0017) queries picks directly, while
-- picks_select_own queries tickets right back - the two policies keep
-- re-triggering each other's RLS evaluation forever. Route the cross-table
-- check through a SECURITY DEFINER function, which runs with the
-- function's own privileges and so does not re-trigger picks' RLS.
-- Run this in the Supabase SQL editor.

create or replace function ticket_has_published_pick(check_ticket_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from picks where picks.ticket_id = check_ticket_id and picks.is_published = true
  );
$$;

grant execute on function ticket_has_published_pick(uuid) to authenticated;

drop policy if exists "tickets_select_published" on tickets;
create policy "tickets_select_published"
  on tickets for select
  to authenticated
  using (ticket_has_published_pick(id));
