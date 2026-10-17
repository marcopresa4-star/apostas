-- Notas (Ferramentas): one free-text notepad per user.
-- Run in the Supabase SQL editor BEFORE deploying the code that uses it.
create table if not exists user_notes (
  user_id uuid not null default auth.uid() primary key references auth.users(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter table user_notes enable row level security;

drop policy if exists "user_notes_select_own" on user_notes;
create policy "user_notes_select_own"
  on user_notes for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_notes_insert_own" on user_notes;
create policy "user_notes_insert_own"
  on user_notes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_notes_update_own" on user_notes;
create policy "user_notes_update_own"
  on user_notes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
