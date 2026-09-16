-- Allows attaching more than one print to a pick. Moves image_path off
-- "picks" into a new "pick_images" table (one row per uploaded image),
-- migrating any existing single image first. Run this in the Supabase
-- SQL editor.

create table if not exists pick_images (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references picks(id) on delete cascade,
  image_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists pick_images_pick_id_idx on pick_images(pick_id);

-- Migrate any existing single image per pick into the new table.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'picks' and column_name = 'image_path'
  ) then
    insert into pick_images (pick_id, image_path)
    select id, image_path from picks where image_path is not null;

    alter table picks drop column image_path;
  end if;
end $$;

alter table pick_images enable row level security;

drop policy if exists "pick_images_select_own" on pick_images;
create policy "pick_images_select_own"
  on pick_images for select
  to authenticated
  using (
    exists (
      select 1 from picks p
      join tickets t on t.id = p.ticket_id
      where p.id = pick_images.pick_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "pick_images_insert_own" on pick_images;
create policy "pick_images_insert_own"
  on pick_images for insert
  to authenticated
  with check (
    exists (
      select 1 from picks p
      join tickets t on t.id = p.ticket_id
      where p.id = pick_images.pick_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "pick_images_delete_own" on pick_images;
create policy "pick_images_delete_own"
  on pick_images for delete
  to authenticated
  using (
    exists (
      select 1 from picks p
      join tickets t on t.id = p.ticket_id
      where p.id = pick_images.pick_id and t.user_id = auth.uid()
    )
  );
