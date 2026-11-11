// A page's version history: the list of saved versions, a preview of the chosen one, and "restore".
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../data/store'
import { listVersions, type VersionMeta } from '../data/vault'
import { captureVersion, restoreVersion, versionJson } from '../data/versions'
import { schemaExtensions } from '../editor/ext'
import { AutoDirection } from '../editor/ext/bidi'
import { num } from '../lib/hijri'
import { t, type Key } from '../lib/i18n'
import { formatWhen } from '../lib/when'
import { Modal } from '../ui/Modal'

const REASON: Record<VersionMeta['reason'], Key> = {
  auto: 'hv_auto',
  first: 'hv_first',
  manual: 'hv_manual',
  'before-restore': 'hv_before_restore',
  backup: 'hv_backup',
}

export function HistoryDialog() {
  const open = useStore((s) => s.modal === 'history')
  const pageId = useStore((s) => s.historyPage)
  const close = useStore((s) => s.closeModal)
  if (!open || !pageId) return null
  return <HistoryInner key={pageId} pageId={pageId} onClose={close} />
}

function HistoryInner({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const page = useStore((s) => s.pages[pageId])
  const settings = useStore((s) => s.settings)
  const isMobile = useStore((s) => s.isMobile)
  const canEdit = useStore((s) => s.wsRole !== 'viewer')
  const toast = useStore((s) => s.toast)
  const [list, setList] = useState<VersionMeta[] | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [json, setJson] = useState<JSONContent | null>(null)
  const [busy, setBusy] = useState(false)
  const rtl = settings.lang === 'ar'
  const Back = rtl ? ArrowRight : ArrowLeft

  const reload = useCallback(async () => {
    const l = await listVersions(pageId).catch(() => [])
    setList(l)
    return l
  }, [pageId])

  // What the page holds right now goes into the history first, so the list starts with the present
  // and going back to an older version can itself be taken back
  useEffect(() => {
    let alive = true
    void captureVersion(pageId, 'auto')
      .catch(() => null)
      .then(reload)
      .then((l) => {
        if (alive && !isMobile && l[0]) setSel(l[0].id)
      })
    return () => {
      alive = false
    }
  }, [pageId, reload, isMobile])

  useEffect(() => {
    let alive = true
    setJson(null)
    if (sel !== null) void versionJson(sel).then((j) => alive && setJson(j))
    return () => {
      alive = false
    }
  }, [sel])

  const chosen = list?.find((v) => v.id === sel) ?? null
  const isLatest = !!chosen && list?.[0]?.id === chosen.id

  const restore = async () => {
    if (!chosen || busy) return
    setBusy(true)
    try {
      const r = await restoreVersion(pageId, chosen.id)
      if (!r.ok) return
      const previous = r.previous
      toast(t('historyRestored'), previous ? { label: t('undo'), run: () => void restoreVersion(pageId, previous.id) } : undefined)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const saveNow = async () => {
    const made = await captureVersion(pageId, 'manual')
    toast(made ? t('historySaved') : t('historySame'))
    const l = await reload()
    if (made && !isMobile) setSel(l[0]?.id ?? null)
  }

  const showList = !isMobile || sel === null
  const showPreview = !isMobile || sel !== null

  return (
    <Modal open onClose={onClose} title={`${t('history')} — ${page?.title || t('untitled')}`} width={920} className="history-modal">
      <div className="history">
        {showList && (
          <div className="history-list">
            {list === null && <div className="menu-empty">{t('loading')}</div>}
            {list?.length === 0 && <div className="menu-empty">{t('historyEmpty')}</div>}
            {list?.map((v) => (
              <button type="button" key={v.id} className={'history-item' + (v.id === sel ? ' is-active' : '')} onClick={() => setSel(v.id)}>
                <span className="history-when">{formatWhen(v.ts, settings)}</span>
                <span className="muted small">
                  {t(REASON[v.reason] ?? 'hv_auto')} · {t('historyChars', { n: num(v.chars, settings.numerals) })}
                </span>
              </button>
            ))}
            <div className="history-foot">
              <button type="button" className="btn btn-small" onClick={() => void saveNow()}>
                {t('historySaveNow')}
              </button>
            </div>
          </div>
        )}
        {showPreview && (
          <div className="history-view">
            <div className="history-bar">
              {isMobile && (
                <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => setSel(null)}>
                  <Back size={18} />
                </button>
              )}
              <span className="history-title">{chosen ? formatWhen(chosen.ts, settings) : ''}</span>
              <span className="spacer" />
              {chosen && canEdit && !isLatest && (
                <button type="button" className="btn btn-primary btn-small" disabled={busy || !json} onClick={() => void restore()}>
                  <RotateCcw size={14} /> {t('historyRestore')}
                </button>
              )}
            </div>
            <div className={'history-page version-preview font-' + (page?.font ?? 'sans')}>
              {json ? <VersionPreview key={sel ?? 0} json={json} rtl={rtl} /> : <div className="menu-empty">{sel === null ? t('historyPick') : t('loading')}</div>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** The version drawn by the editor itself, read-only, so it looks exactly like the page did. */
function VersionPreview({ json, rtl }: { json: JSONContent; rtl: boolean }) {
  const editor = useEditor(
    {
      extensions: [...schemaExtensions(), AutoDirection],
      editable: false,
      content: json,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { dir: rtl ? 'rtl' : 'ltr', class: 'prose', 'data-preview': '1' } },
    },
    [json],
  )
  if (!editor) return null
  return <EditorContent editor={editor} className="editor" />
}
