-- teams and competitions never had a DELETE policy, so Row Level Security
-- was silently blocking every delete attempt (Postgres just reports 0 rows
-- affected, no error) — the item vanished from the UI locally but the row
-- was never actually removed, so it reappeared on the next page load.
-- Run this in the Supabase SQL editor.

drop policy if exists "teams_delete_authenticated" on teams;
create policy "teams_delete_authenticated"
  on teams for delete
  to authenticated
  using (true);

drop policy if exists "competitions_delete_authenticated" on competitions;
create policy "competitions_delete_authenticated"
  on competitions for delete
  to authenticated
  using (true);
