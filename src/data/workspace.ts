// The workspace document: page tree, page metadata, database schemas/views and row properties.
// Page *content* lives in its own Yjs document per page (see docs.ts).
import * as Y from 'yjs'
import { compareOrder, orderBetween, uid } from '../lib/ids'
import { destroyDoc, getDoc, pageDocId } from './docs'
import { ORIGIN_SYSTEM } from './history'
import type { Cover, PageFont, PageMeta, PageType, PropDef, PropValue, ViewDef } from './types'

type YPage = Y.Map<unknown>

const META_KEYS = new Set(['text'])

export interface Actor {
  id: string
  name: string
}

let actor: Actor = { id: 'local', name: '' }
export function setActor(a: Actor) {
  actor = a
}
export function getActor() {
  return actor
}

export class Workspace {
  readonly id: string
  readonly doc: Y.Doc
  readonly pages: Y.Map<YPage>
  readonly meta: Y.Map<unknown>
  readonly prefs: Y.Map<unknown>

  constructor(id: string, doc: Y.Doc) {
    this.id = id
    this.doc = doc
    this.pages = doc.getMap('pages') as Y.Map<YPage>
    this.meta = doc.getMap('meta')
    this.prefs = doc.getMap('prefs')
  }

  static async open(id: string): Promise<Workspace> {
    const doc = await getDoc(`ws:${id}`)
    return new Workspace(id, doc)
  }

  // ---------- reading ----------
  page(id: string): YPage | undefined {
    return this.pages.get(id)
  }

  toMeta(id: string, m: YPage): PageMeta {
    const g = <T>(k: string, d: T): T => {
      const v = m.get(k)
      return v === undefined || v === null ? d : (v as T)
    }
    const propsMap = m.get('props') as Y.Map<PropValue> | undefined
    const meta: PageMeta = {
      id,
      type: g<PageType>('type', 'page'),
      title: g('title', ''),
      icon: g('icon', ''),
      cover: g<Cover | null>('cover', null),
      coverY: g('coverY', 50),
      parentId: (m.get('parentId') as string | null) ?? null,
      order: g('order', 'a0'),
      createdAt: g('createdAt', 0),
      updatedAt: g('updatedAt', 0),
      createdBy: g('createdBy', ''),
      updatedBy: g('updatedBy', ''),
      deletedAt: (m.get('deletedAt') as number | null) || null,
      fullWidth: g('fullWidth', false),
      font: g<PageFont>('font', 'sans'),
      smallText: g('smallText', false),
      inline: g('inline', false),
    }
    if (meta.type === 'database') {
      meta.schema = g<PropDef[]>('schema', [])
      meta.views = g<ViewDef[]>('views', [])
    }
    if (propsMap instanceof Y.Map) meta.props = propsMap.toJSON() as Record<string, PropValue>
    return meta
  }

  snapshot(): Record<string, PageMeta> {
    const out: Record<string, PageMeta> = {}
    this.pages.forEach((m, id) => {
      out[id] = this.toMeta(id, m)
    })
    return out
  }

