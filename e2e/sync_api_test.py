"""The sync server's API end to end, against the local server on 8788."""
import json, urllib.request, base64, uuid, time, threading, os
B = os.environ.get('API', 'http://127.0.0.1:8788/api')
fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
def call(method, path, body=None, token=None, raw=None, ctype=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'content-type': ctype or 'application/json'}
    if token: h['authorization'] = 'Bearer ' + token
    req = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            b = r.read(); ct = r.headers.get('content-type', '')
            return r.status, (json.loads(b) if 'json' in ct else b)
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b
b64 = lambda b: base64.b64encode(b).decode()

# accounts and devices
s, a = call('POST', '/account', {'name': 'معاذ', 'label': 'Windows'})
check(s == 200 and a['token'] and len(a['recovery']) == 25, f'a new account with a recovery key ({s})')
tokA = a['token']; acc = a['account']['id']
s, lc = call('POST', '/link', {}, tokA)
check(s == 200 and len(lc['code']) == 9 and lc['code'][4] == '-', f'a link code ({lc})')
s, bad = call('POST', '/link/claim', {'code': 'ZZZZ-ZZZZ', 'label': 'x'})
check(s == 400 and bad['error'] == 'bad_code', 'a wrong code is refused')
s, b = call('POST', '/link/claim', {'code': lc['code'].lower().replace('-', ' '), 'label': 'OnePlus'})
check(s == 200 and b['account']['id'] == acc, 'the code links a second device to the same account (any case, spaces)')
tokB = b['token']
s, again = call('POST', '/link/claim', {'code': lc['code'], 'label': 'x'})
check(s == 400, 'a code works once')
s, info = call('GET', '/account', None, tokB)
check(s == 200 and len(info['devices']) == 2 and sum(d['current'] for d in info['devices']) == 1, 'both devices are listed, this one marked')
s, _ = call('GET', '/account', None, 'x' * 43)
check(s == 401, 'an unknown token is refused')
s, r = call('POST', '/recover', {'key': a['recovery'], 'label': 'new phone'})
check(s == 200 and r['account']['id'] == acc, 'the recovery key links a device')
tokC = r['token']
s, _ = call('POST', '/account/recovery', {}, tokA)
s2, _ = call('POST', '/recover', {'key': a['recovery'], 'label': 'y'})
check(s == 200 and s2 == 400, 'a new recovery key replaces the old one')
devC = [d for d in call('GET', '/account', None, tokC)[1]['devices'] if d['current']][0]['id']
s, _ = call('DELETE', '/devices/' + devC, None, tokA)
check(call('GET', '/account', None, tokC)[0] == 401, 'a removed device is signed out')

# workspaces
ws = str(uuid.uuid4())
s, w = call('POST', '/workspaces', {'id': ws, 'name': 'مساحتي', 'my_name': 'معاذ'}, tokA)
check(s == 200 and w['role'] == 'owner', 'a device registers its workspace')
s, w2 = call('POST', '/workspaces', {'id': ws, 'name': 'x'}, tokB)
check(s == 200 and w2['role'] == 'owner', 'the account\'s other device joins it again')
s, lst = call('GET', '/workspaces', None, tokB)
check(s == 200 and lst['workspaces'][0]['id'] == ws and lst['workspaces'][0]['name'] == 'مساحتي', 'listed with its name')

# the update log
rows = [{'doc': f'pg:p{i}', 'data': b64(bytes([i % 256]) * 10), 'client': 'A'} for i in range(20)]
s, p = call('POST', f'/workspaces/{ws}/updates', {'rows': rows}, tokA)
check(s == 200 and len(p['ids']) == 20 and p['ids'] == sorted(p['ids']), 'twenty rows pushed in order')
big = os.urandom(2_500_000)
s, p2 = call('POST', f'/workspaces/{ws}/updates', {'rows': [{'doc': 'pg:big', 'data': b64(big), 'client': 'A'}]}, tokA)
check(s == 200, f'a 2.5 MB update is stored in pieces ({s})')
s, pl = call('GET', f'/workspaces/{ws}/updates?after=0', None, tokB)
check(s == 200 and len(pl['rows']) == 21 and base64.b64decode(pl['rows'][-1]['data']) == big, 'pulled back intact, the large one too')
s, pl2 = call('GET', f'/workspaces/{ws}/updates?after={p["ids"][9]}', None, tokB)
check(len(pl2['rows']) == 11, 'after a bookmark: only newer rows')
s, one = call('GET', f'/workspaces/{ws}/updates?doc=pg:p3', None, tokB)
check(len(one['rows']) == 1 and one['rows'][0]['doc_id'] == 'pg:p3', 'one document\'s rows')
s, c = call('POST', f'/workspaces/{ws}/compact', {'doc': 'pg:p3', 'upto': p['ids'][3], 'merged': b64(b'merged')}, tokA)
s, one = call('GET', f'/workspaces/{ws}/updates?doc=pg:p3', None, tokB)
check(len(one['rows']) == 1 and base64.b64decode(one['rows'][0]['data']) == b'merged' and one['rows'][0]['client_id'] == 'compact', 'compacting replaces a document\'s history')

