/* 파일 미리보기 공용: PDF · 엑셀 · 한글(hwpx) · 사진 — 제출서류 · 기성 · 준공 · 클라우드 화면이 같이 씀
 * 화면에 <div id="pv"> 가 있어야 함. css/fileview.css 와 한 쌍 */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('불러오기 실패: ' + src)); document.head.append(s); }); }
/* ---------- 파일 종류 ---------- */
const ext = n => (String(n).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
function kind(f) {
  if (f.photo) return 'img';
  const e = ext(f.name);
  if (e === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'ods'].includes(e)) return 'xls';
  if (e === 'hwpx' || e === 'hwp') return 'hwp';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(e)) return 'img';
  return 'etc';
}
function label(f) { const e = ext(f.name).toUpperCase(); const k = kind(f); return k === 'img' ? '사진' : (e || '파일'); }
const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', csv: 'text/csv',
  hwpx: 'application/haansofthwpx', hwp: 'application/x-hwp', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip', dwg: 'application/acad', txt: 'text/plain' };
const mimeOf = n => MIME[ext(n)] || 'application/octet-stream';
const chip = f => `<span class="ft ${kind(f)}">${esc(label(f))}</span>`;
function pvMsg(html, light, retry) {
  stopPdf();
  $('pv').className = light ? 'light' : '';
  $('pv').innerHTML = `<div class="pvmsg"><div>${html}</div>${retry ? '<button class="btn" id="pvRetry">다시 받기</button>' : ''}</div>`;
  if (retry) $('pvRetry').onclick = retry;
}
let SEQ = 0;
/* PDF: 쪽마다 화면 폭에 맞춰 그림. 두 손가락·버튼으로 확대 */
let PDF = null, PDFOBS = null, ZOOM = 1, ZT = 0;
function stopPdf() { if (PDFOBS) PDFOBS.disconnect(); PDFOBS = null; if (PDF) { try { PDF.destroy(); } catch (e) {} } PDF = null; ZOOM = 1; }
async function pdfLib() {
  if (!window.pdfjsLib) { await loadScript('vendor/pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; }
  return window.pdfjsLib;
}
async function showPdf(blob, my) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: new URL('vendor/cmaps/', location.href).href, cMapPacked: true, standardFontDataUrl: new URL('vendor/standard_fonts/', location.href).href }).promise;
  if (my !== SEQ) { doc.destroy(); return; }
  stopPdf(); PDF = doc;
  const pv = $('pv'); pv.className = '';
  const sizes = [];
  for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); const v = p.getViewport({ scale: 1 }); sizes.push([v.width, v.height]); if (my !== SEQ) return; }
  pv.innerHTML = `<div class="pages" id="pages">${sizes.map((s, i) => `<div class="pg" data-i="${i + 1}" data-r="${s[1] / s[0]}"></div>`).join('')}</div>
    <div class="pgno" id="pgno">1 / ${doc.numPages} 쪽</div>
    <div class="zoombar"><button aria-label="축소" data-z="-1">−</button><button aria-label="확대" data-z="1">+</button></div>`;
  layoutPages();
  PDFOBS = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) renderPage(e.target); }), { root: pv, rootMargin: '600px 0px' });
  pv.onscroll = () => { if (!PDF) return; const mid = pv.getBoundingClientRect().top + pv.clientHeight / 2; let cur = 1; pv.querySelectorAll('.pg').forEach(p => { if (p.getBoundingClientRect().top <= mid) cur = +p.dataset.i; }); const e = $('pgno'); if (e) e.textContent = `${cur} / ${doc.numPages} 쪽`; };
  pv.querySelectorAll('.pg').forEach(p => PDFOBS.observe(p));
  bindZoom(true);
}
function baseW() { return Math.min($('pv').clientWidth - 24, 1100); }
function layoutPages() {
  const w = baseW() * ZOOM;
  $('pv').querySelectorAll('.pg').forEach(p => { p.style.width = w + 'px'; p.style.height = (w * +p.dataset.r) + 'px'; });
}
async function renderPage(el) {
  if (!PDF) return;
  const want = Math.round(el.clientWidth * Math.min(window.devicePixelRatio || 1, 2.5));
  if (+el.dataset.done >= want || el.dataset.busy) return;
  el.dataset.busy = '1';
  const doc = PDF;
  try {
    const page = await doc.getPage(+el.dataset.i);
    const v1 = page.getViewport({ scale: 1 });
    let sc = want / v1.width; if (v1.width * sc * v1.height * sc > 16e6) sc = Math.sqrt(16e6 / (v1.width * v1.height));
    const vp = page.getViewport({ scale: sc });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    if (doc !== PDF) return;
    el.replaceChildren(cv); el.dataset.done = String(want);
  } catch (e) { console.warn(e); }
  delete el.dataset.busy;
}
function setZoom(z, cx, cy) {
  const pv = $('pv'), old = ZOOM;
  ZOOM = Math.max(1, Math.min(6, z));
  if (ZOOM === old) return;
  const r = pv.getBoundingClientRect();
  const ox = cx == null ? pv.clientWidth / 2 : cx - r.left, oy = cy == null ? pv.clientHeight / 2 : cy - r.top;
  const ax = (pv.scrollLeft + ox) / old, ay = (pv.scrollTop + oy) / old;
  if (PDF) layoutPages(); else { const im = pv.querySelector('.pg'); if (im) { im.style.width = baseW() * ZOOM + 'px'; im.style.height = baseW() * ZOOM * +im.dataset.r + 'px'; } }
  pv.scrollLeft = ax * ZOOM - ox; pv.scrollTop = ay * ZOOM - oy;
  clearTimeout(ZT); ZT = setTimeout(() => { if (PDF) pv.querySelectorAll('.pg').forEach(p => { const b = p.getBoundingClientRect(); if (b.bottom > r.top - 600 && b.top < r.bottom + 600) renderPage(p); }); }, 250);
}
let pinch = null;
function bindZoom() {
  const pv = $('pv');
  pv.querySelector('.zoombar').onclick = e => { const b = e.target.closest('button'); if (b) setZoom(ZOOM * (b.dataset.z > 0 ? 1.4 : 1 / 1.4)); };
}
$('pv').addEventListener('touchstart', e => {
  if (e.touches.length === 2 && $('pv').querySelector('.pg')) {
    const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: ZOOM };
  }
}, { passive: true });
$('pv').addEventListener('touchmove', e => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  setZoom(pinch.z * d / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
}, { passive: false });
$('pv').addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
$('pv').addEventListener('wheel', e => { if ((e.ctrlKey || e.metaKey) && $('pv').querySelector('.pg')) { e.preventDefault(); setZoom(ZOOM * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); } }, { passive: false });
addEventListener('resize', () => { if ($('pv').querySelector('.pg')) { if (PDF) layoutPages(); else setZoom(ZOOM + 1e-9); } });

