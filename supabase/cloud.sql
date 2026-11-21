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

-- ---------- 폴더 용량 한도 ----------
-- 폴더 하나에 한도를 걸면 그 안(하위 폴더 · 휴지통에 든 것 포함)의 파일 크기 합이 한도를 넘는 올리기 · 옮겨 넣기를 막음
-- 누가 올리든(주인 · 공유받은 계정 · 서버 명령) 똑같이 적용. 한도 걸기/바꾸기는 맨 아래 예시
create table if not exists groupware.cloud_quotas (
  folder_id uuid primary key references groupware.cloud_items(id) on delete cascade,
  quota_bytes bigint not null check (quota_bytes > 0),
  created_at timestamptz not null default now()
);
alter table groupware.cloud_quotas enable row level security;   -- 직접 읽고 쓰기는 막고, 아래 함수로만 봄

-- 이 항목(또는 그 위 폴더) 중 한도가 걸린 가장 가까운 폴더
create or replace function groupware.cloud_quota_root(p_item uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select id, parent_id, 0 as depth from groupware.cloud_items where id = p_item
    union all
    select c.id, c.parent_id, up.depth + 1 from groupware.cloud_items c join up on c.id = up.parent_id
  )
  select up.id from up join groupware.cloud_quotas q on q.folder_id = up.id order by up.depth limit 1
$$;
-- 폴더 안 파일 크기 합 (p_except 와 그 아래는 빼고 셈)
create or replace function groupware.cloud_subtree_size(p_folder uuid, p_except uuid default null)
returns bigint language sql stable security definer set search_path = '' as $$
  with recursive t as (
    select id, size, is_folder from groupware.cloud_items where id = p_folder
    union all
    select c.id, c.size, c.is_folder from groupware.cloud_items c join t on c.parent_id = t.id
    where p_except is null or c.id <> p_except
  )
  select coalesce(sum(size) filter (where not is_folder), 0)::bigint from t
$$;
create or replace function groupware.cloud_quota_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_root uuid; v_quota bigint; v_used bigint; v_add bigint;
begin
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id and new.size <= old.size then return new; end if;
  if new.parent_id is null then return new; end if;
  v_root := groupware.cloud_quota_root(new.parent_id);
  if v_root is null then return new; end if;
  select quota_bytes into v_quota from groupware.cloud_quotas where folder_id = v_root;
  v_add := case when new.is_folder then (case when tg_op = 'UPDATE' then groupware.cloud_subtree_size(new.id) else 0 end) else new.size end;
  if v_add = 0 then return new; end if;
  v_used := groupware.cloud_subtree_size(v_root, case when tg_op = 'UPDATE' then new.id else null end);
  if v_used + v_add > v_quota then
    raise exception '클라우드 용량 한도를 넘어요 (한도 %, 사용 중 %, 넣으려는 크기 %)',
      pg_size_pretty(v_quota), pg_size_pretty(v_used), pg_size_pretty(v_add) using errcode = '53100';
  end if;
  return new;
end $$;
drop trigger if exists cloud_quota_check on groupware.cloud_items;
create trigger cloud_quota_check before insert or update of parent_id, size on groupware.cloud_items
  for each row execute function groupware.cloud_quota_check();

-- 앱 · 그룹웨어 화면용: 이 폴더에 적용되는 한도와 사용량 (주인이거나 공유받은 사람만, 한도가 없으면 빈 결과)
create or replace function groupware.cloud_quota_info(p_folder uuid)
returns table (folder_id uuid, quota_bytes bigint, used_bytes bigint)
language sql stable security definer set search_path = '' as $$
  select q.folder_id, q.quota_bytes, groupware.cloud_subtree_size(q.folder_id)
  from groupware.cloud_quotas q
  where q.folder_id = groupware.cloud_quota_root(p_folder)
    and (exists (select 1 from groupware.cloud_items i where i.id = p_folder and i.owner = auth.uid())
         or groupware.cloud_granted(p_folder, false))
$$;
revoke all on function groupware.cloud_quota_root(uuid), groupware.cloud_subtree_size(uuid, uuid), groupware.cloud_quota_check(),
  groupware.cloud_quota_info(uuid) from public, anon, authenticated;
grant execute on function groupware.cloud_quota_info(uuid) to authenticated;

notify pgrst, 'reload schema';

-- 한도 걸기/바꾸기 예시 (50GB):
-- insert into groupware.cloud_quotas (folder_id, quota_bytes)
-- select id, 50::bigint * 1024 * 1024 * 1024 from groupware.cloud_items
-- where name = '01 공릉천교 내진보강공사' and parent_id is null and trashed_at is null
-- on conflict (folder_id) do update set quota_bytes = excluded.quota_bytes;
-- 한도 없애기: delete from groupware.cloud_quotas where folder_id = '...';

-- 공유 걸기 예시 (admin 의 '01 공릉천교 내진보강공사' 폴더를 앱 계정에):
-- insert into groupware.cloud_grants (folder_id, user_id, can_write)
-- select i.id, u.id, true from groupware.cloud_items i, auth.users u
-- where i.name = '01 공릉천교 내진보강공사' and i.parent_id is null and i.trashed_at is null
--   and i.owner = (select id from groupware.profiles where login_id = 'admin')
--   and u.email in ('worknium@gmail.com')
-- on conflict do nothing;
-- 공유 끊기: delete from groupware.cloud_grants where user_id = (select id from auth.users where email = '...');
