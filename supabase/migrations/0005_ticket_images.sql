-- Adds support for attaching a screenshot/print to a pick (an individual
-- bet, not the game itself). Creates a private Storage bucket
-- "game-images" and the column that points at the uploaded file. The
-- bucket is not public: images are only reachable through short-lived
-- signed URLs generated for the logged-in user. Run this in the
-- Supabase SQL editor.

alter table tickets drop column if exists image_path;
alter table picks add column if not exists image_path text;

insert into storage.buckets (id, name, public)
values ('game-images', 'game-images', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "game_images_insert_authenticated" on storage.objects;
create policy "game_images_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'game-images');

drop policy if exists "game_images_select_public" on storage.objects;
drop policy if exists "game_images_select_authenticated" on storage.objects;
create policy "game_images_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'game-images');

drop policy if exists "game_images_update_authenticated" on storage.objects;
create policy "game_images_update_authenticated"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'game-images')
  with check (bucket_id = 'game-images');

drop policy if exists "game_images_delete_authenticated" on storage.objects;
create policy "game_images_delete_authenticated"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'game-images');
