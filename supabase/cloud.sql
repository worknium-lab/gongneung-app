-- 공릉천교 앱 · 클라우드 탭: 니움클라우드(그룹웨어) 폴더를 다른 계정에 공유하는 규칙
-- 홈 서버 DB에서 한 번 실행. 여러 번 실행해도 안전합니다.
--  · 니움클라우드는 원래 본인 것만 보임 (groupware.cloud_items, 저장소 cloud 버킷 '<주인 ID>/<항목 ID>')
--  · 이 규칙은 "폴더 하나 + 계정 하나" 단위로 그 폴더 안(하위 폴더 포함)만 열어 줌
--  · 공유받은 계정이 할 수 있는 일: 보기 · 내려받기, (can_write 이면) 파일 올리기 · 새 폴더
--    못 하는 일: 지우기 · 이름 바꾸기 · 옮기기 · 휴지통 (주인만)
--  · 올린 파일의 주인은 폴더 주인으로 기록됨 → 주인의 니움클라우드에 그대로 보이고 주인 용량으로 계산
--  · 공유 걸기/끊기는 맨 아래 예시처럼 이 표에 줄을 넣고 지우면 됨

create table if not exists groupware.cloud_grants (
  folder_id uuid not null references groupware.cloud_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_write boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (folder_id, user_id)
);
create index if not exists cloud_grants_user on groupware.cloud_grants (user_id);
alter table groupware.cloud_grants enable row level security;
-- 내가 받은 공유만 보임 (걸기 · 끊기는 서버에서 직접)
drop policy if exists "내가 받은 공유" on groupware.cloud_grants;
create policy "내가 받은 공유" on groupware.cloud_grants for select to authenticated using (user_id = auth.uid());
grant select on groupware.cloud_grants to authenticated;

-- 이 항목(또는 그 위 폴더 중 하나)이 나에게 공유됐는지. 휴지통에 든 것(위 폴더 포함)은 제외
create or replace function groupware.cloud_granted(p_item uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select id, parent_id, trashed_at from groupware.cloud_items where id = p_item
    union all
    select c.id, c.parent_id, c.trashed_at from groupware.cloud_items c join up on c.id = up.parent_id
  )
  select not exists (select 1 from up where trashed_at is not null)
     and exists (select 1 from up join groupware.cloud_grants g on g.folder_id = up.id
                 where g.user_id = auth.uid() and (g.can_write or not p_write))
$$;
-- 쓰기 공유를 받은 폴더면 그 폴더 주인의 ID, 아니면 null (새 항목의 주인을 폴더 주인으로 맞추는 데 씀)
create or replace function groupware.cloud_grant_owner(p_folder uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select i.owner from groupware.cloud_items i
  where i.id = p_folder and i.is_folder and groupware.cloud_granted(p_folder, true)
$$;
-- 저장소 파일 이름('<주인 ID>/<항목 ID>')이 나에게 공유된 항목인지
create or replace function groupware.cloud_obj_granted(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (select 1 from groupware.cloud_items i
                 where i.id = split_part(p_name, '/', 2)::uuid and i.owner::text = split_part(p_name, '/', 1)
                   and not i.is_folder and groupware.cloud_granted(i.id, false))
    else false end
$$;
-- 이 주인이 나에게 쓰기 공유한 폴더가 하나라도 있는지 (새 파일을 그 주인 자리에 올릴 수 있는지)
create or replace function groupware.cloud_can_upload_to(p_owner text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from groupware.cloud_grants g join groupware.cloud_items i on i.id = g.folder_id
                 where g.user_id = auth.uid() and g.can_write and i.trashed_at is null and i.owner::text = p_owner)
$$;
revoke all on function groupware.cloud_granted(uuid, boolean), groupware.cloud_grant_owner(uuid),
  groupware.cloud_obj_granted(text), groupware.cloud_can_upload_to(text) from public, anon;
grant execute on function groupware.cloud_granted(uuid, boolean), groupware.cloud_grant_owner(uuid),
  groupware.cloud_obj_granted(text), groupware.cloud_can_upload_to(text) to authenticated;

-- 표: 공유받은 폴더 안은 보이고, 쓰기 공유면 그 안에 새 항목을 넣을 수 있음 (주인 = 폴더 주인)
drop policy if exists "공유받은 클라우드 보기" on groupware.cloud_items;
create policy "공유받은 클라우드 보기" on groupware.cloud_items for select to authenticated
  using (owner <> auth.uid() and groupware.cloud_granted(id, false));
drop policy if exists "공유받은 클라우드에 넣기" on groupware.cloud_items;
create policy "공유받은 클라우드에 넣기" on groupware.cloud_items for insert to authenticated
  with check (owner <> auth.uid() and parent_id is not null and trashed_at is null
              and owner = groupware.cloud_grant_owner(parent_id));

-- 저장소: 공유받은 파일 읽기, 쓰기 공유를 준 주인 자리에 새 파일 올리기 (덮어쓰기 · 지우기는 안 됨)
drop policy if exists "공유받은 클라우드 파일 보기" on storage.objects;
create policy "공유받은 클라우드 파일 보기" on storage.objects for select to authenticated
  using (bucket_id = 'cloud' and (storage.foldername(name))[1] <> auth.uid()::text
         and (owner_id = auth.uid()::text or groupware.cloud_obj_granted(name)));   -- 내가 방금 올린 것(표에 등록 전)도 포함
drop policy if exists "공유받은 클라우드 파일 올리기" on storage.objects;
create policy "공유받은 클라우드 파일 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'cloud' and (storage.foldername(name))[1] <> auth.uid()::text
              and groupware.cloud_can_upload_to((storage.foldername(name))[1]));

notify pgrst, 'reload schema';

-- 공유 걸기 예시 (admin 의 '01 공릉천교 내진보강공사' 폴더를 앱 계정에):
-- insert into groupware.cloud_grants (folder_id, user_id, can_write)
-- select i.id, u.id, true from groupware.cloud_items i, auth.users u
-- where i.name = '01 공릉천교 내진보강공사' and i.parent_id is null and i.trashed_at is null
--   and i.owner = (select id from groupware.profiles where login_id = 'admin')
--   and u.email in ('worknium@gmail.com')
-- on conflict do nothing;
-- 공유 끊기: delete from groupware.cloud_grants where user_id = (select id from auth.users where email = '...');
