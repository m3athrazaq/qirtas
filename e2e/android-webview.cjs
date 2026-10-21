// Drives the app's WebView inside the emulator (debug build) and takes native screenshots.
const { chromium } = require('playwright')
const { execSync } = require('node:child_process')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (name) => execSync(`adb exec-out screencap -p > smoke/${name}.png`)
const adb = (cmd) => execSync(`adb shell ${cmd}`)

;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page', { timeout: 15000 }))
  await page.waitForSelector('button.sb-item', { timeout: 30000 })
  page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text().slice(0, 300)}`))
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))
  console.log('url:', page.url())
  const info = await page.evaluate(() => ({
    ua: navigator.userAgent,
    w: innerWidth,
    h: innerHeight,
    dpr: devicePixelRatio,
    safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
    safeEnvTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top'),
    items: [...document.querySelectorAll('button.sb-item')].map((b) => b.textContent.trim()),
    fab: !!document.querySelector('.fab'),
  }))
  console.log('info:', JSON.stringify(info))

  // New page from the round button, type a title and a line
  await page.locator('.fab').click()
  await sleep(1500)
  await page.keyboard.type('تجربة على الجوال')
  await page.keyboard.press('Enter')
  await sleep(500)
  await page.keyboard.type('سطر عربي ثم English line')
  await sleep(1200)
  shot('02-page')

  // Slash menu
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await sleep(1200)
  shot('03-slash')
  await page.keyboard.type('مهام')
  await sleep(600)
  await page.keyboard.press('Enter')
  await page.keyboard.type('مهمة أولى')
  await sleep(800)
  // hide the keyboard and go back home with the system back button
  adb('input keyevent 111')
  await sleep(600)
  shot('04-tasks')
  adb('input keyevent 4')
  await sleep(1500)
  shot('05-home')

  // Templates → Ramadan
  const tpl = page.locator('button.sb-item', { hasText: 'القوالب' })
  if (await tpl.count()) {
    await tpl.first().click()
    await sleep(1200)
    shot('06-templates')
    const ram = page.getByText('رمضان').first()
    if (await ram.count()) {
      await ram.click()
      await sleep(800)
      const use = page.locator('.modal button.btn-primary').last()
      if (await use.count()) await use.click()
      await sleep(2500)
      shot('07-ramadan')
    }
  }

  // Dark mode screenshot of the same page
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await sleep(600)
  shot('08-dark')
  console.log('done')
  await browser.close()
})().catch((e) => {
  console.log('FAILED:', e.stack || e.message)
  try { shot('99-failure') } catch {}
  process.exit(1)
})
