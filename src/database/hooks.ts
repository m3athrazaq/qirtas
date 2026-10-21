import { useMemo } from 'react'
import { useStore } from '../data/store'
import type { PageMeta, ViewDef } from '../data/types'
import { compareOrder } from '../lib/ids'

export function useDb(dbId: string): PageMeta | undefined {
  return useStore((s) => s.pages[dbId])
}

export function useRows(dbId: string): PageMeta[] {
  const pages = useStore((s) => s.pages)
  return useMemo(() => {
    const rows: PageMeta[] = []
    for (const id in pages) {
      const p = pages[id]
      if (p.parentId === dbId && p.type === 'row' && !p.deletedAt) rows.push(p)
    }
    return rows.sort(compareOrder)
  }, [pages, dbId])
}

const VIEW_KEY = 'qirtas.dbview'
export function getActiveViewId(dbId: string, views: ViewDef[]): string | undefined {
  try {
    const map = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')
    const id = map[dbId]
    if (views.some((v) => v.id === id)) return id
  } catch {
    /* ignore */
  }
  return views[0]?.id
}
export function setActiveViewId(dbId: string, viewId: string) {
  try {
    const map = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')
    map[dbId] = viewId
    localStorage.setItem(VIEW_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}
