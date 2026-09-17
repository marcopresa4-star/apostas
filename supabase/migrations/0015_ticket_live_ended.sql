-- Manual override to mark a game as finished before the kickoff-time
-- heuristic window (~2h15m) would naturally clear it.
-- Run this in the Supabase SQL editor.

alter table tickets add column if not exists live_ended boolean not null default false;
