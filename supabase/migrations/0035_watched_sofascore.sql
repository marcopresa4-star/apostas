-- Manual live widgets can carry the SofaScore link, so the Dashboard shows the
-- live tracker instead of names only. Run in the Supabase SQL editor.
alter table watched_matches add column if not exists sofascore_url text;
