"""시험용 가짜 Supabase + 정적 서버 (앱 동기화 동작 확인용, 배포와 무관)
python3 tools/mock_supabase.py 8787  → http://localhost:8787/
/js/config.js 는 이 서버 주소를 가리키도록 바꿔서 내보냄.
"""
import json, sys, re, threading, urllib.parse, pathlib, time, uuid, base64, mimetypes
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

WWW = pathlib.Path(__file__).resolve().parent.parent / 'www'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
LOCK = threading.Lock()
DOCS = {}      # (col,id) -> row
FILES = {}     # 'bucket/name' -> (bytes, content-type)
REV = [0]
USER = {'id': '11111111-1111-1111-1111-111111111111', 'email': 'test@site.kr', 'aud': 'authenticated', 'role': 'authenticated'}


# 클라우드 탭 시험: python3 tools/mock_supabase.py 8787 <폴더>  → 그 폴더를 다른 계정(admin)이 공유해 준 '01 시험 현장' 으로 보여 줌
ADMIN = '22222222-2222-2222-2222-222222222222'
ITEMS = {}     # id -> cloud_items 행
GRANTS = []
QUOTA_USED = [0]
TUS = {}       # id -> {'len', 'meta', 'data'}


def add_item(parent, name, folder, size=0, mime='', id=None, owner=ADMIN):
    i = id or str(uuid.uuid4())
    ITEMS[i] = {'id': i, 'owner': owner, 'parent_id': parent, 'name': name, 'is_folder': folder, 'size': size, 'mime': mime,
                'trashed_at': None, 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%S+00:00')}
    return i


def seed_cloud(root):
    top = add_item(None, '01 시험 현장', True)
    GRANTS.append({'folder_id': top, 'user_id': USER['id'], 'can_write': True})
    add_item(None, '02 남의 폴더', True)

    def walk(d, parent):
        for f in sorted(d.iterdir()):
            if f.name.startswith('.'):
                continue
            if f.is_dir():
                walk(f, add_item(parent, f.name, True))
            else:
                b = f.read_bytes(); mt = mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
                FILES[f'cloud/{ADMIN}/' + add_item(parent, f.name, False, len(b), mt)] = (b, mt)
    walk(pathlib.Path(root), top)


def tok():
    return {'access_token': 'tok', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
            'refresh_token': 'ref', 'user': USER}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WWW), **k)

    def log_message(self, *a):
        pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')

    def js(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.cors()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def cloud_rows(self, q):   # 공유받은 폴더 안 + 내 것만 보이는 것까지 흉내
        def visible(r):
            if r['owner'] == USER['id']:
                return True
            g = {x['folder_id'] for x in GRANTS}
            while r:
                if r['id'] in g:
                    return True
                r = ITEMS.get(r['parent_id'])
            return False
        rows = [r for r in ITEMS.values() if visible(r)]
        for k, v in q.items():
            v = v[0]
            if k == 'select':
                continue
            op, val = v.split('.', 1)
            if op == 'eq':
                rows = [r for r in rows if str(r[k]) == val]
            if op == 'is':
                rows = [r for r in rows if r[k] is None]
            if op == 'in':
                rows = [r for r in rows if str(r[k]) in val.strip('()').split(',')]
        return rows

    def do_HEAD(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == '/rest/v1/cloud_items':
            n = len(self.cloud_rows(q))
            self.send_response(200); self.cors(); self.send_header('Access-Control-Expose-Headers', '*'); self.send_header('Content-Range', f'*/{n}'); self.end_headers(); return
        m = re.match(r'/storage/v1/upload/resumable/(.+)', u.path)
        if m and m.group(1) in TUS:
            t = TUS[m.group(1)]
            self.send_response(200); self.cors(); self.send_header('Access-Control-Expose-Headers', '*'); self.send_header('Tus-Resumable', '1.0.0')
            self.send_header('Upload-Offset', str(len(t['data']))); self.send_header('Upload-Length', str(t['len'])); self.end_headers(); return
        return super().do_HEAD()

    def tus_reply(self, tid, code):
        t = TUS[tid]
        if len(t['data']) >= t['len']:
            meta = dict((kv.split(' ') + [''])[:2] for kv in t['meta'].split(','))
            dec = {k: base64.b64decode(v).decode() for k, v in meta.items()}
            FILES[dec['bucketName'] + '/' + dec['objectName']] = (bytes(t['data']), dec.get('contentType', ''))
        self.send_response(code); self.cors(); self.send_header('Access-Control-Expose-Headers', '*'); self.send_header('Tus-Resumable', '1.0.0')
        self.send_header('Location', f'http://localhost:{PORT}/storage/v1/upload/resumable/{tid}'); self.send_header('Upload-Offset', str(len(t['data'])))
        self.send_header('Content-Length', '0'); self.end_headers()

    def do_PATCH(self):
        m = re.match(r'/storage/v1/upload/resumable/(.+)', urllib.parse.urlparse(self.path).path)
        if m and m.group(1) in TUS:
            TUS[m.group(1)]['data'] += self.body(); return self.tus_reply(m.group(1), 204)
        return self.js({}, 404)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == '/js/config.js':
            b = f"window.APP_CONFIG={{supabaseUrl:'http://localhost:{PORT}',supabaseKey:'test-key'}};".encode()
            self.send_response(200); self.send_header('Content-Type', 'text/javascript'); self.end_headers(); self.wfile.write(b); return
        if u.path == '/auth/v1/user':
            return self.js(USER)
        if u.path == '/rest/v1/cloud_grants':
            return self.js([g for g in GRANTS if 'user_id' not in q or q['user_id'][0] == 'eq.' + g['user_id']])
        if u.path == '/rest/v1/cloud_items':
            return self.js(self.cloud_rows(q))
        if u.path == '/rest/v1/docs':
            with LOCK:
                rows = list(DOCS.values())
            for k, v in q.items():
                v = v[0]
                if k in ('select', 'order', 'limit'):
                    continue
                op, val = v.split('.', 1)
                if op == 'eq':
                    rows = [r for r in rows if str(r[k]) == val]
                if op == 'gt':
                    rows = [r for r in rows if r[k] > float(val)]
            if 'order' in q:
                rows.sort(key=lambda r: r['rev'])
            if 'limit' in q:
                rows = rows[:int(q['limit'][0])]
            return self.js(rows)
        m = re.match(r'/storage/v1/object/(?:authenticated/)?(\w+)/(.+)', u.path)
        if m:
            f = FILES.get(m.group(1) + '/' + urllib.parse.unquote(m.group(2)))
            if f is None:
                return self.js({'error': 'not found'}, 404)
            self.send_response(200); self.cors(); self.send_header('Content-Type', f[1]); self.end_headers(); self.wfile.write(f[0]); return
        if u.path == '/__pdf':   # 시험용: 올려 둔 것 중 첫 PDF
            f = next((v for k, v in FILES.items() if v[1] == 'application/pdf'), None)
            if f:
                self.send_response(200); self.cors(); self.send_header('Content-Type', f[1]); self.end_headers(); self.wfile.write(f[0]); return
        if u.path == '/__state':
            return self.js({'docs': {f'{c}/{i}': r for (c, i), r in DOCS.items()}, 'files': list(FILES), 'cloud': list(ITEMS.values())})
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/auth/v1/token':
            b = json.loads(self.body() or b'{}')
            if b.get('password') == 'pw1234' or b.get('refresh_token'):
                return self.js(tok())
            return self.js({'error': 'invalid_grant', 'error_description': 'Invalid login credentials', 'msg': 'Invalid login credentials'}, 400)
        if u.path == '/rest/v1/docs':
            rows = json.loads(self.body())
            with LOCK:
                for r in rows:
                    REV[0] += 1
                    DOCS[(r['col'], r['id'])] = {'col': r['col'], 'id': r['id'], 'data': r.get('data'), 'deleted': bool(r.get('deleted')), 'rev': REV[0]}
            self.send_response(201); self.cors(); self.end_headers(); return
        if u.path == '/rest/v1/cloud_items':
            r = json.loads(self.body())
            par = ITEMS.get(r.get('parent_id'))
            if any(x['parent_id'] == r.get('parent_id') and x['name'].lower() == r['name'].lower() for x in ITEMS.values()):
                return self.js({'code': '23505', 'message': 'duplicate key value violates unique constraint'}, 409)
            if not par or r.get('owner') != par['owner']:
                return self.js({'code': '42501', 'message': 'new row violates row-level security policy for table "cloud_items"'}, 403)
            add_item(r['parent_id'], r['name'], bool(r.get('is_folder')), r.get('size', 0), r.get('mime', ''), r.get('id'), r['owner'])
            self.send_response(201); self.cors(); self.end_headers(); return
        if u.path == '/rest/v1/rpc/cloud_quota_info':   # 한도 50GB 흉내 (QUOTA_USED 로 사용량 바꿔 시험)
            used = QUOTA_USED[0] + sum(x['size'] for x in ITEMS.values() if not x['is_folder'])
            return self.js([{'folder_id': json.loads(self.body())['p_folder'], 'quota_bytes': 50 * 1024 ** 3, 'used_bytes': used}])
        if u.path == '/__quota_used':
            QUOTA_USED[0] = int(json.loads(self.body())['used']); return self.js({'ok': 1})
        if u.path == '/storage/v1/upload/resumable':
            tid = str(uuid.uuid4())
            TUS[tid] = {'len': int(self.headers['Upload-Length']), 'meta': self.headers['Upload-Metadata'], 'data': bytearray(self.body())}
            return self.tus_reply(tid, 201)
        if u.path == '/__write':   # 다른 기기 흉내
            r = json.loads(self.body())
            with LOCK:
                REV[0] += 1
                DOCS[(r['col'], r['id'])] = {'col': r['col'], 'id': r['id'], 'data': r.get('data'), 'deleted': False, 'rev': REV[0]}
            return self.js({'ok': 1})
        m = re.match(r'/storage/v1/object/list/(\w+)$', u.path)
        if m:
            b = json.loads(self.body() or b'{}'); o = int(b.get('offset', 0)); n = int(b.get('limit', 100))
            pre = m.group(1) + '/'
            names = sorted(k[len(pre):] for k in FILES if k.startswith(pre))[o:o + n]
            return self.js([{'name': k, 'id': k, 'metadata': {}} for k in names])
        if u.path == '/__dropfile':
            FILES.pop(json.loads(self.body())['name'], None); return self.js({'ok': 1})
        m = re.match(r'/storage/v1/object/(\w+)/(.+)', u.path)
        if m:
            raw, ct = self.body(), self.headers.get('Content-Type', '')
            if ct.startswith('multipart/form-data'):   # supabase-js 는 Blob 을 FormData 로 보냄
                bd = ct.split('boundary=')[1].encode()
                for part in raw.split(b'--' + bd):
                    if b'filename=' in part:
                        h, _, data = part.partition(b'\r\n\r\n')
                        mt = re.search(rb'Content-Type: ([^\r\n]+)', h)
                        raw, ct = data[:-2], (mt.group(1).decode() if mt else 'application/octet-stream')
            FILES[m.group(1) + '/' + urllib.parse.unquote(m.group(2))] = (raw, ct)
            return self.js({'Key': m.group(1) + '/' + m.group(2)})
        return self.js({'error': 'nf'}, 404)

    do_PUT = do_POST

    def do_DELETE(self):
        u = urllib.parse.urlparse(self.path)
        m = re.match(r'/storage/v1/object/(\w+)$', u.path)
        if m:
            b = json.loads(self.body() or b'{}')
            for p in b.get('prefixes', []):
                FILES.pop(m.group(1) + '/' + p, None)
            return self.js([])
        return self.js({}, 404)


if len(sys.argv) > 2:
    seed_cloud(sys.argv[2])
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
