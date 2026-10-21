import { ChevronDown, ChevronLeft, ChevronRight, Copy, Database, FileText, FolderInput, MoreHorizontal, Plus, Star, StarOff, Trash2 } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { navigate } from '../data/nav'
import { useStore, ws } from '../data/store'
import type { PageMeta } from '../data/types'
import { getActor } from '../data/workspace'
import { compareOrder } from '../lib/ids'
import { t } from '../lib/i18n'
import { requestPagePicker } from '../ui/pickerBus'
import { MenuItem, MenuSep, Popover } from '../ui/Popover'

const EXP_KEY = 'qirtas.expanded'
function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXP_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

export function useTreeIndex() {
  const pages = useStore((s) => s.pages)
  return useMemo(() => {
    const children = new Map<string | null, PageMeta[]>()
    for (const id in pages) {
      const p = pages[id]
      if (p.deletedAt || p.type === 'row') continue
      const parent = p.parentId ? pages[p.parentId] : undefined
      // Children of trashed pages stay hidden; pages whose parent vanished show at the top level
      const key = !p.parentId || !parent ? null : parent.deletedAt ? '__trashed__' : p.parentId
      const list = children.get(key) ?? []
      list.push(p)
      children.set(key, list)
    }
    children.forEach((l) => l.sort(compareOrder))
    return children
  }, [pages])
}

type DropPos = 'before' | 'after' | 'inside'
let dragId: string | null = null

export function PageTree({ rootId = null }: { rootId?: string | null }) {
  const index = useTreeIndex()
  const [expanded, setExpanded] = useState(loadExpanded)
  const toggle = (id: string, force?: boolean) => {
    const next = new Set(expanded)
    if (force === true || (force === undefined && !next.has(id))) next.add(id)
    else next.delete(id)
    setExpanded(next)
    try {
      localStorage.setItem(EXP_KEY, JSON.stringify([...next]))
    } catch {
      /* ignore */
    }
  }
  const roots = index.get(rootId) ?? []
  if (!roots.length) return <div className="tree-empty">{t('noPagesYet')}</div>
  return (
    <div className="tree" role="tree">
      {roots.map((p) => (
        <TreeItem key={p.id} page={p} depth={0} index={index} expanded={expanded} toggle={toggle} />
      ))}
    </div>
  )
}

const TreeItem = memo(function TreeItem({
  page,
  depth,
  index,
  expanded,
  toggle,
}: {
  page: PageMeta
  depth: number
  index: Map<string | null, PageMeta[]>
  expanded: Set<string>
  toggle: (id: string, force?: boolean) => void
}) {
  const activeId = useStore((s) => (s.route.name === 'page' ? s.route.id : null))
  const rtl = useStore((s) => s.settings.lang === 'ar')
  const [menu, setMenu] = useState<Element | null>(null)
  const [drop, setDrop] = useState<DropPos | null>(null)
  const kids = index.get(page.id) ?? []
  const open = expanded.has(page.id)
  const Chevron = open ? ChevronDown : rtl ? ChevronLeft : ChevronRight

  const addChild = () => {
    const id = ws().createPage({ parentId: page.id })
    toggle(page.id, true)
    navigate(id)
  }

  return (
    <div role="treeitem" aria-expanded={open}>
      <div
        className={'tree-row' + (activeId === page.id ? ' is-active' : '') + (drop ? ` drop-${drop}` : '')}
        style={{ paddingInlineStart: 6 + depth * 14 }}
        draggable={useStore.getState().wsRole !== 'viewer'}
        onDragStart={(e) => {
          dragId = page.id
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', page.title)
        }}
        onDragEnd={() => (dragId = null)}
        onDragOver={(e) => {
          if (!dragId || dragId === page.id) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const y = (e.clientY - r.top) / r.height
          setDrop(y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside')
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault()
          const id = dragId
          const pos = drop
          setDrop(null)
          if (!id || !pos || id === page.id) return
          if (pos === 'inside') {
            ws().movePage(id, page.id)
            toggle(page.id, true)
          } else ws().movePage(id, page.parentId, pos === 'before' ? { before: page.id } : { after: page.id })
        }}
        onClick={() => navigate(page.id)}
      >
        <button
          type="button"
          className="tree-toggle"
          aria-label="toggle"
          onClick={(e) => {
            e.stopPropagation()
            toggle(page.id)
          }}
        >
          <span className="tree-icon">{page.icon || (page.type === 'database' ? <Database size={16} strokeWidth={1.6} /> : <FileText size={16} strokeWidth={1.6} />)}</span>
          <Chevron size={14} className="tree-chev" />
        </button>
        <span className="tree-title">{page.title || t('untitled')}</span>
        <span className="tree-actions" hidden={useStore.getState().wsRole === 'viewer'}>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('more')}
            onClick={(e) => {
              e.stopPropagation()
              setMenu(e.currentTarget)
            }}
          >
            <MoreHorizontal size={15} />
          </button>
          {page.type === 'page' && (
            <button
              type="button"
              className="icon-btn"
              aria-label={t('addPageInside')}
              title={t('addPageInside')}
              onClick={(e) => {
                e.stopPropagation()
                addChild()
              }}
            >
              <Plus size={15} />
            </button>
          )}
        </span>
      </div>
      {open && (
        <div role="group">
          {kids.length ? (
            kids.map((k) => <TreeItem key={k.id} page={k} depth={depth + 1} index={index} expanded={expanded} toggle={toggle} />)
          ) : (
            <div className="tree-none" style={{ paddingInlineStart: 34 + depth * 14 }}>
              {t('noValue')}
            </div>
          )}
        </div>
      )}
      {menu && <PageMenu page={page} anchor={menu} onClose={() => setMenu(null)} />}
    </div>
  )
})

export function PageMenu({ page, anchor, onClose }: { page: PageMeta; anchor: Element; onClose: () => void }) {
  const favorites = useStore((s) => s.favorites)
  const fav = favorites.includes(page.id)
  const st = useStore.getState()
  return (
    <Popover anchor={anchor} open onClose={onClose} sheet>
      <div className="menu-list">
        <MenuItem
          icon={fav ? <StarOff size={15} /> : <Star size={15} />}
          label={fav ? t('removeFromFavorites') : t('addToFavorites')}
          onClick={() => {
            ws().toggleFavorite(getActor().id, page.id)
            onClose()
          }}
        />
        <MenuItem
          icon={<Copy size={15} />}
          label={t('duplicate')}
          onClick={async () => {
            onClose()
            const id = await ws().duplicatePage(page.id, t('copySuffix'))
            if (id) navigate(id)
          }}
        />
        <MenuItem
          icon={<FolderInput size={15} />}
          label={t('moveTo')}
          onClick={() => {
            onClose()
            requestPagePicker((target) => ws().movePage(page.id, target === '__root__' ? null : target), { title: t('moveTo'), excludeId: page.id, allowRoot: true })
          }}
        />
        <MenuSep />
        <MenuItem
          icon={<Trash2 size={15} />}
          label={t('delete')}
          danger
          onClick={() => {
            onClose()
            ws().trashPage(page.id)
            if (st.route.name === 'page' && st.route.id === page.id) navigate(page.parentId)
            st.toast(t('movedToTrash'), { label: t('undo'), run: () => ws().restorePage(page.id) })
          }}
        />
      </div>
    </Popover>
  )
}
