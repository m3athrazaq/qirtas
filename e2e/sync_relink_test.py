"""Two devices that each started their own account for the same workspace: the second is told,
and linking it with a code from the first keeps its pages and merges them."""
import os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_common import *

fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: fails.append(msg)

def titles(pg):
    return pg.evaluate("() => [...document.querySelectorAll('.tree .tree-title')].map((e) => e.textContent.trim())")

def add_page(pg, title, text):
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.evaluate("() => { location.hash = '#/' }"); pg.wait_for_timeout(400)
    pg.locator('.sb-item', has_text='صفحة جديدة').click(); pg.wait_for_timeout(600)
    pg.keyboard.type(title); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    pg.keyboard.type(text); pg.wait_for_timeout(500)

def start(pg, name):
    pg.locator('.sb-signin').click(); pg.wait_for_timeout(500)
    pg.locator('.link-choice', has_text='هذا أول جهاز').click(); pg.wait_for_timeout(200)
    pg.locator('.link-form input').first.fill(name)
    pg.locator('.link-form .btn-primary').click()
    pg.wait_for_selector('.recovery-box', timeout=15000)
    pg.locator('.recovery-box .btn-primary').click(); pg.wait_for_timeout(300)

KV = """([name, key, value]) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); if (value == null) { const g = tx.objectStore('kv').get(key); g.onsuccess = () => res(g.result && g.result.value) } else { tx.objectStore('kv').put({ key, value }); tx.oncomplete = () => res(value) } } })"""

with sync_playwright() as p:
    bA, A, errA = new_page(p)
    add_page(A, 'صفحة الحاسوب', 'على الحاسوب')
    wsA = A.evaluate(KV, ['qirtas', 'currentWs', None])
    # The phone had the same workspace (both synced with the old server)
    bE, E, errE = new_page(p, mobile=True)
    E.evaluate(KV, ['qirtas', 'currentWs', wsA])
    E.reload(); E.wait_for_load_state('load'); E.wait_for_timeout(1500)
    add_page(E, 'صفحة الهاتف', 'على الهاتف')
    start(A, 'معاذ')
    A.wait_for_timeout(3000)
    E.keyboard.press('Escape'); E.evaluate("() => { location.hash = '#/' }"); E.wait_for_timeout(300)
    start(E, 'معاذ')
    told = wait_for(E, "() => [...document.querySelectorAll('.toast')].some((e) => e.textContent.includes('مربوطة بحساب آخر'))", timeout=15000)
    check(bool(told), 'the second account is told the workspace belongs to another account')
    # A makes a code; E links with it from the account page
    A.keyboard.press('Escape'); A.locator('.sb-item', has_text='الإعدادات').click(); A.wait_for_timeout(300)
    A.locator('button', has_text='الحساب والمزامنة').first.click(); A.wait_for_timeout(400)
    A.locator('.devices-head .btn').click(); A.wait_for_selector('.link-code', timeout=10000)
    code = A.locator('.link-code').inner_text().strip()
    E.locator('.toast button', has_text='اربطه برمز').click(); E.wait_for_timeout(800)
    E.locator('.link-lost', has_text='حساب خطأ').click(); E.wait_for_timeout(300)
    E.locator('.link-form .link-code-input').fill(code)
    E.locator('.link-form .btn-primary').click()
    E.wait_for_timeout(6000)
    E.keyboard.press('Escape'); E.evaluate("() => { location.hash = '#/' }"); E.wait_for_timeout(500)
    tE = titles(E)
    check(any('صفحة الهاتف' in x for x in tE) and any('صفحة الحاسوب' in x for x in tE), f'linked with the code, the phone keeps its page and gets the computer\'s ({tE})')
    got = wait_for(A, "() => [...document.querySelectorAll('.tree .tree-title')].some((e) => e.textContent.includes('صفحة الهاتف'))", timeout=20000)
    check(bool(got), 'and the computer gets the phone\'s page')
    check(not [x for x in errA + errE if '401' not in x and '403' not in x and 'Failed to load resource' not in x], f'no errors ({(errA + errE)[:2]})')
    bA.close(); bE.close()

print('\nFAILED:' if fails else '\nALL PASSED', len(fails))
for f in fails: print(' -', f)
