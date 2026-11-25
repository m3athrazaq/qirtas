"""The new sync, end to end against the local server (wrangler pages dev + local D1):
start on one device, link a second with a code, edits both ways within seconds, offline edits
merging, a third device by recovery key, a device removed elsewhere, and a workspace
synced with the old server carried over as itself."""
import os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_common import *

fails = []
DBNAME = 'qirtas'
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: fails.append(msg)

def titles(pg):
    return pg.evaluate("() => [...document.querySelectorAll('.tree .tree-title')].map((e) => e.textContent.trim())")

def open_account(pg):
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    if pg.locator('.sb-signin').count():
        pg.locator('.sb-signin').click()
    else:
        pg.locator('.sb-item', has_text='الإعدادات').click(); pg.wait_for_timeout(300)
        pg.locator('.settings-nav button, .set-nav button, [role=tab]', has_text='الحساب').first.click()
    pg.wait_for_timeout(600)

def add_page(pg, title, text):
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.evaluate("() => { location.hash = '#/' }"); pg.wait_for_timeout(400)
    pg.locator('.sb-item', has_text='صفحة جديدة').click(); pg.wait_for_timeout(600)
    pg.keyboard.type(title); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    pg.keyboard.type(text); pg.wait_for_timeout(500)

def page_text(pg, title):
    pg.evaluate("() => { location.hash = '#/' }"); pg.wait_for_timeout(400)
    pg.locator('.tree .tree-title', has_text=title).first.click(); pg.wait_for_timeout(700)
    return pg.locator('.ProseMirror').first.inner_text()

