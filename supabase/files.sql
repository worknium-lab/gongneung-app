-- 공릉천교 앱 · 제출서류 파일 저장소 (PDF·엑셀·한글·사진 등, 한 파일 50MB까지)
-- Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 52428800, null)
on conflict (id) do update set file_size_limit = 52428800, allowed_mime_types = null;

drop policy if exists files_read   on storage.objects;
drop policy if exists files_insert on storage.objects;
drop policy if exists files_update on storage.objects;
drop policy if exists files_delete on storage.objects;
create policy files_read   on storage.objects for select to authenticated using (bucket_id = 'files');
create policy files_insert on storage.objects for insert to authenticated with check (bucket_id = 'files');
create policy files_update on storage.objects for update to authenticated using (bucket_id = 'files');
create policy files_delete on storage.objects for delete to authenticated using (bucket_id = 'files');
