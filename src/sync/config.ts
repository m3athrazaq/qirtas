// Where the sync server is (functions/api, on Cloudflare): next to the web app, or, from the
// Android app, at the web app's public address.
import { isNative } from '../lib/platform'

const configured = (import.meta.env.VITE_SYNC_URL as string | undefined)?.replace(/\/$/, '')
const publicUrl = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/** The API's address ("" = this site), or null when this build has no sync. */
export function apiBase(): string | null {
  if (configured === 'off') return null
  if (configured) return `${configured}/api`
  if (isNative()) return publicUrl ? `${publicUrl}/api` : null
  // The web app: its own site (the dev server has no API and simply reports it as unreachable)
  return location.protocol.startsWith('http') ? '/api' : publicUrl ? `${publicUrl}/api` : null
}

export const syncAvailable = () => apiBase() !== null
