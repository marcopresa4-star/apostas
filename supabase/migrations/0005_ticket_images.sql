-- Adds support for attaching a screenshot/print to a ticket (game).
-- Creates a public Storage bucket "game-images" and the column that
-- points at the uploaded file. Run this in the Supabase SQL editor.

alter table tickets add column if not exists image_path text;

insert into storage.buckets (id, name, public)
values ('game-images', 'game-images', true)
on conflict (id) do nothing;

drop policy if exists "game_images_insert_authenticated" on storage.objects;
create policy "game_images_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'game-images');

drop policy if exists "game_images_select_public" on storage.objects;
create policy "game_images_select_public"
  on storage.objects for select
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
