-- Adds support for "live" bets: instead of a single odd (pre-match), a
-- live pick defines an odd interval (odd_min/odd_max) at which you'd enter
-- that bet once the game is in progress. A game can have any mix of
-- pre-match and live picks. Run this in the Supabase SQL editor.

alter table picks add column if not exists bet_type text not null default 'pre_jogo'
  check (bet_type in ('pre_jogo', 'live'));

alter table picks add column if not exists odd_min numeric(6,2);
alter table picks add column if not exists odd_max numeric(6,2);
