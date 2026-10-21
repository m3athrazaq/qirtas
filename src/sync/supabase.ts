import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL, syncAvailable } from './config'

let client: SupabaseClient | null = null

export function supa(): SupabaseClient | null {
  if (!syncAvailable()) return null
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'qirtas.auth' },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  }
  return client
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
