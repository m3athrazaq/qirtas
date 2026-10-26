// Sign-in links (a password-reset email) bring a session in the page address. It is picked up here,
// before the router or anything else can change the address, and the address is cleaned at once.
// The session is never applied silently (see sync/session.ts): a link made by someone else could
// otherwise sign this device into their account and send this device's pages to it.

let pending: URLSearchParams | null = null

export function captureAuthRedirect() {
  const fromHash = location.hash.replace(/^#/, '')
  const fromQuery = location.search.replace(/^\?/, '')
  const pick = [fromHash, fromQuery].find((s) => /(^|&)(access_token|error_description)=/.test(s))
  if (!pick) return
  pending = new URLSearchParams(pick)
  history.replaceState(null, '', location.pathname + (pick === fromQuery ? '' : location.search) + '#/')
}

export function takeAuthRedirect(): URLSearchParams | null {
  const p = pending
  pending = null
  return p
}

/** The e-mail inside a session token, to show whose account a link signs into. */
export function tokenEmail(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.email === 'string' ? payload.email : ''
  } catch {
    return ''
  }
}
