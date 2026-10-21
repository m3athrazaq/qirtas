import type { TagColor } from '../data/types'

export const COLOR_NAMES: TagColor[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']

/** Text colors are stored as CSS variables so they adapt to light and dark themes. */
export const textColorValue = (c: TagColor) => `var(--tc-${c})`
export const highlightValue = (c: TagColor) => `var(--hl-${c})`

export function colorFromValue(v: string | null | undefined): TagColor | null {
  if (!v) return null
  const m = v.match(/--(?:tc|hl)-([a-z]+)/)
  return (m?.[1] as TagColor) ?? null
}
