// Reminders on the emulator, the way they fail on real phones: one due while the app is in the
// background, and one whose alarm Android dropped because the app was stopped (as some phones do
// to closed apps) — opening the app again must set it again. Prints what Android shows.
const { execSync } = require('node:child_process')

const PKG = 'com.m3athrazaq.qirtas'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const adb = (cmd) => execSync(`adb shell ${cmd}`).toString()
const shot = (name) => {
  try {
    execSync(`adb exec-out screencap -p > smoke/${name}.png`)
  } catch (e) {
    console.log('screencap failed', e.message)
  }
}

function client(url) {
  const ws = new WebSocket(url)
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
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
        resolve({ error: { message: `timeout after ${timeout} ms` } })
      }, timeout)
      pending.set(mid, (m) => {
        clearTimeout(t)
        resolve(m)
      })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  return { ready, send, close: () => ws.close() }
}

/** Start (or bring forward) the app and connect to its WebView. */
async function open() {
  adb(`am start -n ${PKG}/.MainActivity`)
  for (let i = 0; i < 40; i++) {
    await sleep(1500)
    let pid = ''
    try {
      pid = adb(`pidof ${PKG}`).trim()
    } catch {
      continue
    }
    if (!pid) continue
    try {
      execSync(`adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`)
      const list = await (await fetch('http://127.0.0.1:9222/json')).json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('https://localhost'))
      if (!page) continue
      const c = client(page.webSocketDebuggerUrl)
      await c.ready
      // The app is up when its plugins answer
      const ok = await evaluate(c, `typeof window.Capacitor?.Plugins?.QirtasNative?.reminderHealth === 'function'`)
      if (ok === true) return c
      c.close()
    } catch {
      /* not ready yet */
    }
  }
  throw new Error('the app did not come up')
}

async function evaluate(c, expression, timeout = 15000) {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout)
  if (r.error) return { error: r.error.message }
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text }
  return r.result?.result?.value
}

const native = (c, call) => evaluate(c, `window.Capacitor.Plugins.QirtasNative.${call}`)

/** Our reminder alarms waiting in Android (the pending list only, not the statistics after it). */
function alarms() {
  const all = adb('dumpsys alarm')
  const cut = all.search(/\n\s*(Alarm Stats|Top Alarms|Past-due non-wakeup alarms|App Alarm history)/)
  return (cut > 0 ? all.slice(0, cut) : all).split('\n').filter((l) => l.includes(`${PKG}.REMINDER`)).length
}

function shown(id) {
  const lines = adb('dumpsys notification --noredact').split('\n')
  return lines.filter((l) => l.includes('NotificationRecord') && l.includes(PKG) && l.includes(`id=${id} `)).map((l) => l.trim().slice(0, 140))
}

async function shade(name) {
  try {
    adb('cmd statusbar expand-notifications')
    await sleep(1500)
    shot(name)
    adb('cmd statusbar collapse')
    await sleep(600)
  } catch (e) {
    console.log('shade failed:', e.message.slice(0, 120))
  }
}

;(async () => {
  let c = await open()
  console.log('health:', JSON.stringify(await native(c, 'reminderHealth()')))

  // 1. Due while the app is in the background
  let now = await evaluate(c, 'Date.now()')
  const at1 = now + 60_000
  console.log('set 1:', JSON.stringify(await native(c, `setReminders({ ws: 'smoke', items: [{ id: 7001, at: ${at1}, title: 'تذكير والتطبيق في الخلفية', body: 'smoke 1', page: '' }] })`)))
  console.log('alarms waiting:', alarms())
  adb('input keyevent 3') // home
  await sleep(75_000)
  const one = shown(7001)
  console.log('1. shown with the app in the background:', one.length ? 'YES ' + one.join(' | ') : 'NO')
  await shade('20-reminder-background')

  // 2. The app is stopped (Android drops its alarms); opening it again sets them again
  c.close()
  c = await open()
  now = await evaluate(c, 'Date.now()')
  const at2 = now + 100_000
  console.log('set 2:', JSON.stringify(await native(c, `setReminders({ ws: 'smoke', items: [{ id: 7002, at: ${at2}, title: 'تذكير بعد إيقاف التطبيق', body: 'smoke 2', page: '' }] })`)))
  console.log('alarms before the stop:', alarms())
  c.close()
  adb(`am force-stop ${PKG}`)
  await sleep(2000)
  console.log('alarms after the stop (dropped):', alarms())
  c = await open()
  await sleep(12_000) // the app reads its pages and hands its reminders over again
  console.log('alarms after opening again:', alarms())
  c.close()
  adb('input keyevent 3') // home
  const left = at2 - Date.now()
  await sleep(Math.max(0, left) + 20_000)
  const two = shown(7002)
  console.log('2. shown after the stop and reopening:', two.length ? 'YES ' + two.join(' | ') : 'NO')
  await shade('21-reminder-after-stop')

  // 3. What Android noted as shown (the app reads this to tell held-back reminders)
  c = await open()
  const log = await native(c, 'reminderLog()')
  const notes = Object.entries(log?.shown ?? {}).filter(([k]) => k.startsWith('7001@') || k.startsWith('7002@'))
  console.log('3. noted as shown:', JSON.stringify(notes.map(([k, v]) => [k.split('@')[0], Math.round((v.t - Number(k.split('@')[1])) / 1000) + 's late', v.r ?? ''])))
  console.log('health after:', JSON.stringify(await native(c, 'reminderHealth()')))

  // 4. The settings: what keeps reminders from arriving, each with its fix
  await evaluate(c, `window.dispatchEvent(new CustomEvent('qirtas:settings', { detail: 'general' }))`)
  await sleep(2000)
  console.log('4. checks in the settings:', JSON.stringify(await evaluate(c, `(() => { const el = document.querySelector('.rem-health'); if (!el) return 'missing'; el.scrollIntoView({ block: 'center' }); return [...el.querySelectorAll('li')].map((li) => li.className + ': ' + li.textContent.trim()) })()`)))
  await sleep(800)
  shot('22-settings-reminders')
  console.log('test in a minute:', await evaluate(c, `(() => { const b = [...document.querySelectorAll('.rem-health button')].find((x) => x.textContent.includes('دقيقة')); if (!b) return 'missing'; b.click(); return 'ok' })()`))
  await sleep(1500)
  shot('23-test-in-a-minute')
  c.close()
  adb('input keyevent 3') // home: the test notification arrives with the app closed
  await sleep(70_000)
  const test = shown(42)
  console.log('5. "test in a minute" with the app closed:', test.length ? 'YES' : 'NO')
  await shade('24-test-notification')
  console.log('done')
  process.exit(0)
})().catch((e) => {
  console.log('FAILED:', e.stack || e.message)
  shot('29-reminders-failure')
  process.exit(1)
})