# waiting for changes
s, w0 = call('GET', f'/workspaces/{ws}/wait?after=0&v=-1', None, tokB)
latest = w0['latest']; ver = w0['version']
got = {}
def waiter():
    t = time.time(); got['r'] = call('GET', f'/workspaces/{ws}/wait?after={latest}&v={ver}&client=B1&name=B&page=p1&color=%23111', None, tokB); got['t'] = time.time() - t
th = threading.Thread(target=waiter); th.start(); time.sleep(2)
call('POST', f'/workspaces/{ws}/updates', {'rows': [{'doc': 'pg:p1', 'data': b64(b'x'), 'client': 'A'}]}, tokA)
th.join()
check(got['r'][0] == 200 and got['r'][1]['latest'] > latest and got['t'] < 6, f'a waiting device hears of a change within seconds ({got["t"]:.1f}s)')
check(any(x['client_id'] == 'B1' and x['page_id'] == 'p1' for x in got['r'][1]['presence']), 'and who is where')

# sharing with someone else
s, o = call('POST', '/account', {'name': 'Guest', 'label': 'G'})
tokG = o['token']; accG = o['account']['id']
s, _ = call('GET', f'/workspaces/{ws}/updates?after=0', None, tokG)
check(s == 404, 'a stranger can\'t read the workspace')
s, _ = call('POST', '/workspaces', {'id': ws, 'name': 'x'}, tokG)
check(s == 403, 'nor claim it')
s, inv = call('POST', f'/workspaces/{ws}/invites', {'role': 'viewer'}, tokA)
s, ii = call('GET', f'/invites/{inv["token"]}')
check(ii['invite']['name'] == 'مساحتي' and ii['invite']['role'] == 'viewer', 'an invitation tells what it is for')
s, acc2 = call('POST', f'/invites/{inv["token"]}/accept', {'name': 'Guest'}, tokG)
check(s == 200 and acc2['workspace_id'] == ws, 'accepted')
s, _ = call('POST', f'/workspaces/{ws}/updates', {'rows': [{'doc': 'pg:p1', 'data': b64(b'y')}]}, tokG)
check(s == 403, 'a viewer can\'t write')
s, mem = call('GET', f'/workspaces/{ws}/members', None, tokA)
check(len(mem['members']) == 2, 'two members')
s, _ = call('PATCH', f'/workspaces/{ws}/members/{accG}', {'role': 'editor'}, tokA)
s, _ = call('POST', f'/workspaces/{ws}/updates', {'rows': [{'doc': 'pg:p1', 'data': b64(b'y')}]}, tokG)
check(s == 200, 'made an editor, they can write')
s, _ = call('DELETE', f'/workspaces/{ws}/members/{acc}', None, tokG)
check(s == 403, 'they can\'t remove the owner')
s, _ = call('DELETE', f'/workspaces/{ws}/members/{accG}', None, tokA)
s, _ = call('GET', f'/workspaces/{ws}/updates?after=0', None, tokG)
s2, _ = call('POST', f'/invites/{inv["token"]}/accept', {}, tokG)
check(s == 404 and s2 == 400, 'removed, they lose access and their old link stops working')

# pictures
png = b'\x89PNG\r\n\x1a\n' + os.urandom(1_500_000)
s, _ = call('PUT', f'/workspaces/{ws}/assets/img-1', raw=png, token=tokA, ctype='image/png')
s2, back = call('GET', f'/workspaces/{ws}/assets/img-1', None, tokB)
check(s == 200 and back == png, 'a picture goes up and comes back whole')
s, _ = call('PUT', f'/workspaces/{ws}/assets/doc-1', raw=b'hello', token=tokA, ctype='text/plain')
check(s == 415, 'only pictures')

# the assistant without a key on the server
s, ai = call('POST', '/ai', {'messages': [{'role': 'user', 'content': 'hi'}]}, tokA)
check(s == 503 and ai['error'] == 'noserver', 'the assistant says when the server has no key')

# deleting the account
s, _ = call('DELETE', '/account', None, tokA)
check(call('GET', '/account', None, tokB)[0] == 401, 'deleting the account signs out its devices')
check(call('GET', f'/workspaces/{ws}/members', None, tokG)[0] == 404, 'and its workspaces are gone')
print('\nFAILED' if fails else '\nALL PASSED', len(fails))
for f in fails: print(' -', f)
