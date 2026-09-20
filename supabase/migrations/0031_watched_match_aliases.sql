-- The teams of a hand-added widget game are now picked from the teams table,
-- so their other names ("Marseille" for "Olympique de Marseille") are kept
-- with the game: the live widget looks the match up by all of them. Older
-- rows have none and keep working with just the typed names.
-- Run this in the Supabase SQL editor BEFORE deploying the code that uses it.

alter table watched_matches add column if not exists home_aliases text;
alter table watched_matches add column if not exists away_aliases text;
