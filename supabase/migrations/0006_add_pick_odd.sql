-- Adds an optional "odd" (betting odds, e.g. 1.85) field to each pick.
-- Run this in the Supabase SQL editor.

alter table picks add column if not exists odd numeric(6,2);
