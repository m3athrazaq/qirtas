// Non-invasive check of the Supabase setup (no accounts are created).
// Reads the public settings from .env.production and reports what is in place.
const fs = require('node:fs')
const env = Object.fromEntries(
  fs.readFileSync('.env.production', 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
const H = { apikey: KEY, 'content-type': 'application/json' }
const lines = []
const say = (ok, msg) => lines.push(`${ok === null ? '➖' : ok ? '✅' : '❌'} ${msg}`)

;(async () => {
  for (const t of ['workspaces', 'members', 'invites', 'doc_updates', 'ai_usage']) {
    const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, { headers: H })
    const body = await r.text()
    say(r.status === 200, `table ${t}: ${r.status}${r.status === 200 ? '' : ' ' + body.slice(0, 120)}`)
  }
  for (const [fn, args] of [['invite_info', { invite_token: 'x' }], ['create_workspace', { ws: '00000000-0000-0000-0000-000000000000', ws_name: '', my_name: '' }]]) {
    const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
    const body = await r.text()
    // invite_info → 200 []; create_workspace as anon → error "not signed in" (function exists)
    const ok = fn === 'invite_info' ? r.status === 200 : /not signed in/.test(body)
    say(ok, `function ${fn}: ${r.status} ${body.slice(0, 100)}`)
  }
  const s = await fetch(`${URL}/auth/v1/settings`, { headers: H })
  const settings = await s.json().catch(() => ({}))
  say(settings.mailer_autoconfirm === true, `sign-up without email confirmation (mailer_autoconfirm=${settings.mailer_autoconfirm}, disable_signup=${settings.disable_signup})`)
  const b = await fetch(`${URL}/storage/v1/object/list/assets`, { method: 'POST', headers: { ...H, authorization: `Bearer ${KEY}` }, body: JSON.stringify({ prefix: '' }) })
  const bb = await b.text()
  say(b.status === 200, `storage bucket "assets": ${b.status} ${bb.slice(0, 100)}`)
  const f = await fetch(`${URL}/functions/v1/ai`, { method: 'POST', headers: H, body: '{}' })
  const fb = await f.text()
  say(f.status === 404 ? null : true, `assistant function: ${f.status} ${fb.slice(0, 100)}${f.status === 404 ? ' (not deployed — optional)' : ''}`)
  const failed = lines.filter((l) => l.startsWith('❌')).length
  console.log(lines.join('\n'))
  console.log(`::${failed ? 'warning' : 'notice'} title=Supabase setup (${lines.length - failed}/${lines.length})::${lines.join('%0A')}`)
})().catch((e) => {
  console.log(`::error title=Probe failed::${e.message}`)
  process.exit(1)
})
