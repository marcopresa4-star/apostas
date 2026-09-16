-- Adds a dedicated "selection" field (a aposta em si, ex: "Benfica vence",
-- "Mais de 2.5 golos") separate from the free-text "reason" field.
-- Run this in the Supabase SQL editor.

alter table bets
  add column if not exists selection text not null default '';

alter table bets
  alter column selection drop default;
