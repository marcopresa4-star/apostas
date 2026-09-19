-- "Meia ganha" (half_green) and "meia perdida" (half_red): the two results of
-- Asian lines such as Acima(2.25). They count as half a Green / half a Red in
-- the stats. Run this in the Supabase SQL editor BEFORE using the new buttons,
-- otherwise saving one of these results is rejected by the old check.

-- The old check has an auto-generated name, so find it instead of assuming it.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.picks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%pending%'
  loop
    execute format('alter table public.picks drop constraint %I', c.conname);
  end loop;
end $$;

alter table picks
  add constraint picks_status_check
  check (status in ('pending', 'green', 'red', 'void', 'half_green', 'half_red'));
