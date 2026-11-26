// Qirtas sync server: Cloudflare Pages Functions with a D1 database (binding DB).
// It runs on Cloudflare's free plan and, unlike a free database server, is never paused for being
// idle, so devices left unused for weeks pick up where they stopped.
//
// Accounts have no e-mail or password. A device joins an account with a one-time link code made on
// another of its devices (or with the account's recovery key) and keeps a token that doesn't expire
// until the device is removed. Each workspace keeps the update log of its documents (Yjs updates):
// devices push their changes, pull what they lack, and wait on /wait for the next change.
//
// The database creates its own tables on first use. Limits on the free plan (per day): 100,000
// requests, 5 million rows read, 100,000 rows written; 500 MB per database.

// ---------------------------------------------------------------- types (Cloudflare runtime)

interface D1Meta {
  changes: number
  last_row_id: number
}
interface D1Result<T> {
  results: T[]
  meta: D1Meta
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<D1Result<unknown>>
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>
  exec(sql: string): Promise<unknown>
}
interface Env {
  DB: D1Database
  /** For the writing assistant (optional): set in the Pages project's settings as a secret. */
  ANTHROPIC_API_KEY?: string
  AI_MONTHLY_LIMIT?: string
}
interface Ctx {
  request: Request
  env: Env
  params: { path?: string | string[] }
  waitUntil(p: Promise<unknown>): void
}

type Role = 'owner' | 'editor' | 'viewer'

// ---------------------------------------------------------------- the tables

// One statement per line (D1's exec runs one per line). Every one checks before it creates.
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT \'\', recovery TEXT, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, account_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS devices_account ON devices (account_id)',
  'CREATE TABLE IF NOT EXISTS link_codes (code TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT \'\', owner_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS members (workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT, joined_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, account_id))',
  'CREATE INDEX IF NOT EXISTS members_account ON members (account_id)',
  'CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, role TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS invites_ws ON invites (workspace_id)',
  'CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, doc_id TEXT NOT NULL, client_id TEXT, data BLOB, blob TEXT, created_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS updates_ws ON updates (workspace_id, id)',
  'CREATE INDEX IF NOT EXISTS updates_doc ON updates (workspace_id, doc_id, id)',
  'CREATE TABLE IF NOT EXISTS blobs (id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, n))',
  'CREATE TABLE IF NOT EXISTS assets (workspace_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, blob TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, id))',
  'CREATE TABLE IF NOT EXISTS presence (workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, account_id TEXT NOT NULL, name TEXT, page_id TEXT, color TEXT, at INTEGER NOT NULL, PRIMARY KEY (workspace_id, client_id))',
  'CREATE TABLE IF NOT EXISTS ai_usage (account_id TEXT NOT NULL, month TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, month))',
  'CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL)',
].join('\n')

let schemaReady: Promise<unknown> | null = null
function ensureSchema(db: D1Database) {
  schemaReady ??= db.exec(SCHEMA).catch((err) => {
    schemaReady = null
    throw err
  })
  return schemaReady
}

// ---------------------------------------------------------------- limits

const LINK_CODE_MINUTES = 10
const INVITE_DAYS = 7
/** Stored pieces of a large update or picture (a D1 row holds at most 2 MB). */
const PIECE = 900_000
const MAX_PUSH_ROWS = 20
const MAX_PUSH_BYTES = 24_000_000
const MAX_ASSET_BYTES = 10 * 1024 * 1024
const PULL_ROWS = 500
const PULL_BYTES = 6_000_000
const WAIT_MS = 25_000
const WAIT_STEP = 1_500
const PRESENCE_MS = 60_000

// ---------------------------------------------------------------- helpers

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-max-age': '86400',
}

class Fail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

const now = () => Date.now()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Letters and digits that can't be confused when read aloud or typed (no 0/O, 1/I/L). */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let s = ''
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return s
}
/** A code or key as typed or pasted: Arabic and Persian digits as Latin ones, letters and digits only. */
const normalizeCode = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
/** Recovery keys are 25 characters (link codes 8). */
const RECOVERY_LENGTH = 25

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromB64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Bytes as D1 takes them for a BLOB: an ArrayBuffer of exactly these bytes. */
function blobOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function asBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (Array.isArray(v)) return new Uint8Array(v as number[])
  return new Uint8Array(0)
}

async function readJson<T>(req: Request, max = 1_000_000): Promise<T> {
  const text = await req.text()
  if (text.length > max) throw new Fail(413, 'too_large')
  try {
    return JSON.parse(text || '{}') as T
  } catch {
    throw new Fail(400, 'bad_request')
  }
}

