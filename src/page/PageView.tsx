import type { Editor } from '@tiptap/react'
import { CalendarDays, LayoutTemplate, SquareKanban, Table2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { defaultRowProps, defaultSchema, defaultStatusOptions, newView } from '../data/dbops'
import { clearPendingScroll, navigate, pendingScrollTarget } from '../data/nav'
import { useCanEdit, useStore, ws } from '../data/store'
import type { PropDef, ViewType } from '../data/types'
import { getActiveEditor, PageEditor } from '../editor/PageEditor'
import { t } from '../lib/i18n'
import { uid } from '../lib/ids'
import { PageCover, PageTitleBlock } from './PageHeader'
import { RowProps } from './RowProps'

const DatabaseView = lazy(() => import('../database/DatabaseView'))

export function PageView({ pageId, inPeek = false }: { pageId: string; inPeek?: boolean }) {
  const page = useStore((s) => s.pages[pageId])
  const settings = useStore((s) => s.settings)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [empty, setEmpty] = useState(false)
  const canEdit = useCanEdit()

  // Back from a full-size database: bring its block into view
  useEffect(() => {
    if (inPeek) return
    const id = pendingScrollTarget()
    if (!id) return
    let tries = 0
    const timer = setInterval(() => {
      const el = document.querySelector(`[data-database-id="${CSS.escape(id)}"]`)
      if (el || ++tries > 20) {
        clearInterval(timer)
        clearPendingScroll()
        el?.scrollIntoView({ block: 'center' })
      }
    }, 100)
    return () => clearInterval(timer)
  }, [pageId, inPeek])

  useEffect(() => {
    if (!editor) return
    const check = () => setEmpty(editor.isEmpty)
    check()
    editor.on('update', check)
    return () => {
      editor.off('update', check)
    }
  }, [editor])

  if (!page || page.deletedAt) {
    return (
      <div className="page-missing">
        <p>{t('pageNotFound')}</p>
        <button type="button" className="btn" onClick={() => navigate(null)}>
          {t('goHome')}
        </button>
      </div>
    )
  }

  const editable = canEdit
  const isDb = page.type === 'database'
  const focusEditor = () => {
    const ed = getActiveEditor(pageId) ?? editor
    if (!ed || ed.isDestroyed) return
    // Focus right away so a fast next keystroke lands in the page, not the title
    // (the editor's own focus command waits for the next frame).
    ed.view.focus()
    ed.chain().focus('start').run()
  }

  const toDatabase = (type: ViewType) => {
    let schema: PropDef[] = defaultSchema()
    if (type === 'board') {
      schema = [
        { id: 'title', name: t('p_name'), type: 'title' },
        { id: uid(6), name: t('p_status'), type: 'status', options: defaultStatusOptions(true) },
        { id: uid(6), name: t('p_assignee'), type: 'person', options: [] },
        { id: uid(6), name: t('p_date'), type: 'date' },
      ]
    }
    ws().convertToDatabase(page.id, schema, [newView(type, schema)])
    const initial = defaultRowProps(schema)
    for (let i = 0; i < 3; i++) ws().createPage({ type: 'row', parentId: page.id, props: initial })
  }

  const cls = ['page', `font-${page.font}`, page.fullWidth || isDb ? 'is-wide' : '', page.smallText ? 'is-small' : '', settings.marginLine ? 'has-margin' : '', inPeek ? 'in-peek' : '']
  return (
    <article className={cls.filter(Boolean).join(' ')}>
      <PageCover page={page} editable={editable} />
      <div className="page-col">
        <PageTitleBlock page={page} editable={editable} onEnter={focusEditor} />
        {page.type === 'row' && <RowProps row={page} />}
        {isDb ? (
          <Suspense fallback={<div className="db-loading" />}>
            <DatabaseView dbId={page.id} />
          </Suspense>
        ) : (
          <>
            {editable && empty && page.type === 'page' && !page.title && (
              <div className="start-with">
                <span className="muted">{t('emptyHint')}</span>
                <button type="button" className="chip-btn" onClick={() => toDatabase('table')}>
                  <Table2 size={14} /> {t('bTable')}
                </button>
                <button type="button" className="chip-btn" onClick={() => toDatabase('board')}>
                  <SquareKanban size={14} /> {t('bBoard')}
                </button>
                <button type="button" className="chip-btn" onClick={() => toDatabase('calendar')}>
                  <CalendarDays size={14} /> {t('bCalendar')}
                </button>
                <button type="button" className="chip-btn" onClick={() => useStore.getState().openModal('templates')}>
                  <LayoutTemplate size={14} /> {t('templates')}
                </button>
              </div>
            )}
            <PageEditor pageId={page.id} editable={editable} onReady={setEditor} />
          </>
        )}
      </div>
    </article>
  )
}
