// Drives the app's WebView inside the emulator over the DevTools protocol (debug build)
// and takes native screenshots. Uses Node's built-in WebSocket; no extra packages.
const { execSync } = require('node:child_process')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (name) => {
  try {
    execSync(`adb exec-out screencap -p > smoke/${name}.png`)
  } catch (e) {
    console.log('screencap failed', e.message)
  }
}
const adb = (cmd) => execSync(`adb shell ${cmd}`).toString()

async function target() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://localhost'))
      if (page) return page
      console.log('targets:', JSON.stringify(list.map((t) => [t.type, t.url])))
    } catch (e) {
      console.log('devtools not ready:', e.message)
    }
    await sleep(2000)
  }
  throw new Error('no WebView page target')
}

function client(url) {
  const ws = new WebSocket(url)
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method) listeners.forEach((l) => l(msg))
  }
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const send = (method, params = {}, timeout = 15000) =>
    new Promise((resolve) => {
      const mid = ++id
      const t = setTimeout(() => {
        pending.delete(mid)
        resolve({ error: { message: `timeout after ${timeout} ms (page busy?)` } })
      }, timeout)
      pending.set(mid, (m) => {
        clearTimeout(t)
        resolve(m)
      })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  return { ready, send, on: (fn) => listeners.push(fn), close: () => ws.close() }
}

async function evaluate(c, expression, timeout) {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout)
  if (r.error) return { error: r.error.message }
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }
  return r.result?.result?.value
}

;(async () => {
  const t = await target()
  console.log('page:', t.url, t.title)
  const c = client(t.webSocketDebuggerUrl)
  await c.ready
  c.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
      console.log(`[console.${m.params.type}] ${text.slice(0, 400)}`)
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      console.log(`[exception] ${(d.exception?.description ?? d.text).slice(0, 800)}`)
    } else if (m.method === 'Log.entryAdded') {
      console.log(`[log.${m.params.entry.level}] ${m.params.entry.text.slice(0, 300)}`)
    }
  })
  console.log('Runtime.enable:', JSON.stringify(await c.send('Runtime.enable', {}, 30000)).slice(0, 120)) // replays earlier console messages and errors
  await c.send('Log.enable')
  await sleep(1500)

  const diag = await evaluate(
    c,
    `(() => {
      const umq = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura').resolvedOptions().calendar
      return {
        ready: document.readyState,
        rootChildren: document.getElementById('root')?.childElementCount,
        sbItems: [...document.querySelectorAll('button.sb-item')].map((b) => b.textContent.trim()),
        fab: !!document.querySelector('.fab'),
        w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
        ua: navigator.userAgent,
        calendar: umq,
        hijriToday: new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { dateStyle: 'full' }).format(new Date()),
        safeVar: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
        idb: typeof indexedDB,
        timing: Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('qirtas:')).map((m) => [m.name, Math.round(m.startTime)])),
        nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return n && { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } })(),
        bodyText: document.body.innerText.slice(0, 200),
      }
    })()`,
    45000,
  )
  console.log('diagnostics:', JSON.stringify(diag, null, 1))
  shot('02-state')

  const click = (sel) => evaluate(c, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing ${sel}'; el.click(); return 'ok' })()`, 10000)
  const type = (text) => c.send('Input.insertText', { text })
  const key = async (k, code) => {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: k === 'Enter' ? 13 : 0 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: k === 'Enter' ? 13 : 0 })
  }

  const focusApp = () => adb('dumpsys window').split('\n').find((l) => l.includes('mCurrentFocus')) ?? ''
  const newParagraph = (text) =>
    evaluate(c, `(() => { const ed = document.querySelector('.ProseMirror').editor; ed.chain().focus('end').splitBlock().run(); return 'ok' })()`, 10000).then(() => text && type(text))

  if (diag && !diag.error && diag.fab) {
    console.log('new page:', await click('.fab'))
    await sleep(1500)
    await type('تجربة على الجوال')
    await key('Enter', 'Enter')
    await sleep(600)
    await type('سطر عربي ثم English line')
    await sleep(1000)
    shot('03-page')
    await newParagraph('')
    await sleep(300)
    await type('/')
    await sleep(1500)
    console.log('slash menu open:', await evaluate(c, `!!document.querySelector('.slash-menu, .slash')`, 5000))
    shot('04-slash')
    await type('مهام')
    await sleep(800)
    console.log('slash pick:', await evaluate(c, `(() => { const el = document.querySelector('.slash-menu .is-active, .slash .is-active, .slash-item.is-active'); if (!el) return 'no active item'; el.click(); return el.textContent.trim().slice(0, 30) })()`, 5000))
    await sleep(500)
    await type('مهمة أولى')
    await sleep(800)
    shot('05-tasks')
    console.log('page html:', await evaluate(c, `document.querySelector('.ProseMirror').innerHTML.replace(/ (class|style|data-[a-z-]+|dir|contenteditable|draggable)="[^"]*"/g, '').slice(0, 400)`, 5000))
    adb('input keyevent 4') // first back: closes the keyboard (system)
    await sleep(1200)
    adb('input keyevent 4') // second back: our handler goes to the parent (home)
    await sleep(1800)
    console.log('after back:', focusApp().trim(), '| route:', await evaluate(c, `location.hash || '(home)'`, 5000))
    shot('06-home')
    const tpl = await evaluate(c, `(() => { const b = [...document.querySelectorAll('button.sb-item')].find((x) => x.textContent.includes('القوالب')); if (!b) return 'no templates button'; b.click(); return 'ok' })()`, 10000)
    console.log('templates:', tpl)
    await sleep(1500)
    shot('07-templates')
    const ram = await evaluate(c, `(() => { const b = [...document.querySelectorAll('.tpl')].find((x) => x.textContent.includes('رمضان')); if (!b) return 'no ramadan'; b.click(); return 'ok' })()`, 10000)
    console.log('ramadan:', ram)
    await sleep(3500)
    shot('08-ramadan')
    adb('input keyevent 4')
    await sleep(1500)
    console.log('after back from template page:', focusApp().trim())
    await evaluate(c, `document.documentElement.setAttribute('data-theme', 'dark')`, 5000)
    await sleep(800)
    shot('09-dark')
    adb('input keyevent 4') // back on the home screen leaves the app
    await sleep(1500)
    console.log('after back on home:', focusApp().trim())
  }
  console.log('done')
  c.close()
  process.exit(0)
})().catch((e) => {
  console.log('FAILED:', e.stack || e.message)
  shot('99-failure')
  process.exit(1)
})
