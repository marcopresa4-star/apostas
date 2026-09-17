-- Optional external links per pick: SofaScore match page and the bookmaker's
-- game page, for quick access from the pick card.
-- Run this in the Supabase SQL editor.

alter table picks add column if not exists sofascore_url text;
alter table picks add column if not exists bookmaker_url text;
