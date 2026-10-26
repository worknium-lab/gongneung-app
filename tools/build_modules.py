"""기존 아티팩트 화면(src/orig/*.html)을 앱 안에 들어갈 모듈(www/prog.html, www/ilbo.html)로 바꿉니다.

바꾸는 것: 글꼴·라이브러리를 기기 안 파일로(오프라인), 앱 저장소 연결, 통합 앱용 연결 고리(hook) 추가.
공정률 확인 화면의 표시·계산 코드는 건드리지 않습니다.
실행: python3 tools/build_modules.py
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'src' / 'orig', ROOT / 'www'


def rep(s, a, b, n=1):
    c = s.count(a)
    if c != n:
        sys.exit(f'바꿀 곳을 찾지 못함 ({c}곳): {a[:90]!r}')
    return s.replace(a, b)


FONTS_OLD_PROG = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
                  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">')
FONTS_OLD_ILBO = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
                  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap">')
FONTS_NEW = '<link rel="stylesheet" href="css/fonts.css">'

# 통합 앱(index.html) 안에서 열릴 때: 앱 저장소를 그대로 쓰고, 자체 머리글·탭은 숨김
BRIDGE = '''<script>
window.EMBED = window.parent !== window;
if (window.EMBED && window.parent.claude) window.claude = window.parent.claude;
document.documentElement.classList.toggle('embed', window.EMBED);
</script>'''

# ---------------------------------------------------------------- 공정률 (+ 현장 사진 + 공정현황 보고서)
s = (SRC / 'prog.html').read_text(encoding='utf-8')
s = rep(s, FONTS_OLD_PROG, FONTS_NEW + '\n' + BRIDGE)
s = rep(s, '</style>\n\n<header>', '''/* ---------- 통합 앱 안에서 ---------- */
.embed header,.embed .bnav{display:none!important}
.embed .savebar{bottom:0!important;padding-bottom:0!important}
.embed .toast{bottom:calc(96px + env(safe-area-inset-bottom,0px))!important}
.embed .locpanel{top:0!important}
.embed main{padding-top:14px}
</style>

<header>''')
s = rep(s, "'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'", "'vendor/html2canvas.min.js'")
s = rep(s, "'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'", "'vendor/jspdf.umd.min.js'")
# 사진 파일: 기기 보관함/서버에서 주소를 받아 표시
s = rep(s, "  if (p.img) return '/_blob/' + p.img;", "  if (p.img) return (await assets.url(p.img)) || p.thd || '';")
s = rep(s, "const thSrc = p => p.th ? '/_blob/' + p.th : (p.thd || '');",
        """const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', THU = {}, THW = {};