const isWsId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const isDocId = (s: string) => typeof s === 'string' && s.length <= 200 && /^(ws|pg):[\w.:-]+$/.test(s)
const isAssetId = (s: string) => /^[\w-]{4,80}$/.test(s)
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')

// ---------------------------------------------------------------- blobs (large updates, pictures)

/** Store bytes in pieces; returns the blob's id. */
function blobStatements(db: D1Database, id: string, bytes: Uint8Array): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = []
  for (let n = 0, at = 0; at < bytes.length || n === 0; n++, at += PIECE) {
    out.push(db.prepare('INSERT INTO blobs (id, n, data) VALUES (?, ?, ?)').bind(id, n, blobOf(bytes.subarray(at, at + PIECE))))
  }
  return out
}

async function readBlob(db: D1Database, id: string): Promise<Uint8Array> {
  const { results } = await db.prepare('SELECT data FROM blobs WHERE id = ? ORDER BY n').bind(id).all<{ data: unknown }>()
  const parts = results.map((r) => asBytes(r.data))
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// ---------------------------------------------------------------- who is asking

interface Caller {
  account: string
  device: string
}

async function caller(ctx: Ctx): Promise<Caller> {
  const m = /^Bearer\s+([\w-]{20,200})$/.exec(ctx.request.headers.get('authorization') ?? '')
  if (!m) throw new Fail(401, 'unauthorized')
  const device = await sha256(m[1])
  const row = await ctx.env.DB.prepare('SELECT account_id, seen_at FROM devices WHERE token = ?').bind(device).first<{ account_id: string; seen_at: number }>()
  if (!row) throw new Fail(401, 'unauthorized')
  // When the device was last seen (at most once an hour, to save writes)
  if (now() - row.seen_at > 3_600_000) ctx.waitUntil(ctx.env.DB.prepare('UPDATE devices SET seen_at = ? WHERE token = ?').bind(now(), device).run())
  return { account: row.account_id, device }
}

async function roleIn(db: D1Database, ws: string, account: string): Promise<Role | null> {
  const row = await db.prepare('SELECT role FROM members WHERE workspace_id = ? AND account_id = ?').bind(ws, account).first<{ role: Role }>()
  return row?.role ?? null
}

async function needRole(db: D1Database, ws: string, account: string, allowed: Role[]): Promise<Role> {
  if (!isWsId(ws)) throw new Fail(400, 'bad_request')
  const role = await roleIn(db, ws, account)
  if (!role) throw new Fail(404, 'not_member')
  if (!allowed.includes(role)) throw new Fail(403, 'forbidden')
  return role
}

/** Slows down guessing (link codes, recovery keys) and mass sign-ups from one address. */
async function throttle(ctx: Ctx, kind: string, max: number, windowMs: number, count: boolean) {
  const ip = ctx.request.headers.get('cf-connecting-ip') ?? 'unknown'
  const key = `${kind}:${ip}`
  const db = ctx.env.DB
  const row = await db.prepare('SELECT count, until FROM throttle WHERE key = ?').bind(key).first<{ count: number; until: number }>()
  const live = row && row.until > now()
  if (live && row.count >= max) throw new Fail(429, 'rate')
  if (!count) return
  if (live) await db.prepare('UPDATE throttle SET count = count + 1 WHERE key = ?').bind(key).run()
  else await db.prepare('INSERT OR REPLACE INTO throttle (key, count, until) VALUES (?, 1, ?)').bind(key, now() + windowMs).run()
}

async function newDevice(db: D1Database, account: string, label: unknown): Promise<string> {
  const token = randomToken()
  await db
    .prepare('INSERT INTO devices (token, account_id, label, created_at, seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), account, clip(label, 80), now(), now())
    .run()
  return token
}

async function accountInfo(db: D1Database, account: string) {
  return db.prepare('SELECT id, name, created_at FROM accounts WHERE id = ?').bind(account).first<{ id: string; name: string; created_at: number }>()
}

function bump(db: D1Database, ws: string) {
  return db.prepare('UPDATE workspaces SET version = version + 1 WHERE id = ?').bind(ws)
}

// ---------------------------------------------------------------- accounts and devices

/** A new account, with this device in it. The recovery key is shown once. */
async function createAccount(ctx: Ctx) {
  await throttle(ctx, 'signup', 20, 3_600_000, true)
  const body = await readJson<{ name?: string; label?: string }>(ctx.request)
  const db = ctx.env.DB
  const id = crypto.randomUUID()
  const recovery = randomCode(25)
  await db.prepare('INSERT INTO accounts (id, name, recovery, created_at) VALUES (?, ?, ?, ?)').bind(id, clip(body.name, 80), await sha256(recovery), now()).run()
  const token = await newDevice(db, id, body.label)
  return json({ token, account: await accountInfo(db, id), recovery })
}

async function getAccount(ctx: Ctx, me: Caller) {
  const db = ctx.env.DB
  const account = await accountInfo(db, me.account)
  if (!account) throw new Fail(401, 'unauthorized')
  const { results } = await db
    .prepare('SELECT token, label, created_at, seen_at FROM devices WHERE account_id = ? ORDER BY created_at')
    .bind(me.account)
    .all<{ token: string; label: string; created_at: number; seen_at: number }>()
  const devices = results.map((d) => ({ id: d.token.slice(0, 16), label: d.label, created_at: d.created_at, seen_at: d.seen_at, current: d.token === me.device }))
  return json({ account, devices })
}

async function renameAccount(ctx: Ctx, me: Caller) {
  const body = await readJson<{ name?: string }>(ctx.request)
  const name = clip(body.name, 80)
  const db = ctx.env.DB
  await db.batch([
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(name, me.account),
    db.prepare('UPDATE members SET name = ? WHERE account_id = ?').bind(name, me.account),
  ])
  return json({ ok: true })
}

/** A one-time code (valid a few minutes) that links another device to this account. */
async function makeLinkCode(ctx: Ctx, me: Caller) {
  const db = ctx.env.DB
  const code = randomCode(8)
  const expires = now() + LINK_CODE_MINUTES * 60_000
  await db.batch([
    db.prepare('DELETE FROM link_codes WHERE expires_at < ?').bind(now()),
    db.prepare('INSERT INTO link_codes (code, account_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(code), me.account, expires),
  ])
  return json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expires_at: expires })
}

async function claimLinkCode(ctx: Ctx) {
  await throttle(ctx, 'link', 30, 3_600_000, false)
  const body = await readJson<{ code?: string; label?: string }>(ctx.request)
  const db = ctx.env.DB
  const code = normalizeCode(String(body.code ?? ''))
  // The recovery key typed where the code goes (it is the one shown with a copy button): it links too
  if (code.length === RECOVERY_LENGTH) return linkByKey(ctx, code, body.label)
  const hash = await sha256(code)
  const row = await db.prepare('SELECT account_id, expires_at FROM link_codes WHERE code = ?').bind(hash).first<{ account_id: string; expires_at: number }>()
  if (!row || row.expires_at < now()) {
    await throttle(ctx, 'link', 30, 3_600_000, true)
    throw new Fail(400, row ? 'code_expired' : 'bad_code')
  }
  // One device per code
  const { meta } = await db.prepare('DELETE FROM link_codes WHERE code = ?').bind(hash).run()
  if (!meta.changes) throw new Fail(400, 'bad_code')
  const token = await newDevice(db, row.account_id, body.label)
  return json({ token, account: await accountInfo(db, row.account_id) })
}

async function recover(ctx: Ctx) {
  const body = await readJson<{ key?: string; label?: string }>(ctx.request)
  return linkByKey(ctx, normalizeCode(String(body.key ?? '')), body.label)
}

async function linkByKey(ctx: Ctx, key: string, label: unknown) {
  await throttle(ctx, 'recover', 20, 3_600_000, false)
  const db = ctx.env.DB
  const row = await db.prepare('SELECT id FROM accounts WHERE recovery = ?').bind(await sha256(key)).first<{ id: string }>()
  if (!row) {
    await throttle(ctx, 'recover', 20, 3_600_000, true)
    throw new Fail(400, 'bad_key')
  }
  const token = await newDevice(db, row.id, label)
  return json({ token, account: await accountInfo(db, row.id) })
}

/** A new recovery key; the old one stops working. */
async function newRecoveryKey(ctx: Ctx, me: Caller) {
  const recovery = randomCode(25)
  await ctx.env.DB.prepare('UPDATE accounts SET recovery = ? WHERE id = ?').bind(await sha256(recovery), me.account).run()
  return json({ recovery })
}

async function removeDevice(ctx: Ctx, me: Caller, id: string) {
  const { meta } = await ctx.env.DB.prepare('DELETE FROM devices WHERE account_id = ? AND substr(token, 1, 16) = ?').bind(me.account, id).run()
  return json({ ok: meta.changes > 0 })
}

async function signOut(ctx: Ctx, me: Caller) {
  await ctx.env.DB.prepare('DELETE FROM devices WHERE token = ?').bind(me.device).run()
  return json({ ok: true })
}

/** Everything the account owns, and the account itself. */
async function deleteAccount(ctx: Ctx, me: Caller) {
  const db = ctx.env.DB
  const owned = 'SELECT id FROM workspaces WHERE owner_id = ?'
  await db.batch([
    db.prepare(`DELETE FROM blobs WHERE id IN (SELECT blob FROM updates WHERE blob IS NOT NULL AND workspace_id IN (${owned}))`).bind(me.account),
    db.prepare(`DELETE FROM blobs WHERE id IN (SELECT blob FROM assets WHERE workspace_id IN (${owned}))`).bind(me.account),
    db.prepare(`DELETE FROM updates WHERE workspace_id IN (${owned})`).bind(me.account),
    db.prepare(`DELETE FROM assets WHERE workspace_id IN (${owned})`).bind(me.account),
    db.prepare(`DELETE FROM invites WHERE workspace_id IN (${owned})`).bind(me.account),
    db.prepare(`DELETE FROM presence WHERE workspace_id IN (${owned})`).bind(me.account),
    db.prepare(`DELETE FROM members WHERE workspace_id IN (${owned})`).bind(me.account),
    db.prepare('DELETE FROM workspaces WHERE owner_id = ?').bind(me.account),
    db.prepare('UPDATE workspaces SET version = version + 1 WHERE id IN (SELECT workspace_id FROM members WHERE account_id = ?)').bind(me.account),
    db.prepare('DELETE FROM members WHERE account_id = ?').bind(me.account),
    db.prepare('DELETE FROM devices WHERE account_id = ?').bind(me.account),
    db.prepare('DELETE FROM link_codes WHERE account_id = ?').bind(me.account),
    db.prepare('DELETE FROM ai_usage WHERE account_id = ?').bind(me.account),
    db.prepare('DELETE FROM accounts WHERE id = ?').bind(me.account),
  ])
  return json({ ok: true })
}

// ---------------------------------------------------------------- workspaces, members, invitations

async function listWorkspaces(ctx: Ctx, me: Caller) {
  const { results } = await ctx.env.DB.prepare('SELECT w.id, w.name, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.account_id = ? ORDER BY m.joined_at')
    .bind(me.account)
    .all<{ id: string; name: string; role: Role }>()
  return json({ workspaces: results })
}

/** Register a workspace (this device's): created if new, joined again if this account owns it. */
async function createWorkspace(ctx: Ctx, me: Caller) {
  const body = await readJson<{ id?: string; name?: string; my_name?: string }>(ctx.request)
  const id = String(body.id ?? '')
  if (!isWsId(id)) throw new Fail(400, 'bad_request')
  const db = ctx.env.DB
  const t = now()
  await db.prepare('INSERT OR IGNORE INTO workspaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').bind(id, clip(body.name, 120), me.account, t).run()
  const ws = await db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').bind(id).first<{ owner_id: string }>()
  if (ws?.owner_id !== me.account) {
    // Someone else's workspace: only its members get in
    const role = await roleIn(db, id, me.account)
    if (!role) throw new Fail(403, 'forbidden')
    return json({ role })
  }
  await db.prepare('INSERT OR IGNORE INTO members (workspace_id, account_id, role, name, joined_at) VALUES (?, ?, \'owner\', ?, ?)').bind(id, me.account, clip(body.my_name, 80), t).run()
  return json({ role: 'owner' })
}

async function renameWorkspace(ctx: Ctx, me: Caller, ws: string) {
  await needRole(ctx.env.DB, ws, me.account, ['owner'])
  const body = await readJson<{ name?: string }>(ctx.request)
  await ctx.env.DB.prepare('UPDATE workspaces SET name = ? WHERE id = ?').bind(clip(body.name, 120), ws).run()
  return json({ ok: true })
}

async function listMembers(ctx: Ctx, me: Caller, ws: string) {
  await needRole(ctx.env.DB, ws, me.account, ['owner', 'editor', 'viewer'])
  const { results } = await ctx.env.DB.prepare('SELECT m.account_id AS user_id, m.role, COALESCE(NULLIF(m.name, \'\'), a.name) AS display_name FROM members m LEFT JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = ? ORDER BY m.joined_at')
    .bind(ws)
    .all()
  return json({ members: results.map((m) => ({ ...m, email: null })) })
}

async function setMemberRole(ctx: Ctx, me: Caller, ws: string, account: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner'])
  const body = await readJson<{ role?: string }>(ctx.request)
  if (body.role !== 'editor' && body.role !== 'viewer') throw new Fail(400, 'bad_request')
  const [res] = await db.batch([db.prepare('UPDATE members SET role = ? WHERE workspace_id = ? AND account_id = ? AND role <> \'owner\'').bind(body.role, ws, account), bump(db, ws)])
  return json({ ok: res.meta.changes > 0 })
}

/** The owner removes someone (their invitation links stop working too), or someone leaves. */
async function removeMember(ctx: Ctx, me: Caller, ws: string, account: string) {
  const db = ctx.env.DB
  const role = await needRole(db, ws, me.account, ['owner', 'editor', 'viewer'])
  const self = account === me.account
  if (!self && role !== 'owner') throw new Fail(403, 'forbidden')
  const statements = [db.prepare('DELETE FROM members WHERE workspace_id = ? AND account_id = ? AND role <> \'owner\'').bind(ws, account), bump(db, ws)]
  // Invitation links work for anyone who has them: a removed member could rejoin with an old one
  if (!self) statements.push(db.prepare('UPDATE invites SET revoked = 1 WHERE workspace_id = ?').bind(ws))
  const [res] = await db.batch(statements)
  return json({ ok: res.meta.changes > 0 })
}

async function createInvite(ctx: Ctx, me: Caller, ws: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner'])
  const body = await readJson<{ role?: string }>(ctx.request)
  if (body.role !== 'editor' && body.role !== 'viewer') throw new Fail(400, 'bad_request')
  const token = randomToken(18)
  const t = now()
  await db.prepare('INSERT INTO invites (token, workspace_id, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(token, ws, body.role, me.account, t, t + INVITE_DAYS * 86_400_000)
    .run()
  return json({ token })
}

async function listInvites(ctx: Ctx, me: Caller, ws: string) {
  await needRole(ctx.env.DB, ws, me.account, ['owner'])
  const { results } = await ctx.env.DB.prepare('SELECT token, role, created_at, expires_at FROM invites WHERE workspace_id = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC')
    .bind(ws, now())
    .all<{ token: string; role: string; created_at: number; expires_at: number }>()
  return json({ invites: results.map((i) => ({ ...i, created_at: new Date(i.created_at).toISOString(), expires_at: new Date(i.expires_at).toISOString() })) })
}

async function revokeInvite(ctx: Ctx, me: Caller, token: string) {
  const db = ctx.env.DB
  const inv = await db.prepare('SELECT workspace_id FROM invites WHERE token = ?').bind(token).first<{ workspace_id: string }>()
  if (!inv) return json({ ok: false })
  await needRole(db, inv.workspace_id, me.account, ['owner'])
  await db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').bind(token).run()
  return json({ ok: true })
}

/** What an invitation is for (shown before joining; needs no account). */
async function inviteInfo(ctx: Ctx, token: string) {
  const row = await ctx.env.DB.prepare('SELECT w.id AS workspace_id, w.name, i.role FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ? AND i.revoked = 0 AND i.expires_at > ?')
    .bind(token, now())
    .first()
  return json({ invite: row ?? null })
}

async function acceptInvite(ctx: Ctx, me: Caller, token: string) {
  const db = ctx.env.DB
  const body = await readJson<{ name?: string }>(ctx.request)
  const inv = await db.prepare('SELECT workspace_id, role FROM invites WHERE token = ? AND revoked = 0 AND expires_at > ?').bind(token, now()).first<{ workspace_id: string; role: Role }>()
  if (!inv) throw new Fail(400, 'bad_invite')
  const name = clip(body.name, 80) || ((await accountInfo(db, me.account))?.name ?? '')
  // An owner who follows their own link stays the owner
  await db.batch([
    db.prepare('INSERT INTO members (workspace_id, account_id, role, name, joined_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (workspace_id, account_id) DO UPDATE SET role = CASE WHEN members.role = \'owner\' THEN \'owner\' ELSE excluded.role END, name = COALESCE(NULLIF(excluded.name, \'\'), members.name)')
      .bind(inv.workspace_id, me.account, inv.role, name, now()),
    bump(db, inv.workspace_id),
  ])
  return json({ workspace_id: inv.workspace_id })
}

// ---------------------------------------------------------------- the update log

interface OutRow {
  id: number
  doc_id: string
  client_id: string | null
  data: string
}

async function pushUpdates(ctx: Ctx, me: Caller, ws: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner', 'editor'])
  const body = await readJson<{ rows?: { doc?: string; data?: string; client?: string }[] }>(ctx.request, MAX_PUSH_BYTES * 1.4)
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return json({ ids: [] })
  if (rows.length > MAX_PUSH_ROWS) throw new Fail(413, 'too_large')
  const t = now()
  const blobs: D1PreparedStatement[] = []
  const inserts: D1PreparedStatement[] = []
  for (const r of rows) {
    if (!isDocId(String(r.doc)) || typeof r.data !== 'string') throw new Fail(400, 'bad_request')
    const bytes = fromB64(r.data)
    const client = clip(r.client, 40) || null
    if (bytes.length > PIECE) {
      // A large one is stored in pieces first, so a pull never meets its row without them
      const id = randomToken(12)
      blobs.push(...blobStatements(db, id, bytes))
      inserts.push(db.prepare('INSERT INTO updates (workspace_id, doc_id, client_id, data, blob, created_at) VALUES (?, ?, ?, NULL, ?, ?)').bind(ws, r.doc, client, id, t))
    } else {
      inserts.push(db.prepare('INSERT INTO updates (workspace_id, doc_id, client_id, data, blob, created_at) VALUES (?, ?, ?, ?, NULL, ?)').bind(ws, r.doc, client, blobOf(bytes), t))
    }
  }
  for (let i = 0; i < blobs.length; i += 20) await db.batch(blobs.slice(i, i + 20))
  const results = await db.batch(inserts)
  return json({ ids: results.map((r) => r.meta.last_row_id) })
}

async function toOut(db: D1Database, rows: { id: number; doc_id: string; client_id: string | null; data: unknown; blob: string | null }[]): Promise<OutRow[]> {
  const out: OutRow[] = []
  for (const r of rows) out.push({ id: r.id, doc_id: r.doc_id, client_id: r.client_id, data: toB64(r.blob ? await readBlob(db, r.blob) : asBytes(r.data)) })
  return out
}

/** Rows after a bookmark (the whole workspace, or one document), at most a few megabytes at a time. */
async function pullUpdates(ctx: Ctx, me: Caller, ws: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner', 'editor', 'viewer'])
  const url = new URL(ctx.request.url)
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
  const doc = url.searchParams.get('doc')
  const limit = Math.min(PULL_ROWS, Math.max(1, Number(url.searchParams.get('limit')) || PULL_ROWS))
  const stmt = doc
    ? db.prepare('SELECT id, doc_id, client_id, data, blob FROM updates WHERE workspace_id = ? AND doc_id = ? AND id > ? ORDER BY id LIMIT ?').bind(ws, doc, after, limit)
    : db.prepare('SELECT id, doc_id, client_id, data, blob FROM updates WHERE workspace_id = ? AND id > ? ORDER BY id LIMIT ?').bind(ws, after, limit)
  const { results } = await stmt.all<{ id: number; doc_id: string; client_id: string | null; data: unknown; blob: string | null }>()
  // Stop at a few megabytes; the device asks again from where this ends
  let bytes = 0
  let cut = results.length
  for (let i = 0; i < results.length; i++) {
    bytes += results[i].blob ? PIECE : asBytes(results[i].data).length
    if (bytes > PULL_BYTES && i > 0) {
      cut = i
      break
    }
  }
  const rows = await toOut(db, results.slice(0, cut))
  return json({ rows, more: cut < results.length || results.length === limit })
}

/** Replace a document's history with one merged update (keeps downloads small). */
async function compact(ctx: Ctx, me: Caller, ws: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner', 'editor'])
  const body = await readJson<{ doc?: string; upto?: number; merged?: string }>(ctx.request, MAX_PUSH_BYTES * 1.4)
  const doc = String(body.doc ?? '')
  const upto = Number(body.upto)
  if (!isDocId(doc) || !Number.isFinite(upto) || typeof body.merged !== 'string') throw new Fail(400, 'bad_request')
  const bytes = fromB64(body.merged)
  const t = now()
  const statements: D1PreparedStatement[] = []
  let blob: string | null = null
  if (bytes.length > PIECE) {
    blob = randomToken(12)
    const pieces = blobStatements(db, blob, bytes)
    for (let i = 0; i < pieces.length; i += 20) await db.batch(pieces.slice(i, i + 20))
  }
  statements.push(
    db.prepare('INSERT INTO updates (workspace_id, doc_id, client_id, data, blob, created_at) VALUES (?, ?, \'compact\', ?, ?, ?)').bind(ws, doc, blob ? null : blobOf(bytes), blob, t),
    db.prepare('DELETE FROM blobs WHERE id IN (SELECT blob FROM updates WHERE workspace_id = ? AND doc_id = ? AND id <= ? AND blob IS NOT NULL)').bind(ws, doc, upto),
    db.prepare('DELETE FROM updates WHERE workspace_id = ? AND doc_id = ? AND id <= ?').bind(ws, doc, upto),
  )
  await db.batch(statements)
  return json({ ok: true })
}

/** Wait (up to ~25 s) until the workspace has something newer than `after` or its members change. */
async function waitForChange(ctx: Ctx, me: Caller, ws: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner', 'editor', 'viewer'])
  const url = new URL(ctx.request.url)
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
  const version = Number(url.searchParams.get('v') ?? -1)
  const client = clip(url.searchParams.get('client'), 40)
  const t0 = now()
  if (client) {
    await db.prepare('INSERT OR REPLACE INTO presence (workspace_id, client_id, account_id, name, page_id, color, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(ws, client, me.account, clip(url.searchParams.get('name'), 80), clip(url.searchParams.get('page'), 120) || null, clip(url.searchParams.get('color'), 20), t0)
      .run()
  }
  const check = db.prepare('SELECT (SELECT MAX(id) FROM updates WHERE workspace_id = ?1) AS latest, version FROM workspaces WHERE id = ?1').bind(ws)
  let state = await check.first<{ latest: number | null; version: number }>()
  while (state && (state.latest ?? 0) <= after && state.version === version && now() - t0 < WAIT_MS) {
    await new Promise((r) => setTimeout(r, WAIT_STEP))
    state = await check.first<{ latest: number | null; version: number }>()
  }
  if (!state) throw new Fail(404, 'not_member')
  const { results: presence } = await db
    .prepare('SELECT client_id, account_id AS user_id, name, page_id, color FROM presence WHERE workspace_id = ? AND at > ?')
    .bind(ws, now() - PRESENCE_MS)
    .all()
  if (Math.random() < 0.02) ctx.waitUntil(db.prepare('DELETE FROM presence WHERE at < ?').bind(now() - 86_400_000).run())
  return json({ latest: state.latest ?? 0, version: state.version, presence })
}

// ---------------------------------------------------------------- pictures

async function putAsset(ctx: Ctx, me: Caller, ws: string, id: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner', 'editor'])
  if (!isAssetId(id)) throw new Fail(400, 'bad_request')
  const type = (ctx.request.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!/^image\/[\w.+-]+$/.test(type)) throw new Fail(415, 'not_image')
  const bytes = new Uint8Array(await ctx.request.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES) throw new Fail(413, 'too_large')
  const old = await db.prepare('SELECT blob FROM assets WHERE workspace_id = ? AND id = ?').bind(ws, id).first<{ blob: string }>()
  if (old) return json({ ok: true }) // pictures never change: the first copy stays
  const blob = randomToken(12)
  const pieces = blobStatements(db, blob, bytes)
  for (let i = 0; i < pieces.length; i += 20) await db.batch(pieces.slice(i, i + 20))
  await db.prepare('INSERT OR IGNORE INTO assets (workspace_id, id, type, size, blob, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ws, id, type, bytes.length, blob, now()).run()
  return json({ ok: true })
}

async function getAsset(ctx: Ctx, me: Caller, ws: string, id: string) {
  const db = ctx.env.DB
  await needRole(db, ws, me.account, ['owner', 'editor', 'viewer'])
  const row = await db.prepare('SELECT type, blob FROM assets WHERE workspace_id = ? AND id = ?').bind(ws, id).first<{ type: string; blob: string }>()
  if (!row) throw new Fail(404, 'not_found')
  const bytes = await readBlob(db, row.blob)
  return new Response(blobOf(bytes), { headers: { ...CORS, 'content-type': row.type, 'cache-control': 'private, max-age=31536000, immutable' } })
}

// ---------------------------------------------------------------- the writing assistant

const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']
const EFFORTS = ['low', 'medium']
const THINKING = ['disabled', 'between_tools']

async function assistant(ctx: Ctx, me: Caller) {
  const key = ctx.env.ANTHROPIC_API_KEY
  if (!key) throw new Fail(503, 'noserver')
  const body = await readJson<Record<string, unknown>>(ctx.request, 200_000)
  const messages = body.messages
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 40 ||
    !messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)))
  ) {
    throw new Fail(400, 'bad_request')
  }
  const month = new Date().toISOString().slice(0, 7)
  const used = await ctx.env.DB.prepare('INSERT INTO ai_usage (account_id, month, count) VALUES (?, ?, 1) ON CONFLICT (account_id, month) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(me.account, month)
    .first<{ count: number }>()
  if ((used?.count ?? 0) > Number(ctx.env.AI_MONTHLY_LIMIT ?? '300')) throw new Fail(429, 'quota')
  // Only settings the app itself uses are passed on
  const model = MODELS.includes(String(body.model)) ? String(body.model) : MODELS[0]
  const effort = (body.output_config as { effort?: unknown } | undefined)?.effort
  const thinking = (body.thinking as { type?: unknown } | undefined)?.type
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(Number(body.max_tokens) || 2048, 4096),
      stream: true,
      system: typeof body.system === 'string' ? body.system.slice(0, 20_000) : undefined,
      messages,
      output_config: { effort: EFFORTS.includes(String(effort)) ? String(effort) : 'low' },
      thinking: { type: THINKING.includes(String(thinking)) ? String(thinking) : 'disabled' },
    }),
  })
  return new Response(res.body, { status: res.status, headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache' } })
}

// ---------------------------------------------------------------- routes

async function route(ctx: Ctx): Promise<Response> {
  const method = ctx.request.method
  const raw = ctx.params.path
  const p = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((s) => decodeURIComponent(s))
  const [a, b, c, d, e] = p
  const db = ctx.env.DB
  if (!db) throw new Fail(503, 'no_database')
  await ensureSchema(db)

  // No account needed
  if (a === 'health' && method === 'GET') return json({ ok: true, time: now() })
  if (a === 'account' && !b && method === 'POST') return createAccount(ctx)
  if (a === 'link' && b === 'claim' && method === 'POST') return claimLinkCode(ctx)
  if (a === 'recover' && method === 'POST') return recover(ctx)
  if (a === 'invites' && b && !c && method === 'GET') return inviteInfo(ctx, b)

  const me = await caller(ctx)
  if (a === 'account' && !b) {
    if (method === 'GET') return getAccount(ctx, me)
    if (method === 'PATCH') return renameAccount(ctx, me)
    if (method === 'DELETE') return deleteAccount(ctx, me)
  }
  if (a === 'account' && b === 'recovery' && method === 'POST') return newRecoveryKey(ctx, me)
  if (a === 'link' && !b && method === 'POST') return makeLinkCode(ctx, me)
  if (a === 'devices' && b && method === 'DELETE') return removeDevice(ctx, me, b)
  if (a === 'signout' && method === 'POST') return signOut(ctx, me)
  if (a === 'ai' && method === 'POST') return assistant(ctx, me)
  if (a === 'invites' && b && c === 'accept' && method === 'POST') return acceptInvite(ctx, me, b)
  if (a === 'invites' && b && !c && method === 'DELETE') return revokeInvite(ctx, me, b)
  if (a === 'workspaces') {
    if (!b && method === 'GET') return listWorkspaces(ctx, me)
    if (!b && method === 'POST') return createWorkspace(ctx, me)
    if (b && !c && method === 'PATCH') return renameWorkspace(ctx, me, b)
    if (b && c === 'members' && !d && method === 'GET') return listMembers(ctx, me, b)
    if (b && c === 'members' && d && method === 'PATCH') return setMemberRole(ctx, me, b, d)
    if (b && c === 'members' && d && method === 'DELETE') return removeMember(ctx, me, b, d)
    if (b && c === 'invites' && method === 'POST') return createInvite(ctx, me, b)
    if (b && c === 'invites' && method === 'GET') return listInvites(ctx, me, b)
    if (b && c === 'updates' && method === 'POST') return pushUpdates(ctx, me, b)
    if (b && c === 'updates' && method === 'GET') return pullUpdates(ctx, me, b)
    if (b && c === 'compact' && method === 'POST') return compact(ctx, me, b)
    if (b && c === 'wait' && method === 'GET') return waitForChange(ctx, me, b)
    if (b && c === 'assets' && d && !e && method === 'PUT') return putAsset(ctx, me, b, d)
    if (b && c === 'assets' && d && !e && method === 'GET') return getAsset(ctx, me, b, d)
  }
  throw new Fail(404, 'not_found')
}

export async function onRequest(ctx: Ctx): Promise<Response> {
  if (ctx.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    return await route(ctx)
  } catch (err) {
    if (err instanceof Fail) return json({ error: err.code }, err.status)
    console.error('[qirtas api]', err)
    return json({ error: 'server_error' }, 500)
  }
}
