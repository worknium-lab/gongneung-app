-- 공릉천교 앱 · 사용 허용 목록 (public.gn_members) 관리
-- 표와 권한 규칙은 setup.sql 에 있습니다. 이 파일은 계정을 넣고 빼는 절차입니다. 홈 서버 DB에서 실행합니다.
--
-- 새 사용자를 앱에 들이려면 세 가지가 모두 필요합니다.
--   ① 로그인 계정 만들기 (Supabase 스튜디오 → Authentication → Users → Add user)
--   ② 이 목록(gn_members)에 이메일 넣기      ← 빠지면 로그인은 되는데 기록이 하나도 안 보이고 저장이 거절됨
--   ③ (클라우드 탭도 쓰게 하려면) cloud.sql 맨 아래 예시대로 groupware.cloud_grants 에 폴더 공유
--
-- 이메일은 로그인 때 쓰는 것 그대로, 소문자로 넣습니다.

-- 넣기 (여러 번 실행해도 안전):
-- insert into public.gn_members (email, name) values
--   ('아이디@example.com', '표시할 이름')
-- on conflict (email) do update set name = excluded.name;

-- 빼기:
-- delete from public.gn_members where email = '아이디@example.com';

-- 점검: 로그인 계정 중 누가 목록에 있고 없는지, 클라우드 공유는 받았는지
select u.email,
       m.email is not null as 앱_허용,
       exists (select 1 from groupware.cloud_grants g where g.user_id = u.id) as 클라우드_공유,
       u.last_sign_in_at as 마지막_로그인
from auth.users u left join public.gn_members m on m.email = lower(u.email)
order by u.created_at;