function showImg(url) {
  stopPdf();
  const pv = $('pv'); pv.className = '';
  pv.innerHTML = `<div class="pages"><div class="pg" data-r="0.75"><img alt="" src="${url}"></div></div><div class="zoombar"><button aria-label="축소" data-z="-1">−</button><button aria-label="확대" data-z="1">+</button></div>`;
  const im = pv.querySelector('img'), pg = pv.querySelector('.pg');
  const fit = () => { pg.dataset.r = String(im.naturalHeight / im.naturalWidth || 0.75); ZOOM = 1; const w = Math.min(baseW(), (pv.clientHeight - 28) / +pg.dataset.r); pg.style.width = w + 'px'; pg.style.height = w * +pg.dataset.r + 'px'; };
  im.onload = fit; fit();
  bindZoom();
}

/* 엑셀: 시트별 표 (값만) */
async function showXls(blob, my) {
  if (!window.XLSX) await loadScript('vendor/xlsx.full.min.js');
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellStyles: false, cellDates: true, dense: false });
  if (my !== SEQ) return;
  stopPdf();
  const pv = $('pv'); pv.className = 'light';
  const draw = name => {
    const ws = wb.Sheets[name];
    let html = '<div class="xl">';
    if (!ws || !ws['!ref']) html += '<p class="more">빈 시트입니다.</p>';
    else {
      const R = XLSX.utils.decode_range(ws['!ref']), MR = 400, MC = 40;
      const r1 = Math.min(R.e.r, R.s.r + MR - 1), c1 = Math.min(R.e.c, R.s.c + MC - 1);
      const skip = new Set(), span = {};
      (ws['!merges'] || []).forEach(m => { span[m.s.r + ',' + m.s.c] = m; for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) skip.add(r + ',' + c); });
      html += '<table><tr><th class="rh"></th>';
      for (let c = R.s.c; c <= c1; c++) html += `<th class="rh">${XLSX.utils.encode_col(c)}</th>`;
      html += '</tr>';
      for (let r = R.s.r; r <= r1; r++) {
        html += `<tr><td class="rh">${r + 1}</td>`;
        for (let c = R.s.c; c <= c1; c++) {
          const k = r + ',' + c; if (skip.has(k)) continue;
          const cell = ws[XLSX.utils.encode_cell({ r, c })], m = span[k];
          const v = cell ? (cell.w != null ? cell.w : cell.v instanceof Date ? cell.v.toLocaleDateString('ko-KR') : cell.v) : '';
          const num = cell && cell.t === 'n';
          html += `<td${m ? ` colspan="${Math.min(m.e.c, c1) - c + 1}" rowspan="${Math.min(m.e.r, r1) - r + 1}"` : ''}${num ? ' style="text-align:right;font-family:var(--f-num)"' : ''}>${esc(v)}</td>`;
        }
        html += '</tr>';
      }
      html += '</table>';
      if (R.e.r > r1 || R.e.c > c1) html += `<p class="more">앞부분(${r1 - R.s.r + 1}행 × ${c1 - R.s.c + 1}열)만 보입니다. 전체는 「다른 앱으로 열기」로 보세요.</p>`;
    }
    html += '<p class="more">칸 값만 보입니다. 서식·그래프는 「다른 앱으로 열기」로 보세요.</p></div>';
    pv.innerHTML = (wb.SheetNames.length > 1 ? `<div class="sheetTabs">${wb.SheetNames.map(n => `<button data-s="${esc(n)}" aria-pressed="${n === name}">${esc(n)}</button>`).join('')}</div>` : '') + html;
    const t = pv.querySelector('.sheetTabs'); if (t) t.onclick = e => { const b = e.target.closest('button'); if (b) draw(b.dataset.s); };
  };
  draw(wb.SheetNames[0]);
}

