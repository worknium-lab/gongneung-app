# 공릉천교 현장 앱

공릉천교 교량받침 교체공사 현장용 앱입니다. 하나의 앱에서 달력, 공정률, 작업일보, TBM, 현장사진, 도면, 보고서, 제출서류, 기성, 준공, 클라우드를 다룹니다.

- 폰(안드로이드 APK)과 PC(웹)에서 같은 기록을 씁니다. 서버는 Supabase입니다.
- 오프라인에서도 쓸 수 있습니다. 입력한 기록은 먼저 기기에 저장되고, 인터넷이 연결되면 자동으로 서버와 맞춰집니다. 상단의 동기화 버튼에서 상태를 볼 수 있습니다.
- 「공정률 확인」 화면(현황·실적 입력)은 확정본을 그대로 씁니다. 계산 방식은 바꾸지 않았습니다.

## 구성

| 경로 | 내용 |
|---|---|
| `www/index.html` | 앱 틀: 로그인, 상단 날짜, 하단 11탭(폰은 옆으로 밀어 넘김), 달력, 보고서 출력, 현장사진 ZIP 받기 |
| `www/prog.html` | 공정률(현황·실적 입력) + 현장사진 + 공정현황 보고서 모듈 |
| `www/ilbo.html` | 작업일보 + TBM 모듈 |
| `www/dwg.html` | 도면 모듈: PDF 도면을 쪽별 고해상도 그림으로 바꿔 저장, 확대·이동, S펜 메모(펜·형광펜·지우개·되돌리기) |
| `www/subm.html` | 제출서류 모듈: No·서류명·상태(작성예정/작성중/제출완료)·날짜 목록, 첨부 파일 보기(PDF·엑셀·한글 hwpx·사진), 다른 앱으로 열기·내려받기 |
| `www/subm.html?c=gisung` | 기성: 제출서류 모듈을 같이 씀. 회차 단추(회차 추가 = 기본 서류 6건), 회차별 진행 요약 · 기성일 |
| `www/subm.html?c=jungong` | 준공: 제출서류 모듈을 같이 씀. 서류 점검표(기본 12건 넣기), 진행 요약 · 준공 예정일 |
| `www/cloud.html` | 클라우드: 니움클라우드(그룹웨어)의 현장 폴더 보기 · 파일 열기 · 내려받기 · 올리기 · 새 폴더. 인터넷 필요 |
| `www/js/fileview.js`, `www/css/fileview.css` | 파일 미리보기 공용(PDF · 엑셀 · hwpx · 사진) — 제출서류 · 기성 · 준공 · 클라우드가 같이 씀 |
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
- 도면: PDF를 올리면 앱이 쪽마다 긴 변 4200px JPEG(약 0.3~1.4MB)와 목록용 작은 그림을 만들어 사진과 같은 `photos` 버킷에 올립니다. 문서는 `dwgset/<묶음>`, `dwg/<묶음>_<쪽>`(도면번호·도면명·관련 위치·그림 id), 메모는 `dwgnote/<도면>`(획 목록, 그림 좌표). 서버 설정 변경은 필요 없습니다.
- 제출서류: 문서 `subm/<id>` {no, name, status: plan|work|done, date, memo, files:[{id,name,type,size}], photos:[현장사진 id]}. 첨부 파일은 `files` 버킷(아무 형식, 한 파일 50MB)에 `f…` 이름으로 저장 — 처음 한 번 `supabase/files.sql`을 실행해야 합니다. 미리보기: PDF는 pdf.js(+한글 CMap), 엑셀은 SheetJS(값만, 앞 400행×40열), hwpx는 본문 XML의 글·표·그림만. 서식 그대로는 「다른 앱으로 열기」(@capacitor-community/file-opener).
  - S펜은 언제나 메모, 손가락은 이동·두 손가락 확대(「손가락으로도 쓰기」를 켜면 한 손가락 메모), PC는 마우스로 메모·휠로 확대. S펜 옆 버튼을 누른 채 쓰면 지우개.
  - 메모는 도면 한 장이 한 문서라서, 두 사람이 같은 도면에 동시에 메모하면 나중에 저장한 쪽이 남습니다.
  - 2026.3 공릉천교 도면집(35쪽, A3)을 올리면 도면번호·도면명·관련 위치를 자동으로 채웁니다 (`www/dwg.html`의 `GN_PRESET`).
- 기성: 문서 `gisung/<id>` (제출서류와 같은 모양 + `round` 회차), 회차 정보 `gisungr/r<회차>` {n, date 기성일}. 기본 서류는 `g<회차>_<번호>` 이름표로 넣어 두 기기가 같이 눌러도 겹치지 않습니다.
- 준공: 문서 `jungong/<id>` (제출서류와 같은 모양), 준공 예정일 `config/jungong` {date}. 기본 서류 이름표 `j_<번호>`.
- 클라우드: 앱 기록(docs)과 별개로 그룹웨어의 `groupware.cloud_items` 표와 저장소 `cloud` 버킷을 바로 읽고 씁니다 (기기에 저장하지 않음 → 인터넷 필요). 니움클라우드는 계정별 개인 보관함이라, 현장 폴더를 앱 계정에 열어 주려면 홈 서버 DB에서 `supabase/cloud.sql`을 한 번 실행하고 맨 아래 예시처럼 `groupware.cloud_grants`에 공유를 걸어야 합니다. 공유받은 계정은 보기 · 올리기 · 새 폴더만 되고 지우기 · 이름 바꾸기는 안 됩니다. 폴더 용량 한도는 `groupware.cloud_quotas`에 겁니다(공릉천교 현장 폴더 50GB) — 서버가 한도를 넘는 올리기를 막고, 앱은 사용량을 보여 주며 올리기 전에 먼저 확인합니다. 6MB 넘는 파일은 6MB 조각(TUS, `vendor/tus.min.js`)으로 올립니다. 150MB 넘는 파일은 앱에서 열지 않습니다. 도면(dwg)과 한글 · 워드 · PPT는 그룹웨어 홈 서버의 미리보기 변환기(`config.js`의 `previewUrl`, `/preview/convert?id=`)에 맡깁니다 — dwg → DXF 는 `vendor/dxfviewer.js`(그룹웨어와 같은 dxf-viewer, 패치 포함해 rolldown 으로 묶은 것. 화면과 작업자 겸용)와 `fonts/NanumGothic.ttf`로 그리고, 나머지는 PDF로 받아 봅니다. 뷰어를 다시 묶으려면 worknium_groupware 에서 `import { DxfViewer } from 'dxf-viewer'; if (typeof document === 'undefined') DxfViewer.SetupWorker(); else self.DxfViewer = DxfViewer` 를 `rolldown --format iife --minify` 로 묶습니다.
- 시험: `python3 tools/mock_supabase.py 8787`을 실행하면 가짜 서버로 동기화를 확인할 수 있습니다. 뒤에 폴더를 적으면(`… 8787 <폴더>`) 그 폴더를 공유받은 클라우드 폴더로 보여 줍니다.