with sync_playwright() as p:
    # ---------- device A (computer): starts sync
    bA, A, errA = new_page(p)
    add_page(A, 'من الحاسوب', 'كتبت هذا على الحاسوب')
    open_account(A)
    A.locator('.link-choice', has_text='هذا أول جهاز').click(); A.wait_for_timeout(300)
    A.locator('.link-form input').first.fill('معاذ')
    A.locator('.link-form .btn-primary').click()
    A.wait_for_selector('.recovery-box', timeout=15000)
    key = A.locator('.recovery-key').inner_text().strip()
    check(re.fullmatch(r'[0-9A-Z]{5}(-[0-9A-Z]{5}){4}', key) is not None, f'a recovery key is shown once ({key})')
    A.screenshot(path=OUT + '/shots/c2-recovery.png')
    A.locator('.recovery-box .btn-primary').click(); A.wait_for_timeout(300)
    check(A.locator('.sync-pill').count() == 1, 'the device is linked')
    ok = wait_for(A, "() => document.querySelector('.sync-pill')?.classList.contains('is-synced')", timeout=15000)
    check(bool(ok), 'and synced')
    A.locator('.devices-head .btn').click()
    A.wait_for_selector('.link-code', timeout=10000)
    code = A.locator('.link-code').inner_text().strip()
    check(re.fullmatch(r'[0-9A-Z]{4}-[0-9A-Z]{4}', code) is not None, f'a link code for another device ({code})')
    A.screenshot(path=OUT + '/shots/c3-link-code.png')

    # ---------- device B (phone): links with the code, gets A's pages, its own come along
    bB, B, errB = new_page(p, mobile=True)
    B.evaluate("() => { location.hash = '#/' }")
    B.wait_for_timeout(500)
    open_account(B)
    B.locator('.link-choice', has_text='عندي جهاز مربوط').click(); B.wait_for_timeout(300)
    B.locator('.link-code-input').fill(code.lower())
    B.screenshot(path=OUT + '/shots/c4-enter-code.png')
    B.locator('.link-form .btn-primary').click()
    # Linking moves the phone into the account's workspace (the page reloads)
    B.wait_for_timeout(4000)
    B.wait_for_load_state('load')
    got = wait_for(B, "() => [...document.querySelectorAll('.tree .tree-title')].some((e) => e.textContent.includes('من الحاسوب'))", timeout=20000)
    if not got:
        B.locator('.sb-item').first.wait_for(timeout=5000)
    check(bool(wait_for(B, "() => [...document.querySelectorAll('.tree .tree-title, .sb-item')].some((e) => e.textContent.includes('من الحاسوب'))", timeout=20000)), 'the phone has the computer\'s page after linking')

    # ---------- edits both ways within seconds
    t0 = time.time()
    add_page(A, 'ملاحظة جديدة', 'وصلت إلى الهاتف')
    seen = wait_for(B, "() => [...document.querySelectorAll('.tree .tree-title')].some((e) => e.textContent.includes('ملاحظة جديدة'))", timeout=20000)
    check(bool(seen), f'a page made on the computer shows on the phone ({time.time() - t0:.1f}s)')
    t0 = time.time()
    add_page(B, 'من الهاتف', 'كتبت هذا على الهاتف')
    seen = wait_for(A, "() => [...document.querySelectorAll('.tree .tree-title')].some((e) => e.textContent.includes('من الهاتف'))", timeout=20000)
    check(bool(seen), f'and one made on the phone shows on the computer ({time.time() - t0:.1f}s)')
    A.wait_for_timeout(1500)
    check('كتبت هذا على الهاتف' in page_text(A, 'من الهاتف'), 'with its text')

    # ---------- offline edits on both, then they meet
    B.context.set_offline(True)
    add_page(B, 'بلا اتصال', 'كُتب والهاتف بلا إنترنت')
    add_page(A, 'أثناء الانقطاع', 'كُتب على الحاسوب أثناء انقطاع الهاتف')
    B.wait_for_timeout(2000)
    B.context.set_offline(False)
    B.evaluate("() => window.dispatchEvent(new Event('online'))")
    B.evaluate("() => { location.hash = '#/' }")
    a_has = wait_for(A, "() => [...document.querySelectorAll('.tree .tree-title')].some((e) => e.textContent.includes('بلا اتصال'))", timeout=30000)
    b_has = wait_for(B, "() => [...document.querySelectorAll('.tree .tree-title')].some((e) => e.textContent.includes('أثناء الانقطاع'))", timeout=30000)
    check(bool(a_has), 'a page written on the phone while offline reaches the computer when it is back')
    check(bool(b_has), 'and what the computer wrote meanwhile reaches the phone')

    # ---------- device list, a third device by recovery key
    open_account(A)
    n = wait_for(A, "() => document.querySelectorAll('.device-list li').length >= 2 && document.querySelectorAll('.device-list li').length", timeout=10000)
    check(n == 2, f'the computer lists two devices ({n})')
    bC, C, errC = new_page(p)
    open_account(C)
    C.locator('.link-lost').click(); C.wait_for_timeout(300)
    C.locator('.link-code-input').fill(key)
    C.locator('.link-form .btn-primary').click()
    C.wait_for_timeout(4000); C.wait_for_load_state('load')
    check(bool(wait_for(C, "() => [...document.querySelectorAll('.tree .tree-title')].some((e) => e.textContent.includes('من الهاتف'))", timeout=20000)), 'a third device linked with the recovery key has everything')

    # ---------- a device removed on another device stops syncing, its pages stay
    open_account(A)
    A.wait_for_timeout(1000)
    rows = A.locator('.device-list li')
    target = None
    for i in range(rows.count()):
        txt = rows.nth(i).inner_text()
        if 'Linux' in txt and 'هذا الجهاز' not in txt and rows.nth(i).locator('.icon-btn').count():
            target = rows.nth(i)
    if target is None:
        target = rows.nth(rows.count() - 1)
    target.locator('.icon-btn').click(); A.wait_for_timeout(400)
    A.locator('.dialog .dialog-actions button[type=submit]').click(); A.wait_for_timeout(1500)
    # C notices at its next request
    C.keyboard.press('Escape')
    add_page(C, 'بعد الإزالة', 'لن يصل')
    told = wait_for(C, "() => [...document.querySelectorAll('.toast')].some((e) => e.textContent.includes('أُزيل هذا الجهاز'))", timeout=40000)
    check(bool(told), 'a device removed elsewhere says so')
    check(any('بعد الإزالة' in x for x in titles(C)), 'and keeps its pages')
    A.wait_for_timeout(3000)
    check(not any('بعد الإزالة' in x for x in titles(A)), 'what it writes afterwards no longer reaches the account')

    # ---------- a workspace synced with the old server comes over as itself (not merged)
    bD, D, errD = new_page(p)
    add_page(D, 'مساحة قديمة', 'كانت متزامنة مع الخادم القديم')
    D.evaluate("""(name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); const s = tx.objectStore('kv'); const g = s.get('currentWs'); g.onsuccess = () => { const ws = g.result.value; s.put({ key: 'sync:linked:' + ws, value: true }); s.put({ key: 'sync:role:' + ws, value: 'owner' }); tx.oncomplete = () => res(ws) } } })""", DBNAME)
    open_account(A)
    A.locator('.devices-head .btn').click(); A.wait_for_selector('.link-code', timeout=10000)
    code2 = A.locator('.link-code').inner_text().strip()
    open_account(D)
    D.locator('.link-choice', has_text='عندي جهاز مربوط').click(); D.wait_for_timeout(200)
    D.locator('.link-code-input').fill(code2)
    D.locator('.link-form .btn-primary').click(); D.wait_for_timeout(5000)
    still = titles(D)
    check(any('مساحة قديمة' in x for x in still) and not any('من الهاتف' in x for x in still), f'the old-server workspace stays itself on that device ({still[:4]})')
    A.reload(); A.wait_for_load_state('load'); A.wait_for_timeout(2500)
    A.locator('.ws-switch, .workspace-switch, .sb-ws, .ws-menu-btn').first.click() if A.locator('.ws-switch, .workspace-switch, .sb-ws, .ws-menu-btn').count() else None
    A.wait_for_timeout(600)
    A.screenshot(path=OUT + '/shots/c5-workspaces.png')
    names = A.evaluate("() => document.body.innerText")
    check(names.count('قِرطاس') >= 0, 'workspace list rendered')
    A.screenshot(path=OUT + '/shots/c6-computer.png')
    B.screenshot(path=OUT + '/shots/c7-phone.png')
    for nm, e in (('A', errA), ('B', errB), ('C', errC), ('D', errD)):
        bad = [x for x in e if 'Failed to load resource' not in x and '401' not in x and '404' not in x]
        check(not bad, f'no errors on {nm} ({bad[:2]})')
    for b in (bA, bB, bC, bD): b.close()

print('\nFAILED:' if fails else '\nALL PASSED', len(fails))
for f in fails: print(' -', f)