let thT = 0;
function thLoad(id) { if (THW[id] || !assets) return; THW[id] = 1; assets.url(id).then(u => { if (u) { THU[id] = u; clearTimeout(thT); thT = setTimeout(R, 60); } }).catch(() => {}); }
const thSrc = p => p.th ? (THU[p.th] || (thLoad(p.th), BLANK)) : (p.thd || '');""")
# 통합 앱 연결 고리: 사진 날짜 지정
s = rep(s, "/* ---------- 연결 ---------- */\n(async () => {\n  if (!window.claude || !claude.use) { R(); return; }",
        "window.PH = { setDay(d) { selDay = d || null; R(); }, list: () => LIST };\n/* ---------- 연결 ---------- */\n(async () => {\n  if (!window.claude || !claude.use) { R(); return; }")
# 통합 앱 연결 고리: 그날 마감 공정률, 보고서 A4 한 장 그림
s = rep(s, """(async () => {
  if (!window.claude || !claude.use) return;
  rdb = await claude.use('db');""", """window.RP = {
  ready: () => loaded,
  rateAt(day) { try { return calc(stateAt(endOf(day))).net; } catch (e) { return null; } },
  setDate(d) { if (d) { rDate = d; render(); } },
  async canvas(day) {
    const keep = rDate; rDate = day;
    const st = document.createElement('div');
    st.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px';
    st.innerHTML = '<div class="a4">' + paperHTML() + '</div>';
    document.body.append(st); rDate = keep;
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; return await html2canvas(st.firstChild, {scale: 2, backgroundColor: '#ffffff', logging: false}); }
    finally { st.remove(); }
  },
};
(async () => {
  if (!window.claude || !claude.use) return;
  rdb = await claude.use('db');""")
s = rep(s, '<script>\nconst D = {', '<script src="vendor/html2canvas.min.js"></script>\n<script>\nconst D = {')
(OUT / 'prog.html').write_text(s, encoding='utf-8')

# ---------------------------------------------------------------- 작업일보 · TBM
s = (SRC / 'ilbo.html').read_text(encoding='utf-8')
s = rep(s, FONTS_OLD_ILBO, FONTS_NEW + '\n' + BRIDGE)
s = rep(s, '<script src="https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js"></script>', '<script src="vendor/docx.iife.js"></script>')
s = rep(s, '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>', '<script src="vendor/html2canvas.min.js"></script>')
s = rep(s, '<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>', '<script src="vendor/jspdf.umd.min.js"></script>')
s = rep(s, '\n</style>\n</head>', '''
/* ---------- 통합 앱 안에서 ---------- */
.embed header.top, .embed .tabbar { display: none !important; }
.embed .wrap { padding-block: 12px 24px !important; }
:root.embed { --bg: #f3f5f6; --line: #d3d9dd; --navy: #1d5d86; --ink: #162027; --muted: #5b6871; }
.embed .msgbar:empty { display: none; }
</style>
</head>''') if '\n</style>\n</head>' in s else s
if '/* ---------- 통합 앱 안에서 ---------- */' not in s:
    s = rep(s, '</style>\n\n<div class="wrap" id="app">', '''/* ---------- 통합 앱 안에서 ---------- */
.embed header.top, .embed .tabbar { display: none !important; }
.embed .wrap { padding-block: 12px 24px !important; }
:root.embed { --bg: #f3f5f6; --line: #d3d9dd; --navy: #1d5d86; --ink: #162027; --muted: #5b6871; }
.embed .msgbar:empty { display: none; }
</style>

<div class="wrap" id="app">''')
# 입력하면 기기에 바로 저장 (오프라인에서도 기록이 남고, 연결되면 서버로)
s = rep(s, "  schedulePreview(); saveDraft();\n});\n$$('form')", "  schedulePreview(); saveDraft(); autoSave();\n});\n$$('form')")
s = rep(s, "$('addEq').onclick =", "let asT = 0; function autoSave() { window.__touched = true; clearTimeout(asT); asT = setTimeout(() => { asT = 0; saveRecord(true); }, 1200); }\n$('addEq').onclick =")
# 새 날짜를 열면 공정률 실시값은 공정률 탭(그날 마감 기준)에서 가져옴
s = rep(s, "  S.tbm.hazards = buildHazards(detectKeys(S));\n}\nasync function openDate(date) {",
        "  S.tbm.hazards = buildHazards(detectKeys(S));\n  try { const r = window.parent.RATE_AT && window.parent.RATE_AT(date); if (r != null) S.pAct = (r * 100).toFixed(2); } catch (e) {}\n  window.__openedNew = date; window.__touched = false;\n}\nasync function openDate(date) {")
# 다른 기기에서 저장한 일보도 바로 반영 (한 번 읽기 → 실시간 구독)
s = rep(s, """  try {
    const cfg = await db.doc('config/site').get();
    if (cfg.exists) site = { ...DEF_SITE, ...cfg.data() };
    const all = await db.collection('reports').orderBy('date', 'desc').limit(1000).get();
    reports = {};
    all.docs.forEach(d => { const r = d.data(); if (r && r.date) reports[r.date] = r; });
    savedDates = Object.keys(reports).sort().reverse();
  } catch (e) { say(`기록 목록을 읽지 못했습니다 (${e.code || e.message}).`, true); }
  await openDate(todayISO());""", """  try {
    const cfg = await db.doc('config/site').get();
    if (cfg.exists) site = { ...DEF_SITE, ...cfg.data() };
  } catch (e) { say(`현장 정보를 읽지 못했습니다 (${e.code || e.message}).`, true); }
  let first = true;
  db.collection('reports').onSnapshot(async (all) => {
    reports = {};
    all.docs.forEach(d => { const r = d.data(); if (r && r.date) reports[r.date] = r; });
    savedDates = Object.keys(reports).sort().reverse();
    if (first) { first = false; await openDate(window.START_DATE || todayISO()); }
    // 처음 설치한 기기: 서버 기록이 늦게 도착하면, 손대지 않은 새 일보 대신 저장된 일보를 다시 연다 (빈 일보로 덮어쓰기 방지)
    else if (window.__openedNew === S.date && reports[S.date] && !window.__touched) { window.__openedNew = null; await openDate(S.date); }
    renderCal(); renderEditing(); if (view === 'report') renderReport();
    window.dispatchEvent(new Event('ilbo-reports'));
  });""")
# 통합 앱 연결 고리
s = rep(s, "// ---------------- boot ----------------", """// ---------------- 통합 앱 연결 고리 ----------------
window.ILBO = {
  setView: (v) => setView(v, false),
  async openDate(d) { if (asT) { clearTimeout(asT); asT = 0; await saveRecord(true); } if (d && d !== S.date) await openDate(d); },
  date: () => S.date,
  reports: () => reports,
  saveNow: () => saveRecord(true),
  async pageCanvas(date, kind) {
    const st = date === S.date ? S : (reports[date] ? recToState(reports[date]) : null);
    if (!st) return null;
    const stage = $('pdfStage');
    stage.innerHTML = `<div class="paper">${withState(st, () => pageHTML(kind))}</div>`;
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; return await window.html2canvas(stage.firstChild, { scale: 2, backgroundColor: '#ffffff', logging: false }); }
    finally { stage.innerHTML = ''; }
  },
  async word(kind) { await offer(kind); },
};

// ---------------- boot ----------------""")
(OUT / 'ilbo.html').write_text(s, encoding='utf-8')
print('ok: www/prog.html, www/ilbo.html')
