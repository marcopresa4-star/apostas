-- Bot goal filters at fire time: total goals, score difference and
-- first/second-half goals (the "Onde e quando" section of the form). JSON:
-- { total: "any"|"lt"|"gte", totalV: n, diff, diffV, fh: ..."|exact", fhV, sh, shV }
-- null = no filters (bots created before this column keep firing as before).
alter table bots add column if not exists goal_rules jsonb;
