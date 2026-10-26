"""시험용 가짜 Supabase + 정적 서버 (앱 동기화 동작 확인용, 배포와 무관)
python3 tools/mock_supabase.py 8787  → http://localhost:8787/
/js/config.js 는 이 서버 주소를 가리키도록 바꿔서 내보냄.
"""
import json, sys, re, threading, urllib.parse, pathlib, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

WWW = pathlib.Path(__file__).resolve().parent.parent / 'www'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
LOCK = threading.Lock()
DOCS = {}      # (col,id) -> row
FILES = {}     # name -> bytes
REV = [0]
USER = {'id': '11111111-1111-1111-1111-111111111111', 'email': 'test@site.kr', 'aud': 'authenticated', 'role': 'authenticated'}


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

    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == '/js/config.js':
            b = f"window.APP_CONFIG={{supabaseUrl:'http://localhost:{PORT}',supabaseKey:'test-key'}};".encode()
            self.send_response(200); self.send_header('Content-Type', 'text/javascript'); self.end_headers(); self.wfile.write(b); return
        if u.path == '/auth/v1/user':
            return self.js(USER)
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
        m = re.match(r'/storage/v1/object/(?:authenticated/)?photos/(.+)', u.path)
        if m:
            b = FILES.get(urllib.parse.unquote(m.group(1)))
            if b is None:
                return self.js({'error': 'not found'}, 404)
            self.send_response(200); self.cors(); self.send_header('Content-Type', 'image/jpeg'); self.end_headers(); self.wfile.write(b); return
        if u.path == '/__state':
            return self.js({'docs': {f'{c}/{i}': r for (c, i), r in DOCS.items()}, 'files': list(FILES)})
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
        if u.path == '/__write':   # 다른 기기 흉내
            r = json.loads(self.body())
            with LOCK:
                REV[0] += 1
                DOCS[(r['col'], r['id'])] = {'col': r['col'], 'id': r['id'], 'data': r.get('data'), 'deleted': False, 'rev': REV[0]}
            return self.js({'ok': 1})
        m = re.match(r'/storage/v1/object/photos/(.+)', u.path)
        if m:
            FILES[urllib.parse.unquote(m.group(1))] = self.body()
            return self.js({'Key': 'photos/' + m.group(1)})
        return self.js({'error': 'nf'}, 404)

    do_PUT = do_POST

    def do_DELETE(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith('/storage/v1/object/photos'):
            b = json.loads(self.body() or b'{}')
            for p in b.get('prefixes', []):
                FILES.pop(p, None)
            return self.js([])
        return self.js({}, 404)


ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
