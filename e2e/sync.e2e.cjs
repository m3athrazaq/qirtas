// End-to-end check of accounts, sharing, live collaboration and images against the real server.
// Run by .github/workflows/sync-test.yml (manual). Creates two temporary accounts and deletes them at the end.
// Results are printed and also reported as a GitHub annotation.
const { chromium } = require('playwright')

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/'
const RUN = (process.env.GITHUB_RUN_ID || String(Date.now())).slice(-8)
const PASSWORD = 'Qe2e-' + Math.random().toString(36).slice(2, 12) + '!'
const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function report(ok, msg) {
  results.push((ok ? '✅ ' : '❌ ') + msg)
  console.log((ok ? 'PASS  ' : 'FAIL  ') + msg)
  return ok
}

async function until(fn, timeout = 15000, step = 250) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return Date.now() - t0
    } catch {
      /* keep waiting */
    }
    if (Date.now() - t0 > timeout) return -1
    await sleep(step)
  }
}

async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, locale: 'ar-KW', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message.slice(0, 300)}`))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console: ${m.text().slice(0, 300)}`)
  })
  await page.goto(BASE)
  await page.waitForSelector('button.sb-item', { timeout: 20000 })
  await sleep(800)
  return { ctx, page, name }
}

async function openAccount(page) {
  await page.locator('button.sb-item', { hasText: 'الإعدادات' }).click()
  await page.locator('.settings-tabs button', { hasText: 'الحساب' }).click()
  await sleep(300)
}

async function closeModal(page) {
  await page.keyboard.press('Escape')
  await sleep(300)
}

async function signUp(page, name, email) {
  await openAccount(page)
  await page.locator('.auth .seg button', { hasText: 'إنشاء حساب' }).click()
  await page.locator('.auth .field', { hasText: 'الاسم' }).locator('input').fill(name)
  await page.locator('.auth input[type=email]').fill(email)
  await page.locator('.auth input[type=password]').fill(PASSWORD)
  await page.locator('.auth button[type=submit]').click()
  const ms = await until(async () => (await page.locator('.sync-pill').count()) > 0 || (await page.locator('.auth-msg').count()) > 0, 20000)
  const msg = (await page.locator('.auth-msg').count()) ? await page.locator('.auth-msg').innerText() : ''
  return { ok: ms >= 0 && !msg, msg }
}

async function syncedPill(page) {
  return until(async () => (await page.locator('.sync-pill').innerText()).includes('متزامن'), 20000)
}

const editorText = (page) => page.locator('.ProseMirror').first().innerText()

async function appendParagraph(page, text) {
  await page.evaluate((t) => {
    const ed = document.querySelector('.ProseMirror').editor
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: t }] })
  }, text)
}

async function pasteImage(page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 40
    const g = c.getContext('2d')
    g.fillStyle = '#2a47a8'
    g.fillRect(0, 0, 64, 40)
    g.fillStyle = '#c9473c'
    g.fillRect(8, 8, 20, 20)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const file = new File([blob], 'e2e.png', { type: 'image/png' })
    const el = document.querySelector('.ProseMirror')
    const ed = el.editor
    ed.commands.focus('end')
    const dt = new DataTransfer()
    dt.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
}

async function deleteAccount(page) {
  await openAccount(page)
  await page.locator('.danger-zone button', { hasText: 'حذف حسابي' }).click()
  await page.locator('#dialog-input').fill('حذف')
  await page.locator('.dialog button[type=submit]').click()
  return until(async () => (await page.locator('.auth').count()) > 0 || (await page.locator('.sync-pill').count()) === 0, 20000)
}

