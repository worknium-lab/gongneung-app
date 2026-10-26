/* 공릉천교 앱 저장소
 * - 모든 기록은 먼저 이 기기(IndexedDB)에 저장 → 인터넷이 되면 Supabase로 올리고 내려받음 (오프라인 우선)
 * - 기존 공정률·일보 모듈이 쓰던 window.claude.use('db'|'user'|'assets'|'downloads') 형태를 그대로 제공
 * 서버 테이블: public.docs (col, id, data jsonb, deleted, rev)  /  사진: storage 버킷 'photos'
 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const READY = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
  const sb = READY ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gn-auth' },
    realtime: { params: { eventsPerSecond: 5 } },
  }) : null;
  const BUCKET = 'photos';

  /* ---------------- IndexedDB ---------------- */
  let idbP = null;
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise((res, rej) => {
      const r = indexedDB.open('gongneung', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('docs', { keyPath: 'k' });     // {k, col, id, data, del}
        d.createObjectStore('outbox', { keyPath: 'k' });   // {k, col, id, data, del, ts}
        d.createObjectStore('blobs', { keyPath: 'id' });   // {id, blob}
        d.createObjectStore('blobq', { keyPath: 'id' });   // {id, op:'up'|'del', ts}
        d.createObjectStore('meta', { keyPath: 'k' });     // {k, v}
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return idbP;
  }
  async function tx(stores, mode, fn) {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      Promise.resolve(fn(...[].concat(stores).map(s => t.objectStore(s)))).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('abort'));
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const getAll = async s => tx(s, 'readonly', st => req(st.getAll()));
  const metaGet = async k => { const r = await tx('meta', 'readonly', st => req(st.get(k))); return r ? r.v : undefined; };
  const metaSet = (k, v) => tx('meta', 'readwrite', st => { st.put({ k, v }); });

  /* ---------------- 메모리 사본 + 알림 ---------------- */
  const MEM = new Map();          // col -> Map(id -> data)
  const PENDING = new Set();      // 아직 서버에 못 올린 문서 key
  const LIS = new Set();          // {col, id?, fn}
  const colMap = c => { let m = MEM.get(c); if (!m) MEM.set(c, m = new Map()); return m; };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const key = (c, i) => c + '/' + i;
  const changed = new Set(); let notifyQ = false;
  function notify(col) {
    changed.add(col);
    if (notifyQ) return; notifyQ = true;
    setTimeout(() => {
      notifyQ = false; const cs = [...changed]; changed.clear();
      LIS.forEach(l => { if (cs.includes(l.col)) { try { l.fn(); } catch (e) { console.error(e); } } });
    }, 0);
  }
  const rid = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(20)); r.forEach(x => s += a[x % 36]); return s; };
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function deepMerge(base, patch) {
    const out = isObj(base) ? clone(base) : {};
    for (const k in patch) {
      const v = patch[k];
      if (isObj(v) && v.__delete__ === true) { delete out[k]; continue; }
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
    }
    return out;
  }

  let loaded = null;
  function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const [docs, ob] = await Promise.all([getAll('docs'), getAll('outbox')]);
      docs.forEach(r => { if (!r.del) colMap(r.col).set(r.id, r.data); });
      ob.forEach(r => PENDING.add(r.k));
      status();
    })();
    return loaded;
  }

  async function write(col, id, data) {           // data === null → 삭제
    await load();
    const k = key(col, id), del = data == null, ts = Date.now();
    if (del) colMap(col).delete(id); else colMap(col).set(id, clone(data));
    PENDING.add(k);
    await tx(['docs', 'outbox'], 'readwrite', (d, o) => {
      d.put({ k, col, id, data: del ? null : data, del });
      o.put({ k, col, id, data: del ? null : data, del, ts });
    });
    notify(col); status(); kick();
  }

  /* ---------------- 기존 모듈용 db API ---------------- */
  class Snap { constructor(id, d) { this.id = id; this._d = d; this.exists = d != null; } data() { return this._d == null ? undefined : clone(this._d); } }
  function split(path) { const p = String(path).split('/').filter(Boolean); if (p.length !== 2) throw Object.assign(new Error('bad path ' + path), { code: 'invalid_argument' }); return p; }
  function docRef(col, id) {
    return {
      id, path: key(col, id),
      async get() { await load(); return new Snap(id, colMap(col).get(id)); },
      async set(d) { await write(col, id, clone(d)); },
      async update(p) {
        await load(); const cur = colMap(col).get(id);
        if (cur == null) throw Object.assign(new Error('문서가 없습니다'), { code: 'invalid_argument' });
        await write(col, id, deepMerge(cur, p));
      },
      async delete() { await write(col, id, null); },
      onSnapshot(fn, err) {
        const l = { col, fn: () => fn(new Snap(id, colMap(col).get(id))) };
        LIS.add(l); load().then(l.fn, err || (() => {}));
        return () => LIS.delete(l);
      },
    };
  }
  function cmp(a, b) { if (a === b) return 0; if (a == null) return 1; if (b == null) return -1; return a < b ? -1 : 1; }
  function query(col, ord, dir, lim) {
    const run = () => {
      let rows = [...colMap(col).entries()].map(([id, d]) => new Snap(id, d));
      if (ord) rows.sort((x, y) => { const r = cmp(x._d && x._d[ord], y._d && y._d[ord]); return dir === 'desc' ? -r : r; });
      if (lim) rows = rows.slice(0, lim);
      return { docs: rows, size: rows.length, empty: !rows.length, forEach: f => rows.forEach(f) };
    };
    return {
      orderBy: (f, d) => query(col, f, d || 'asc', lim),
      limit: n => query(col, ord, dir, n),
      async get() { await load(); return run(); },
      onSnapshot(fn, err) { const l = { col, fn: () => fn(run()) }; LIS.add(l); load().then(l.fn, err || (() => {})); return () => LIS.delete(l); },
      doc: id => docRef(col, id || rid()),
      async add(d) { const id = rid(); await write(col, id, clone(d)); return docRef(col, id); },
    };
  }
  const db = {
    doc: p => { const [c, i] = split(p); return docRef(c, i); },
    collection: c => query(String(c).replace(/\/+$/, ''), null, 'asc', 0),
  };

  /* ---------------- 로그인 ---------------- */
  let session = null;
  const AUTHL = new Set();
  const myId = () => (session && session.user && session.user.id) || localStorage.getItem('gn-uid') || null;
  async function initAuth() {
    if (!sb) return;
    try { const { data } = await sb.auth.getSession(); session = data.session; } catch (e) {}
    if (session) localStorage.setItem('gn-uid', session.user.id);
    sb.auth.onAuthStateChange((ev, s) => {
      session = s || (ev === 'SIGNED_OUT' ? null : session);
      if (session) { localStorage.setItem('gn-uid', session.user.id); localStorage.setItem('gn-email', session.user.email || ''); kick(true); }
      AUTHL.forEach(f => f(session));
    });
  }
  const user = {
    async id() { return myId(); },
    async can() { return !!myId(); },
    async canEdit() { return !!myId(); },
    async profiles(ids) {
      await load(); const out = {}; const m = colMap('users');
      ids.forEach(i => { const u = m.get(i); out[i] = { name: (u && u.name) || '' }; });
      return out;
    },
  };

  /* ---------------- 사진 파일 (assets) ---------------- */
  const URLS = new Map();
  const assets = {
    async upload(blob, opt) {
      const id = 'p' + Date.now().toString(36) + rid().slice(0, 10);
      const b = blob instanceof Blob ? blob : new Blob([blob], { type: (opt && opt.type) || 'image/jpeg' });
      await tx(['blobs', 'blobq'], 'readwrite', (bs, q) => { bs.put({ id, blob: b }); q.put({ id, op: 'up', ts: Date.now() }); });
      status(); kick();
      return { id, url: '' };
    },
    async delete(id) {
      if (!id) return;
      if (URLS.has(id)) { URL.revokeObjectURL(URLS.get(id)); URLS.delete(id); }
      await tx(['blobs', 'blobq'], 'readwrite', (bs, q) => { bs.delete(id); q.put({ id, op: 'del', ts: Date.now() }); });
      status(); kick();
    },
    /* 화면에 띄울 주소: 기기에 있으면 바로, 없으면 서버에서 받아 기기에 보관 */
    async url(id) {
      if (!id) return '';
      if (URLS.has(id)) return URLS.get(id);
      let r = await tx('blobs', 'readonly', s => req(s.get(id)));
      if (!r && sb && session && navigator.onLine) {
        const { data, error } = await sb.storage.from(BUCKET).download(id + '.jpg');
        if (!error && data) { r = { id, blob: data }; await tx('blobs', 'readwrite', s => { s.put(r); }); }
      }
      if (!r) return '';
      const u = URL.createObjectURL(r.blob); URLS.set(id, u); return u;
    },
    async blob(id) { const u = await assets.url(id); if (!u) return null; return (await tx('blobs', 'readonly', s => req(s.get(id)))).blob; },
  };

  /* ---------------- 파일 저장 (Word·PDF) ---------------- */
  const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
  const native = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      if (native()) {
        const P = window.Capacitor.Plugins, FS = P.Filesystem, SH = P.Share;
        const b64 = await blobToB64(blob);
        try { await FS.writeFile({ path: '공릉천교/' + filename, data: b64, directory: 'DOCUMENTS', recursive: true }); } catch (e) {}
        const w = await FS.writeFile({ path: filename, data: b64, directory: 'CACHE' });
        try { await SH.share({ title: filename, files: [w.uri], dialogTitle: '저장하거나 보낼 곳 선택' }); }
        catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
        return;
      }
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    },
  };

  /* ---------------- 동기화 ---------------- */
  let syncing = false, again = false, lastOk = 0, lastErr = '', timer = 0, chan = null;
  const ST = new Set();
  async function counts() {
    const q = await tx('blobq', 'readonly', s => req(s.count()));
    return { docs: PENDING.size, files: q };
  }
  async function status() {
    const c = await counts().catch(() => ({ docs: PENDING.size, files: 0 }));
    const s = { ready: READY, online: navigator.onLine, signedIn: !!session, pending: c.docs + c.files, files: c.files, syncing, lastOk, lastErr, email: localStorage.getItem('gn-email') || '' };
    ST.forEach(f => f(s));
    return s;
  }
  function kick(now) { clearTimeout(timer); timer = setTimeout(sync, now ? 0 : 800); }

  async function pushDocs() {
    const ob = await getAll('outbox'); if (!ob.length) return;
    for (let i = 0; i < ob.length; i += 200) {
      const part = ob.slice(i, i + 200);
      const rows = part.map(r => ({ col: r.col, id: r.id, data: r.del ? null : r.data, deleted: !!r.del }));
      const { error } = await sb.from('docs').upsert(rows, { onConflict: 'col,id' });
      if (error) throw error;
      await tx('outbox', 'readwrite', o => Promise.all(part.map(async r => {
        const cur = await req(o.get(r.k));
        if (cur && cur.ts === r.ts) { o.delete(r.k); PENDING.delete(r.k); }
      })));
    }
  }
  async function pushFiles() {
    const q = await getAll('blobq');
    for (const j of q) {
      if (j.op === 'up') {
        const r = await tx('blobs', 'readonly', s => req(s.get(j.id)));
        if (r) { const { error } = await sb.storage.from(BUCKET).upload(j.id + '.jpg', r.blob, { contentType: 'image/jpeg', upsert: true }); if (error) throw error; }
      } else {
        const { error } = await sb.storage.from(BUCKET).remove([j.id + '.jpg']); if (error) throw error;
      }
      await tx('blobq', 'readwrite', s => { s.delete(j.id); });
    }
  }
  async function pull() {
    let rev = (await metaGet('rev')) || 0;
    for (;;) {
      const { data, error } = await sb.from('docs').select('col,id,data,deleted,rev').gt('rev', Math.max(0, rev - 30)).order('rev', { ascending: true }).limit(1000);
      if (error) throw error;
      const cols = new Set(); let max = rev;
      const ob = new Set((await getAll('outbox')).map(r => r.k));
      await tx('docs', 'readwrite', d => {
        data.forEach(r => {
          max = Math.max(max, r.rev);
          const k = key(r.col, r.id); if (ob.has(k)) return;          // 아직 안 올린 내 수정이 우선
          const del = r.deleted || r.data == null;
          const cur = colMap(r.col).get(r.id);
          if (del ? cur === undefined : JSON.stringify(cur) === JSON.stringify(r.data)) return;
          if (del) colMap(r.col).delete(r.id); else colMap(r.col).set(r.id, r.data);
          d.put({ k, col: r.col, id: r.id, data: del ? null : r.data, del }); cols.add(r.col);
        });
      });
      cols.forEach(notify);
      await metaSet('rev', max);
      if (data.length < 1000 || max === rev) break;
      rev = max;
    }
  }
  async function seedOnce() {
    if (await metaGet('seeded')) return;
    const { data, error } = await sb.from('docs').select('id').eq('col', 'meta').eq('id', 'seed').limit(1);
    if (error) throw error;
    if (data.length) { await metaSet('seeded', true); return; }
    let seed = null;
    try { const r = await fetch('seed.json', { cache: 'no-store' }); if (!r.ok) throw 0; seed = await r.json(); } catch (e) { await metaSet('seeded', true); return; }
    for (const col in seed) for (const id in seed[col]) if (!colMap(col).has(id)) await write(col, id, seed[col][id]);
    await write('meta', 'seed', { at: Date.now(), by: myId(), from: 'claude-artifacts-2026-10-26' });
    await metaSet('seeded', true);
  }
  async function sync() {
    if (!sb || !session || !navigator.onLine) { status(); return; }
    if (syncing) { again = true; return; }
    syncing = true; status();
    try {
      await load();
      await pull();
      await seedOnce();
      await pushDocs();
      await pushFiles();
      lastOk = Date.now(); lastErr = '';
      if (!chan) {
        chan = sb.channel('docs-live').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, () => kick()).subscribe();
      }
    } catch (e) {
      lastErr = (e && (e.message || e.error_description)) || String(e);
      console.warn('sync', e);
    }
    syncing = false; status();
    if (again) { again = false; kick(); }
  }

  window.addEventListener('online', () => kick(true));
  window.addEventListener('offline', () => status());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(true); });
  setInterval(() => kick(true), 30000);

  /* ---------------- 공개 API ---------------- */
  const API = { db, user, assets, downloads };
  window.claude = { use: async name => { await load(); return API[name] || null; } };
  window.STORE = {
    ready: READY,
    init: async () => { await Promise.all([load(), initAuth()]); kick(true); return session; },
    signedIn: () => !!myId(),
    session: () => session,
    async signIn(email, password) {
      if (!sb) throw new Error('서버 설정이 없습니다 (config.js)');
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session; localStorage.setItem('gn-uid', session.user.id); localStorage.setItem('gn-email', email);
      await load();
      const u = colMap('users').get(session.user.id);
      if (!u) await write('users', session.user.id, { name: email.split('@')[0], email });
      kick(true); return session;
    },
    async signOut() {
      const c = await counts();
      if (c.docs + c.files) throw new Error(`아직 서버에 못 올린 기록이 ${c.docs + c.files}건 있습니다. 인터넷 연결 후 동기화가 끝나면 로그아웃하세요.`);
      try { await sb.auth.signOut(); } catch (e) {}
      session = null; localStorage.removeItem('gn-uid');
    },
    onStatus: f => { ST.add(f); status(); return () => ST.delete(f); },
    onAuth: f => { AUTHL.add(f); return () => AUTHL.delete(f); },
    syncNow: () => kick(true),
    status,
    db, assets, downloads, user,
    async setName(name) { const id = myId(); if (!id) return; const cur = colMap('users').get(id) || {}; await write('users', id, { ...cur, name }); },
    myName: () => { const u = colMap('users').get(myId()); return (u && u.name) || ''; },
  };
})();
