-- Simplifies live picks to a single minimum entry odd instead of a range.
-- Run this in the Supabase SQL editor.

alter table picks drop column if exists odd_max;
