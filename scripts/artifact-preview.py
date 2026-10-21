# Turns the single-file build (dist-preview/index.html) into a claude.ai artifact page.
import sys
src = open('dist-preview/index.html', encoding='utf-8').read()
s_open = '<script type="module" crossorigin>'
a = src.index(s_open)
b = src.index('</script>', a) + len('</script>')
script = src[a:b].replace('\ufffd', '\\uFFFD')  # keep the code ASCII-safe for publishing
st_open = src.index('<style', b)
st_close = src.index('</style>', st_open) + len('</style>')
style = src[st_open:st_close]
shim = """<style>
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark } }
:root[data-theme="dark"] { color-scheme: dark }
body { background: var(--paper); color: var(--ink) }
</style>"""
out = '<title>قِرطاس</title>\n' + style + '\n' + shim + '\n<div id="root"></div>\n' + script + '\n'
dest = sys.argv[1]
open(dest, 'w', encoding='utf-8').write(out)
test = dest.replace('.html', '-test.html')
open(test, 'w', encoding='utf-8').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + out + '</body></html>')
print('ok', len(out))
