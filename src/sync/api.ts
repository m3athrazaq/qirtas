// Talking to the sync server: JSON in and out, this device's token, errors with a code.
import { apiBase } from './config'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

const KEY = 'qirtas.sync'

export interface Credentials {
  token: string
  account: { id: string; name: string }
}

/** This device's link to its account (kept until it is unlinked; it doesn't expire). */
export function loadCredentials(): Credentials | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null') as Credentials | null
    return c?.token && c.account?.id ? c : null
  } catch {
    return null
  }
}

export function saveCredentials(c: Credentials | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: linked for this session only */
  }
  memo = c
}

let memo: Credentials | null | undefined
const credentials = () => (memo === undefined ? (memo = loadCredentials()) : memo)

export interface CallOptions {
  method?: string
  body?: unknown
  /** Sent as is (a picture) instead of JSON. */
  raw?: Blob
  signal?: AbortSignal
  /** Give up after this long (default 30 s). */
  timeout?: number
  /** The response body itself (a picture), not JSON. */
  blob?: boolean
}

export async function api<T = unknown>(path: string, opts: CallOptions = {}): Promise<T> {
  const base = apiBase()
  if (base === null) throw new ApiError(0, 'no_sync')
  const headers: Record<string, string> = {}
  const c = credentials()
  if (c) headers.authorization = `Bearer ${c.token}`
  let body: BodyInit | undefined
  if (opts.raw) {
    body = opts.raw
    headers['content-type'] = opts.raw.type || 'application/octet-stream'
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['content-type'] = 'application/json'
  }
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), opts.timeout ?? 30_000)
  const onAbort = () => timeout.abort()
  opts.signal?.addEventListener('abort', onAbort)
  let res: Response
  try {
    res = await fetch(base + path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: timeout.signal, cache: 'no-store' })
  } catch (err) {
    throw new ApiError(0, opts.signal?.aborted ? 'aborted' : (err as Error)?.name === 'AbortError' ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok) {
    let code = res.status === 401 ? 'unauthorized' : `http_${res.status}`
    if (type.includes('json')) code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? code
    // Not this server (a page instead of an answer): there is no sync server here
    else if (res.status === 404 || res.status === 405) code = 'no_server'
    throw new ApiError(res.status, code)
  }
  if (opts.blob) return (await res.blob()) as T
  if (!type.includes('json')) throw new ApiError(res.status, 'no_server')
  return (await res.json()) as T
}

export function toB64(u: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < u.length; i += chunk) s += String.fromCharCode(...u.subarray(i, i + chunk))
  return btoa(s)
}

export function fromB64(b: string): Uint8Array {
  const s = atob(b)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}
