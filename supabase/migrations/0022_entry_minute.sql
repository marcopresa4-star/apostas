-- The game minute at which you entered a live bet ("entrei aos 35'"). Only set
-- on live picks that are active; older ones simply stay empty. Run this in the
-- Supabase SQL editor BEFORE deploying the code that uses it (every picks
-- query now selects it).

alter table picks
  add column if not exists entry_minute integer
  check (entry_minute is null or (entry_minute >= 0 and entry_minute <= 150));