/* 한글(hwpx): 글과 표, 그림만 간단히 */
async function showHwpx(blob, my) {
  const zip = await JSZip.loadAsync(blob);
  const secs = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (!secs.length) throw new Error('hwpx 본문을 찾지 못했습니다');
  const bins = Object.keys(zip.files).filter(n => /^BinData\//i.test(n));
  const imgs = {};
  const imgUrl = async ref => {
    if (imgs[ref] !== undefined) return imgs[ref];
    const n = bins.find(b => b.replace(/^BinData\//i, '').replace(/\.[^.]+$/, '') === ref);
    if (!n || !/\.(png|jpe?g|gif|bmp)$/i.test(n)) return (imgs[ref] = '');
    return (imgs[ref] = URL.createObjectURL(new Blob([await zip.file(n).async('uint8array')], { type: /png$/i.test(n) ? 'image/png' : 'image/jpeg' })));
  };
  const out = [];
  for (let si = 0; si < secs.length; si++) {
    if (si) out.push('<hr>');
    const xml = new DOMParser().parseFromString(await zip.file(secs[si]).async('string'), 'application/xml');
    const root = xml.documentElement;
    for (const p of [...root.children].filter(c => c.localName === 'p')) await para(p, out);
  }
  async function para(p, out) {
    let txt = '', any = false;
    const flush = () => { out.push(`<p>${esc(txt)}</p>`); txt = ''; any = true; };
    async function rec(n) {
      for (const c of n.children) {
        const ln = c.localName;
        if (ln === 't') txt += c.textContent;
        else if (ln === 'tbl') { if (txt) flush(); out.push(await table(c)); any = true; }
        else if (ln === 'pic') { const im = c.getElementsByTagNameNS('*', 'img')[0]; const u = im ? await imgUrl(im.getAttribute('binaryItemIDRef')) : ''; if (u) { if (txt) flush(); out.push(`<img alt="" src="${u}">`); any = true; } }
        else if (ln === 'lineBreak') txt += '\n';
        else if (ln === 'tab') txt += '\t';
        else if (ln === 'secPr' || ln === 'ctrl' || ln === 'linesegarray') continue;
        else await rec(c);
      }
    }
    await rec(p);
    if (txt || !any) flush();
  }
  async function table(tbl) {
    let h = '<table>';
    for (const tr of [...tbl.children].filter(c => c.localName === 'tr')) {
      h += '<tr>';
      for (const tc of [...tr.children].filter(c => c.localName === 'tc')) {
        const sp = [...tc.children].find(c => c.localName === 'cellSpan');
        const cs = sp ? +sp.getAttribute('colSpan') || 1 : 1, rs = sp ? +sp.getAttribute('rowSpan') || 1 : 1;
        const inner = [];
        const sub = [...tc.children].find(c => c.localName === 'subList') || tc;
        for (const p of [...sub.children].filter(c => c.localName === 'p')) await para(p, inner);
        h += `<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${inner.join('')}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table>';
  }
  if (my !== SEQ) return;
  stopPdf();
  const pv = $('pv'); pv.className = 'light';
  pv.innerHTML = `<div class="hw">${out.join('')}</div><p class="note" style="text-align:center;padding:0 16px 16px">글과 표만 간단히 보입니다. 한글 서식 그대로는 「다른 앱으로 열기」(한컴오피스)로 보세요.</p>`;
}
const native = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const b64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
const safeName = n => String(n || '파일').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);

/* 다른 앱으로 열기 (폰: 열 앱 고르기, PC: 새 창) */
async function openExternal(name, blob, mime) {
  mime = mime && mime !== 'application/octet-stream' ? mime : mimeOf(name);
  if (native()) {
    const P = window.Capacitor.Plugins;
    try {
      const w = await P.Filesystem.writeFile({ path: 'open/' + safeName(name), data: await b64(blob), directory: 'CACHE', recursive: true });
      if (P.FileOpener) {
        try { await P.FileOpener.open({ filePath: w.uri, contentType: mime, openWithDefault: false }); return; } catch (e) { console.warn(e); }
        try { await P.FileOpener.open({ filePath: w.uri, contentType: '*/*', openWithDefault: false }); return; } catch (e) { console.warn(e); }
      }
      await P.Share.share({ title: name, files: [w.uri], dialogTitle: '열 앱 고르기' });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
    return;
  }
  const u = URL.createObjectURL(new Blob([blob], { type: mime }));
  const w = window.open(u, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
/* 종류에 맞춰 미리보기. my = 부르기 전에 ++SEQ 한 값 (그 사이 다른 파일을 열면 그만둠) */
async function previewBlob(f, blob, my) {
  const k = kind(f);
  try {
    if (k === 'pdf') await showPdf(blob, my);
    else if (k === 'xls') await showXls(blob, my);
    else if (k === 'hwp' && ext(f.name) === 'hwpx') await showHwpx(blob, my);
    else if (k === 'img') showImg(URL.createObjectURL(blob));
    else pvMsg(`${esc(label(f))} 파일은 앱 안에서 미리 볼 수 없습니다.<br>아래 「다른 앱으로 열기」를 누르세요.`);
  } catch (e) {
    console.warn(e);
    if (my === SEQ) pvMsg('미리보기를 만들지 못했습니다 (' + esc(e && e.message || e) + ').<br>「다른 앱으로 열기」로 열어 보세요.');
  }
}
