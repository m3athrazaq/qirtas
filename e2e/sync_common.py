import time, json, os
from playwright.sync_api import sync_playwright
URL = os.environ.get('QURL', 'http://127.0.0.1:8788/')
OUT = os.environ.get('SHOTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sync-shots'))
os.makedirs(os.path.join(OUT, 'shots'), exist_ok=True)

def new_page(p, mobile=False, ctx_opts=None):
    b = p.chromium.launch()
    opts = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True) if mobile else dict(viewport={'width': 1366, 'height': 860})
    opts.update(locale='ar', timezone_id='Asia/Kuwait')
    if ctx_opts: opts.update(ctx_opts)
    ctx = b.new_context(**opts)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append('console: ' + m.text))
    pg.goto(URL, wait_until='networkidle'); pg.wait_for_timeout(1500)
    return b, pg, errs

def wait_for(pg, js, arg=None, timeout=10000, step=200):
    end = time.time() + timeout / 1000
    v = None
    while time.time() < end:
        v = pg.evaluate(js, arg)
        if v: return v
        pg.wait_for_timeout(step)
    return v
