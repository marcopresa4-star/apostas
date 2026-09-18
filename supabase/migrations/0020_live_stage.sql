-- Live picks get a lifecycle: 'watching' (an idea, not a real bet yet),
-- 'active' (you entered, with the real entry odd) or 'skipped' (you never
-- entered). Only 'active' picks count in the stats/analysis; every pre-game
-- pick is simply 'active'. Run this in the Supabase SQL editor BEFORE
-- deploying the code that uses it (every picks query now selects these).

-- Guarded so re-running it can never flip picks you already entered back to
-- 'watching': the backfill only happens the one time the column is created.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'picks' and column_name = 'stage'
  ) then
    alter table picks
      add column stage text not null default 'active'
      check (stage in ('watching', 'active', 'skipped'));

    -- Existing live picks still pending were never resolved, so treat them as
    -- ideas you are watching. Already-resolved live picks stay 'active'.
    update picks set stage = 'watching'
    where bet_type = 'live' and status = 'pending';
  end if;
end $$;

-- The odd you actually entered at (set when a watching pick becomes active).
alter table picks add column if not exists entry_odd numeric;
