-- Prepares the big team / competition import (0024 onwards):
--  1. "Reino Unido" is replaced by Inglaterra, Escócia, País de Gales and
--     Irlanda do Norte.
--  2. Extra countries that have football clubs but were missing from the list.
--  3. teams.aliases: other names of a club ("HJK Helsinki", "Man United"), so
--     the search box finds it by the name you know it by.
-- Safe to re-run.

-- Everything you filed under "Reino Unido" was English in practice (Premier
-- League, Championship, ...), so that row is renamed to Inglaterra: every team,
-- competition and game keeps working with no data moved. A Scottish, Welsh or
-- Northern Irish club you created yourself stays under Inglaterra.
do $$
declare
  uk uuid;
  eng uuid;
begin
  select id into uk from countries where name = 'Reino Unido';
  if uk is null then
    return;
  end if;

  select id into eng from countries where name = 'Inglaterra';
  if eng is null then
    update countries set name = 'Inglaterra' where id = uk;
  else
    -- Inglaterra already exists: move the rows over (skipping names that are
    -- already there) and drop Reino Unido once nothing points to it.
    update teams t set country_id = eng
      where t.country_id = uk
        and not exists (select 1 from teams x where x.country_id = eng and x.name = t.name);
    update competitions c set country_id = eng
      where c.country_id = uk
        and not exists (select 1 from competitions x where x.country_id = eng and x.name = c.name);
    delete from countries
      where id = uk
        and not exists (select 1 from teams where country_id = uk)
        and not exists (select 1 from competitions where country_id = uk);
  end if;
end $$;

insert into countries (name) values
  ('Inglaterra'),
  ('Escócia'),
  ('País de Gales'),
  ('Irlanda do Norte'),
  ('Zimbabué'),
  ('Ilhas Faroé'),
  ('Turquemenistão'),
  ('Mianmar'),
  ('Listenstaine'),
  ('Hong Kong'),
  ('Curaçau'),
  ('Aruba'),
  ('Macau'),
  ('Gibraltar')
on conflict (name) do nothing;

alter table teams add column if not exists aliases text;