;(async () => {
  const browser = await chromium.launch()
  const A = await device(browser, 'A')
  const B = await device(browser, 'B')
  const title = `صفحة اختبار ${RUN}`
  let aSigned = false
  let bSigned = false
  try {
    // A writes locally, then creates an account: the notes go up with it
    await A.page.locator('button.sb-item', { hasText: 'صفحة جديدة' }).click()
    await sleep(600)
    await A.page.keyboard.type(title)
    await A.page.keyboard.press('Enter')
    await sleep(400)
    await A.page.keyboard.type('سطر كتبه أ قبل إنشاء الحساب')
    await sleep(1200)
    const sa = await signUp(A.page, 'مختبر أ', `qirtas.e2e.a.${RUN}@example.com`)
    aSigned = sa.ok
    if (!report(sa.ok, `A creates an account${sa.msg ? ': ' + sa.msg : ''}`)) throw new Error('sign-up failed')
    report((await syncedPill(A.page)) >= 0, 'A is synced after sign-up')
    await closeModal(A.page)

    // A invites B as an editor
    await A.page.locator('button', { hasText: 'مشاركة' }).first().click()
    await sleep(800)
    await A.page.locator('.share select').first().selectOption('editor')
    await A.page.locator('.share button', { hasText: 'إنشاء رابط' }).click()
    let link = ''
    await until(async () => (link = await A.page.evaluate(() => navigator.clipboard.readText())).includes('join'), 8000)
    const token = link.match(/join\/([A-Za-z0-9]+)/)?.[1]
    if (!report(!!token, 'A creates an invite link')) throw new Error('no invite')
    await closeModal(A.page)

    // B creates an account and accepts
    const sb = await signUp(B.page, 'مختبر ب', `qirtas.e2e.b.${RUN}@example.com`)
    bSigned = sb.ok
    if (!report(sb.ok, `B creates an account${sb.msg ? ': ' + sb.msg : ''}`)) throw new Error('sign-up failed')
    await closeModal(B.page)
    await B.page.goto(BASE + '#/join/' + token)
    await B.page.locator('.modal button', { hasText: 'انضمام' }).click({ timeout: 15000 })
    await B.page.waitForEvent('load', { timeout: 20000 }).catch(() => {})
    const seen = await until(async () => (await B.page.getByText(title).count()) > 0, 20000)
    if (!report(seen >= 0, `B joins and sees A's page (${seen} ms)`)) throw new Error('join failed')

    // Both open the page
    await A.page.getByText(title).first().click()
    await B.page.getByText(title).first().click()
    await sleep(1500)
    report((await editorText(B.page)).includes('سطر كتبه أ'), "B sees A's text")

    // Live: A → B and B → A without reloading
    await appendParagraph(A.page, 'نص مباشر من أ')
    const ab = await until(async () => (await editorText(B.page)).includes('نص مباشر من أ'), 30000)
    report(ab >= 0 && ab < 8000, `live edit A → B (${ab} ms)`)
    await appendParagraph(B.page, 'رد مباشر من ب')
    const ba = await until(async () => (await editorText(A.page)).includes('رد مباشر من ب'), 30000)
    report(ba >= 0 && ba < 8000, `live edit B → A (${ba} ms)`)

    // Presence: A sees B on the same page
    const pr = await until(async () => (await A.page.locator('.presence-avatar').count()) > 0, 15000)
    report(pr >= 0, `A sees B's avatar on the page (${pr} ms)`)

    // A new page appears in B's sidebar
    await A.page.locator('button.sb-item', { hasText: 'صفحة جديدة' }).click()
    await sleep(500)
    await A.page.keyboard.type(`صفحة ثانية ${RUN}`)
    await sleep(800)
    const np = await until(async () => (await B.page.getByText(`صفحة ثانية ${RUN}`).count()) > 0, 30000)
    report(np >= 0 && np < 10000, `new page shows up for B (${np} ms)`)

    // Image: A pastes one, B gets it from storage
    await A.page.getByText(title).first().click()
    await sleep(1000)
    await pasteImage(A.page)
    const up = await until(async () => (await A.page.locator('.ProseMirror img').count()) > 0, 10000)
    report(up >= 0, 'A pastes an image')
    const img = await until(
      async () => B.page.evaluate(() => { const i = document.querySelector('.ProseMirror img'); return !!i && i.complete && i.naturalWidth > 0 }),
      30000,
    )
    report(img >= 0, `B sees the image (${img} ms)`)

    // Viewer: A makes B view-only; after reloading B can't edit
    await A.page.locator('button', { hasText: 'مشاركة' }).first().click()
    await sleep(1200)
    const bRow = A.page.locator('.share-item', { hasText: 'مختبر ب' })
    await bRow.locator('select').selectOption('viewer')
    await sleep(500)
    await closeModal(A.page)
    const liveRo = await until(async () => (await B.page.locator('.ProseMirror').first().getAttribute('contenteditable')) === 'false', 12000)
    report(liveRo >= 0, `B becomes view-only without reloading (${liveRo} ms)`)
    await B.page.reload()
    await B.page.waitForSelector('button.sb-item', { timeout: 20000 })
    await sleep(2500)
    await B.page.getByText(title).first().click()
    await sleep(1500)
    const editable = await B.page.locator('.ProseMirror').first().getAttribute('contenteditable')
    report(editable === 'false', `viewer can't edit (contenteditable=${editable})`)
  } catch (e) {
    report(false, 'stopped: ' + e.message)
    await A.page.screenshot({ path: 'e2e-a.png' }).catch(() => {})
    await B.page.screenshot({ path: 'e2e-b.png' }).catch(() => {})
  } finally {
    // Clean up the temporary accounts
    for (const [d, signed] of [[B, bSigned], [A, aSigned]]) {
      if (!signed) continue
      try {
        await d.page.goto(BASE)
        await d.page.waitForSelector('button.sb-item', { timeout: 20000 })
        await sleep(1500)
        const gone = await deleteAccount(d.page)
        report(gone >= 0, `${d.name}'s test account deleted`)
      } catch (e) {
        report(false, `${d.name}'s test account not deleted: ${e.message}`)
      }
    }
    await browser.close()
    const failed = results.filter((r) => r.startsWith('❌')).length
    const summary = results.join('%0A')
    console.log(`::${failed ? 'error' : 'notice'} title=Sync test (${results.length - failed}/${results.length})::${summary}`)
    process.exit(failed ? 1 : 0)
  }
})()