  /** Calls back with ids of pages whose UI-relevant fields changed. */
  observe(cb: (changed: Set<string>) => void): () => void {
    const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      const changed = new Set<string>()
      for (const ev of events) {
        if (ev.target === this.pages) {
          ;(ev as Y.YMapEvent<unknown>).keysChanged.forEach((k) => changed.add(k))
        } else {
          const pid = ev.path[0] as string | undefined
          if (!pid) continue
          if (ev.path.length === 1 && ev instanceof Y.YMapEvent) {
            const keys = [...ev.keysChanged]
            if (keys.every((k) => META_KEYS.has(k))) continue
          }
          changed.add(pid)
        }
      }
      if (changed.size) cb(changed)
    }
    this.pages.observeDeep(handler)
    return () => this.pages.unobserveDeep(handler)
  }

  getText(id: string): string {
    return (this.pages.get(id)?.get('text') as string) || ''
  }

  // ---------- writing ----------
  private touch(m: YPage) {
    m.set('updatedAt', Date.now())
    m.set('updatedBy', actor.id)
  }

  childrenOrdered(parentId: string | null): { id: string; order: string }[] {
    const list: { id: string; order: string }[] = []
    this.pages.forEach((m, id) => {
      if ((m.get('parentId') ?? null) === parentId && !m.get('deletedAt') && m.get('type') !== 'row') {
        list.push({ id, order: (m.get('order') as string) || 'a0' })
      }
    })
    return list.sort(compareOrder)
  }

  rowsOrdered(dbId: string): { id: string; order: string }[] {
    const list: { id: string; order: string }[] = []
    this.pages.forEach((m, id) => {
      if (m.get('parentId') === dbId && m.get('type') === 'row' && !m.get('deletedAt')) {
        list.push({ id, order: (m.get('order') as string) || 'a0' })
      }
    })
    return list.sort(compareOrder)
  }

  createPage(
    init: Partial<Omit<PageMeta, 'id'>> & { id?: string },
    place: { before?: string | null; after?: string | null; atStart?: boolean } = {},
  ): string {
    const id = init.id ?? uid()
    const type = init.type ?? 'page'
    const parentId = init.parentId ?? null
    const siblings = type === 'row' && parentId ? this.rowsOrdered(parentId) : this.childrenOrdered(parentId)
    let order: string
    if (place.after !== undefined && place.after !== null) {
      const idx = siblings.findIndex((s) => s.id === place.after)
      order = orderBetween(siblings[idx]?.order ?? null, siblings[idx + 1]?.order ?? null)
    } else if (place.before !== undefined && place.before !== null) {
      const idx = siblings.findIndex((s) => s.id === place.before)
      order = orderBetween(siblings[idx - 1]?.order ?? null, siblings[idx]?.order ?? null)
    } else if (place.atStart) {
      order = orderBetween(null, siblings[0]?.order ?? null)
    } else {
      order = orderBetween(siblings[siblings.length - 1]?.order ?? null, null)
    }
    const now = Date.now()
    this.doc.transact(() => {
      const m = new Y.Map<unknown>()
      this.pages.set(id, m)
      m.set('type', type)
      m.set('title', init.title ?? '')
      m.set('icon', init.icon ?? '')
      m.set('cover', init.cover ?? null)
      m.set('coverY', init.coverY ?? 50)
      m.set('parentId', parentId)
      m.set('order', order)
      m.set('createdAt', now)
      m.set('updatedAt', now)
      m.set('createdBy', actor.id)
      m.set('updatedBy', actor.id)
      m.set('deletedAt', null)
      m.set('fullWidth', init.fullWidth ?? false)
      m.set('font', init.font ?? 'sans')
      m.set('smallText', init.smallText ?? false)
      m.set('inline', init.inline ?? false)
      if (type === 'database') {
        m.set('schema', init.schema ?? [])
        m.set('views', init.views ?? [])
      }
      if (type === 'row' || init.props) {
        const props = new Y.Map<PropValue>()
        m.set('props', props)
        Object.entries(init.props ?? {}).forEach(([k, v]) => props.set(k, v))
      }
    })
    return id
  }

  updatePage(id: string, patch: Partial<Pick<PageMeta, 'title' | 'icon' | 'cover' | 'coverY' | 'fullWidth' | 'font' | 'smallText' | 'inline' | 'schema' | 'views'>>) {
    const m = this.pages.get(id)
    if (!m) return
    this.doc.transact(() => {
      Object.entries(patch).forEach(([k, v]) => m.set(k, v === undefined ? null : v))
      if (m.get('seed')) m.set('seed', false)
      this.touch(m)
    })
  }

  /** Pages created by the welcome guide carry a "seed" flag until the user changes them. */
  markSeeded(ids: string[]) {
    this.doc.transact(() => ids.forEach((id) => this.pages.get(id)?.set('seed', true)), ORIGIN_SYSTEM)
  }

  touchSeed(id: string) {
    const m = this.pages.get(id)
    if (m?.get('seed')) this.doc.transact(() => m.set('seed', false), ORIGIN_SYSTEM)
  }

  /** True when the workspace only holds the untouched welcome pages. */
  isPristine(): boolean {
    let pristine = true
    this.pages.forEach((m) => {
      if (!m.get('deletedAt') && !m.get('seed')) pristine = false
    })
    return pristine
  }

  /** Turn an (empty) page into a full-page database. */
  convertToDatabase(id: string, schema: PropDef[], views: ViewDef[]) {
    const m = this.pages.get(id)
    if (!m) return
    this.doc.transact(() => {
      m.set('type', 'database')
      m.set('schema', schema)
      m.set('views', views)
      m.set('inline', false)
      this.touch(m)
    })
  }

  setText(id: string, text: string) {
    const m = this.pages.get(id)
    if (!m) return
    if ((m.get('text') as string) === text) return
    // Search text follows the page content; it isn't a change of its own for undo
    this.doc.transact(() => {
      m.set('text', text.slice(0, 60000))
      this.touch(m)
    }, ORIGIN_SYSTEM)
  }

  setProp(rowId: string, propId: string, value: PropValue) {
    const m = this.pages.get(rowId)
    if (!m) return
    this.doc.transact(() => {
      let props = m.get('props') as Y.Map<PropValue> | undefined
      if (!(props instanceof Y.Map)) {
        props = new Y.Map<PropValue>()
        m.set('props', props)
      }
      if (m.get('seed')) m.set('seed', false)
      if (propId === 'title') m.set('title', String(value ?? ''))
      else if (value === null || value === undefined || (Array.isArray(value) && value.length === 0) || value === '') props.delete(propId)
      else props.set(propId, value)
      this.touch(m)
    })
  }

  /** Move a page under a new parent, before/after a sibling. */
  movePage(id: string, parentId: string | null, place: { before?: string; after?: string } = {}) {
    const m = this.pages.get(id)
    if (!m) return
    // Prevent cycles
    let p: string | null = parentId
    while (p) {
      if (p === id) return
      p = (this.pages.get(p)?.get('parentId') as string | null) ?? null
    }
    const isRow = m.get('type') === 'row'
    const siblings = (isRow && parentId ? this.rowsOrdered(parentId) : this.childrenOrdered(parentId)).filter((s) => s.id !== id)
    let order: string
    if (place.before) {
      const idx = siblings.findIndex((s) => s.id === place.before)
      order = orderBetween(siblings[idx - 1]?.order ?? null, siblings[idx]?.order ?? null)
    } else if (place.after) {
      const idx = siblings.findIndex((s) => s.id === place.after)
      order = orderBetween(siblings[idx]?.order ?? null, siblings[idx + 1]?.order ?? null)
    } else {
      order = orderBetween(siblings[siblings.length - 1]?.order ?? null, null)
    }
    this.doc.transact(() => {
      m.set('parentId', parentId)
      m.set('order', order)
      if (!isRow && m.get('inline') && m.get('type') === 'database' && parentId !== (m.get('parentId') ?? null)) m.set('inline', false)
      this.touch(m)
    })
  }

  setOrder(id: string, order: string) {
    const m = this.pages.get(id)
    if (!m) return
    this.doc.transact(() => {
      m.set('order', order)
      this.touch(m)
    })
  }

  trashPage(id: string) {
    const m = this.pages.get(id)
    if (!m) return
    this.doc.transact(() => {
      m.set('deletedAt', Date.now())
      this.touch(m)
    })
  }

  restorePage(id: string) {
    const m = this.pages.get(id)
    if (!m) return
    this.doc.transact(() => {
      m.set('deletedAt', null)
      // If the parent is gone or trashed, restore to the top level
      const parentId = m.get('parentId') as string | null
      if (parentId) {
        const parent = this.pages.get(parentId)
        if (!parent || parent.get('deletedAt')) {
          m.set('parentId', null)
          if (m.get('type') === 'row') m.set('type', 'page')
        }
      }
      this.touch(m)
    })
  }

  descendants(id: string): string[] {
    const out: string[] = []
    const byParent = new Map<string, string[]>()
    this.pages.forEach((m, pid) => {
      const parent = m.get('parentId') as string | null
      if (!parent) return
      const list = byParent.get(parent) ?? []
      list.push(pid)
      byParent.set(parent, list)
    })
    const walk = (x: string) => {
      ;(byParent.get(x) ?? []).forEach((c) => {
        out.push(c)
        walk(c)
      })
    }
    walk(id)
    return out
  }

  async purgePage(id: string) {
    const ids = [id, ...this.descendants(id)]
    // Permanent: the content is destroyed with it, so undo can't bring it back
    this.doc.transact(() => ids.forEach((x) => this.pages.delete(x)), ORIGIN_SYSTEM)
    await Promise.all(ids.map((x) => destroyDoc(pageDocId(x))))
  }

  async duplicatePage(id: string, titleSuffix = '', newParent?: string | null): Promise<string | null> {
    const src = this.pages.get(id)
    if (!src) return null
    const ids = [id, ...this.descendants(id)]
    const idMap = new Map<string, string>()
    ids.forEach((x) => idMap.set(x, uid()))
    // Copy content docs first (outside the workspace transaction)
    for (const x of ids) {
      const from = await getDoc(pageDocId(x))
      const to = await getDoc(pageDocId(idMap.get(x)!))
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from))
      remapIds(to.getXmlFragment('default'), idMap)
    }
    const meta = this.toMeta(id, src)
    const siblingsParent = newParent === undefined ? meta.parentId : newParent
    this.doc.transact(() => {
      for (const x of ids) {
        const m = this.pages.get(x)!
        const copy = new Y.Map<unknown>()
        m.forEach((v, k) => {
          if (k === 'props' && v instanceof Y.Map) {
            const p = new Y.Map<PropValue>()
            v.forEach((pv, pk) => p.set(pk, pv as PropValue))
            copy.set('props', p)
          } else copy.set(k, v)
        })
        if (x === id) {
          copy.set('parentId', siblingsParent)
          copy.set('title', (meta.title || '') + titleSuffix)
          const sib = this.childrenOrdered(siblingsParent)
          const idx = sib.findIndex((s) => s.id === id)
          copy.set('order', orderBetween(sib[idx]?.order ?? sib[sib.length - 1]?.order ?? null, sib[idx + 1]?.order ?? null))
        } else {
          copy.set('parentId', idMap.get(m.get('parentId') as string) ?? null)
        }
        copy.set('createdAt', Date.now())
        copy.set('updatedAt', Date.now())
        this.pages.set(idMap.get(x)!, copy)
      }
    })
    return idMap.get(id)!
  }

  // ---------- databases ----------
  updateSchema(dbId: string, fn: (schema: PropDef[]) => PropDef[]) {
    const m = this.pages.get(dbId)
    if (!m) return
    const schema = (m.get('schema') as PropDef[]) ?? []
    this.doc.transact(() => {
      m.set('schema', fn(structuredClone(schema)))
      this.touch(m)
    })
  }

  updateViews(dbId: string, fn: (views: ViewDef[]) => ViewDef[]) {
    const m = this.pages.get(dbId)
    if (!m) return
    const views = (m.get('views') as ViewDef[]) ?? []
    this.doc.transact(() => {
      m.set('views', fn(structuredClone(views)))
      this.touch(m)
    })
  }

  updateView(dbId: string, viewId: string, patch: Partial<ViewDef>) {
    this.updateViews(dbId, (vs) => vs.map((v) => (v.id === viewId ? { ...v, ...patch } : v)))
  }

  /** Remove a property and its values from every row. */
  deleteProperty(dbId: string, propId: string) {
    this.doc.transact(() => {
      this.updateSchema(dbId, (s) => s.filter((p) => p.id !== propId))
      this.updateViews(dbId, (vs) =>
        vs.map((v) => ({
          ...v,
          groupBy: v.groupBy === propId ? undefined : v.groupBy,
          datePropId: v.datePropId === propId ? undefined : v.datePropId,
          filters: v.filters.filter((f) => f.propId !== propId),
          sorts: v.sorts.filter((f) => f.propId !== propId),
          hidden: v.hidden.filter((h) => h !== propId),
        })),
      )
      for (const r of this.rowsOrdered(dbId)) {
        const props = this.pages.get(r.id)?.get('props') as Y.Map<PropValue> | undefined
        props?.delete(propId)
      }
    })
  }

  // ---------- per-user preferences (favorites) ----------
  favorites(userId: string): string[] {
    const p = this.prefs.get(userId) as { favorites?: string[] } | undefined
    return p?.favorites ?? []
  }

  toggleFavorite(userId: string, pageId: string) {
    const cur = (this.prefs.get(userId) as { favorites?: string[] } | undefined) ?? {}
    const favs = cur.favorites ?? []
    const next = favs.includes(pageId) ? favs.filter((f) => f !== pageId) : [...favs, pageId]
    this.prefs.set(userId, { ...cur, favorites: next })
  }

  setName(name: string, icon?: string) {
    this.doc.transact(() => {
      this.meta.set('name', name)
      if (icon !== undefined) this.meta.set('icon', icon)
    })
  }
}

function remapIds(frag: Y.XmlFragment, idMap: Map<string, string>) {
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    node.toArray().forEach((child) => {
      if (child instanceof Y.XmlElement) {
        for (const attr of ['pageId', 'databaseId']) {
          const v = child.getAttribute(attr) as string | undefined
          if (v && idMap.has(v)) child.setAttribute(attr, idMap.get(v)!)
        }
        walk(child)
      }
    })
  }
  frag.doc?.transact(() => walk(frag))
}
