import { generateKeyBetween } from 'fractional-indexing'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function uid(len = 12): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/** Order key strictly between a and b (either may be null for open ends). */
export function orderBetween(a: string | null | undefined, b: string | null | undefined): string {
  try {
    return generateKeyBetween(a ?? null, b ?? null)
  } catch {
    // Keys out of order (e.g. concurrent edits produced equal keys): append after a
    return generateKeyBetween(a ?? null, null)
  }
}

export function compareOrder(a: { order: string; id: string }, b: { order: string; id: string }): number {
  if (a.order < b.order) return -1
  if (a.order > b.order) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
