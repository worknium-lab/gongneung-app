# 공릉천교 현장 앱

공릉천교 교량받침 교체공사 현장용 앱입니다. 하나의 앱에서 달력, 공정률, 작업일보, TBM, 현장사진, 보고서를 다룹니다.

- 폰(안드로이드 APK)과 PC(웹)에서 같은 기록을 씁니다. 서버는 Supabase입니다.
- 오프라인에서도 쓸 수 있습니다. 입력한 기록은 먼저 기기에 저장되고, 인터넷이 연결되면 자동으로 서버와 맞춰집니다. 상단의 동기화 버튼에서 상태를 볼 수 있습니다.
- 「공정률 확인」 화면(현황·실적 입력)은 확정본을 그대로 씁니다. 계산 방식은 바꾸지 않았습니다.

## 구성

| 경로 | 내용 |
|---|---|
| `www/index.html` | 앱 틀: 로그인, 상단 날짜, 하단 6탭, 달력, 보고서 출력 |
| `www/prog.html` | 공정률(현황·실적 입력) + 현장사진 + 공정현황 보고서 모듈 |
| `www/ilbo.html` | 작업일보 + TBM 모듈 |
| `www/js/store.js` | 기기 저장(IndexedDB)과 Supabase 동기화, 로그인, 사진 파일, Word·PDF 저장 |
| `www/js/config.js` | Supabase 주소와 공개용 키 |
| `src/orig/` | 원본 화면. `python3 tools/build_modules.py`를 실행하면 `www/prog.html`과 `www/ilbo.html`을 다시 만듭니다 |
| `supabase/setup.sql` | 서버 테이블, 권한, 사진 저장소 설정 |
| `.github/workflows/android.yml` | main 브랜치에 올릴 때마다 APK를 빌드해 Releases에 올립니다 |
| `.github/workflows/pages.yml` | PC용 웹을 GitHub Pages에 배포합니다 |

## 처음 설정 (한 번만)

1. **Supabase 설정**: SQL Editor에서 `supabase/setup.sql`을 실행합니다. 그다음 기존 기록 옮기기 SQL을 실행합니다. 이 SQL 파일은 저장소에 넣지 않고 따로 전달합니다.
2. **로그인 계정 만들기**: Authentication → Users → Add user에서 만듭니다. Authentication → Sign In / Providers에서 「Allow new users to sign up」을 끄는 것을 권장합니다.
3. **APK 서명 키 등록**: GitHub 저장소 Settings → Secrets and variables → Actions에서 다음 두 값을 등록합니다.
   - `ANDROID_KEYSTORE_B64`: 서명 키 파일을 base64로 바꾼 값
   - `ANDROID_KEYSTORE_PASS`: 서명 키 비밀번호
4. **PC용 웹 켜기**: 저장소 Settings → Pages → Source를 「GitHub Actions」로 바꿉니다. 무료 계정은 공개(Public) 저장소에서만 Pages를 쓸 수 있습니다.

## 폰에 설치

저장소 **Releases**에서 가장 최신 `gongneung-1.0.N.apk`를 폰으로 내려받아 설치합니다. 처음 설치할 때는 「출처를 알 수 없는 앱 설치」를 허용해야 합니다. 같은 서명 키로 만든 APK는 기존 앱 위에 그대로 덮어 설치되고, 기록도 유지됩니다.

## 개발 메모

- 기기 저장: IndexedDB `gongneung` (docs / outbox / blobs / blobq / meta)
- 서버: `public.docs(col, id, data, deleted, rev)` 한 테이블. `rev`는 서버가 매기는 변경 순번이고, 앱은 마지막으로 받은 `rev` 이후 것만 받아옵니다.
- 충돌 처리: 문서 단위로 마지막에 저장한 쪽이 이깁니다. 아직 서버에 올리지 못한 내 수정은 서버 값으로 덮어쓰지 않습니다.
- 사진: 비공개 버킷 `photos/<id>.jpg`. 기기에도 사본을 보관해 오프라인에서도 볼 수 있습니다.
- 시험: `python3 tools/mock_supabase.py 8787`을 실행하면 가짜 서버로 동기화를 확인할 수 있습니다.
