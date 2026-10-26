-- 공릉천교 앱 · Supabase 초기 설정
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여넣고 Run 을 누르세요. 여러 번 실행해도 안전합니다.

-- 1) 기록 테이블: 앱의 모든 기록(공정률·일보·TBM·사진 정보)을 문서 단위로 저장
create table if not exists public.docs (
  col        text        not null,               -- 종류: progress, log, reports, photos, config, users ...
  id         text        not null,               -- 문서 이름 (예: 2026-10-26, A1)
  data       jsonb,
  deleted    boolean     not null default false,
  rev        bigint      not null default 0,     -- 변경 순번 (동기화용, 서버가 매김)
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (col, id)
);
create sequence if not exists public.docs_rev_seq;
create index if not exists docs_rev_idx on public.docs (rev);

create or replace function public.docs_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.rev := nextval('public.docs_rev_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- 2) 권한: 로그인한 사람만 읽고 쓸 수 있음 (삭제는 deleted 표시로 처리)
alter table public.docs enable row level security;
drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
create policy docs_read   on public.docs for select to authenticated using (true);
create policy docs_insert on public.docs for insert to authenticated with check (true);
create policy docs_update on public.docs for update to authenticated using (true) with check (true);

-- 3) 실시간 알림 (다른 기기에서 저장하면 바로 반영)
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 4) 사진 저장소 (비공개 버킷, 로그인한 사람만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_update on storage.objects;
drop policy if exists photos_delete on storage.objects;
create policy photos_read   on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy photos_update on storage.objects for update to authenticated using (bucket_id = 'photos');
create policy photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos');
