-- Optional alert minute for live picks: once the match clock reaches this
-- minute, the dashboard highlights the pick as an active alert.
-- Run this in the Supabase SQL editor.

alter table picks add column if not exists alert_minute integer;
