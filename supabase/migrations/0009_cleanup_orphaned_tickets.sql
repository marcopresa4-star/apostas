-- One-time cleanup: removes tickets left over with zero picks (this could
-- happen when a pick was deleted without also deleting its ticket — the
-- ticket became invisible in the dashboard but still referenced its
-- team/competition rows, blocking their deletion). Run this once in the
-- Supabase SQL editor.

delete from tickets
where id not in (select distinct ticket_id from picks);
