-- Phase 3: the adapter needs local display names without reading the files, so
-- team links carry the local spelling too. Re-running "align all" backfills
-- it (upsert on the same keys). Run in the Supabase SQL editor.
alter table sofascore_maps add column if not exists local_name text not null default '';
