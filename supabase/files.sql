-- 공릉천교 앱 · 제출서류 파일 저장소 (PDF·엑셀·한글·사진 등, 한 파일 50MB까지)
-- Supabase 대시보드 → SQL Editor → New query 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.
-- 읽기 · 쓰기 권한은 setup.sql 의 gn_select / gn_insert / gn_update / gn_delete 정책이 photos · files 버킷을 같이 다룹니다
-- (사용 허용 목록 gn_members 에 있는 계정만). 여기서는 버킷만 만듭니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 52428800, null)
on conflict (id) do update set file_size_limit = 52428800, allowed_mime_types = null;
