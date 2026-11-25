"""A quick check of a deployed sync server (the Pages project with its D1 database): an account, a
workspace, an update stored and read back, a second device linked with a code, then everything it
made is deleted again. Usage: API=https://<site>/api python3 e2e/sync_live_check.py"""
import json, urllib.request, base64, uuid, os, sys, time
B = os.environ['API'].rstrip('/')
fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m, flush=True)
    if not c: fails.append(m)
def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {'content-type': 'application/json', 'user-agent': 'qirtas-live-check'}
    if token: h['authorization'] = 'Bearer ' + token
    req = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            b = r.read()
            return r.status, (json.loads(b) if 'json' in r.headers.get('content-type', '') else b)
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b

# Right after a push the site may still be the previous deployment: wait for the server (5 minutes at most)
for _ in range(30):
    s, h = call('GET', '/health')
    if s == 200 and isinstance(h, dict) and h.get('ok'): break
    time.sleep(10)
check(s == 200 and isinstance(h, dict) and h.get('ok'), f'the server answers ({s} {h if isinstance(h, dict) else str(h[:80])})')
s, a = call('POST', '/account', {'name': 'live check', 'label': 'CI'})
check(s == 200 and a.get('token'), f'an account is made, so the database works ({s})')
if s != 200:
    print('\nFAILED:', len(fails)); sys.exit(1)
tok = a['token']
try:
    ws = str(uuid.uuid4())
    s, w = call('POST', '/workspaces', {'id': ws, 'name': 'live check'}, tok)
    check(s == 200 and w.get('role') == 'owner', f'a workspace is registered ({s})')
    data = base64.b64encode(os.urandom(4000)).decode()
    s, p = call('POST', f'/workspaces/{ws}/updates', {'rows': [{'doc': 'pg:live', 'data': data, 'client': 'CI'}]}, tok)
    check(s == 200 and len(p.get('ids', [])) == 1, f'an update is stored ({s})')
    s, pl = call('GET', f'/workspaces/{ws}/updates?after=0', None, tok)
    check(s == 200 and pl['rows'] and pl['rows'][0]['data'] == data, 'and read back intact')
    s, lc = call('POST', '/link', {}, tok)
    s2, b = call('POST', '/link/claim', {'code': lc.get('code', ''), 'label': 'CI 2'})
    check(s == 200 and s2 == 200 and b['account']['id'] == a['account']['id'], 'a second device links with a code')
    s, pl2 = call('GET', f'/workspaces/{ws}/updates?after=0', None, b.get('token'))
    check(s == 200 and len(pl2['rows']) == 1, 'and sees the same update')
    s, ai = call('POST', '/ai', {'messages': [{'role': 'user', 'content': 'hi'}]}, tok)
    print('INFO writing assistant on the server:', 'ready' if s == 200 else f'not set up ({s} {ai if isinstance(ai, dict) else ""})')
finally:
    s, _ = call('DELETE', '/account', None, tok)
    check(s == 200, 'the account and its workspace are deleted again')
    check(call('GET', '/account', None, tok)[0] == 401, 'its devices are signed out')
print('\nFAILED:' if fails else '\nALL PASSED', len(fails))
for f in fails: print(' -', f)
sys.exit(1 if fails else 0)
