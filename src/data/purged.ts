// Pages deleted for good. "Delete forever" destroys a page's content on this device only: the
// server and other devices keep their copy. Two things follow:
// - a page the app keeps under a fixed id (the journal, a day, the template shelf) gets a new id
//   the next time it is made, so the old content doesn't come back under it;
// - if a page deleted here is in use again (a restore brings it back), this device must fetch the
//   page's whole history from the server before using it: later changes from other devices build
//   on that history, and this device's sync bookmark is already past it.

/** The fixed ids the app gives its own pages, with an optional generation: journal-<ws>, templates-<ws>,
 *  day-<ws>-2026-11-11, and the same with -g2 after the first one was deleted for good. */
const FIXED = /^((?:journal|templates)-[A-Za-z0-9]+|day-[A-Za-z0-9]+-\d{4}-\d{2}-\d{2})(?:-g(\d+))?$/

/** The id without its generation, for a fixed id; null for any other page. */
export function fixedBase(id: string): string | null {
  return FIXED.exec(id)?.[1] ?? null
}

export function fixedGen(id: string): number {
  return Number(FIXED.exec(id)?.[2] ?? 0) || 0
}

export const withGen = (base: string, gen: number) => (gen > 0 ? `${base}-g${gen}` : base)

const KEY = 'qirtas.purged'

let cache: Record<string, string[]> | null = null

function read(): Record<string, string[]> {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string[]>
  } catch {
    cache = {}
  }
  return cache
}

function write(m: Record<string, string[]>) {
  cache = m
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* storage unavailable */
  }
}

/** Remember the documents of pages deleted for good on this device. */
export function notePurged(wsId: string, docIds: string[]) {
  const m = read()
  const ids = new Set(m[wsId] ?? [])
  docIds.forEach((d) => ids.add(d))
  write({ ...m, [wsId]: [...ids].slice(-1000) })
}

export function purgedDocs(wsId: string): Set<string> {
  return new Set(read()[wsId] ?? [])
}

export function forgetPurged(wsId: string, docId: string) {
  const m = read()
  if (!m[wsId]?.includes(docId)) return
  write({ ...m, [wsId]: m[wsId].filter((d) => d !== docId) })
}

/** Is any page deleted for good here back in the workspace? (cheap: called on every change) */
export function anyRevived(wsId: string, pages: Record<string, unknown>): boolean {
  const l = read()[wsId]
  return !!l?.length && l.some((d) => d.slice(3) in pages)
}
