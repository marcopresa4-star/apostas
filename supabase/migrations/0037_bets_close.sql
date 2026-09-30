-- Closing price of a settled bet (bookmaker odd at full time, for
-- closing-line value: entry odd vs what the market closed at). Run in the
-- Supabase SQL editor.

alter table bets add column if not exists close_odd numeric;
