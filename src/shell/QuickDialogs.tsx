// Two small dialogs: a quick note that goes to the Inbox without leaving the page you are on, and
// the list of keyboard shortcuts.
import { useEffect, useRef, useState } from 'react'
import { navigate } from '../data/nav'
import { useStore } from '../data/store'
import { inboxPageId } from '../data/today'
import { t, type Key } from '../lib/i18n'
import { Modal } from '../ui/Modal'

export function CaptureDialog() {
  const open = useStore((s) => s.modal === 'capture')
  const close = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)
  const canEdit = useStore((s) => s.wsRole !== 'viewer')
  // On a phone Enter makes a new line (there is no Shift to hold); the Save button saves
  const phone = useStore((s) => s.isMobile)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 30)
  }, [open])

  const save = async () => {
    const value = text.trim()
    if (!value || busy || !canEdit) return
    setBusy(true)
    try {
      const { addToInbox } = await import('../lib/inbox')
      const id = await addToInbox(inboxPageId(), { text: value })
      setText('')
      close()
      toast(t('captureSaved'), { label: t('open'), run: () => navigate(id) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={t('capture')} width={520} top>
      <div className="capture">
        <textarea
          ref={ref}
          className="input capture-text"
          // Empty: the caret starts on the side of the app's language; then the text decides
          dir={text.trim() ? 'auto' : document.documentElement.dir || 'auto'}
          rows={4}
          value={text}
          placeholder={t('capturePlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !phone && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void save()
            }
          }}
        />
        <div className="dialog-actions">
          <span className="muted small capture-hint">{!phone && t('captureHint')}</span>
          <button type="button" className="btn" onClick={close}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={!text.trim() || busy || !canEdit} onClick={() => void save()}>
            {t('save')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const mac = () => /Mac|iPhone|iPad/.test(navigator.platform)

/** Shortcut groups shown in the dialog; `keys` use Ctrl (shown as ⌘ on a Mac). */
const SHORTCUTS: { title: Key; rows: { keys: string; label: Key }[] }[] = [
  {
    title: 'scGeneral',
    rows: [
      { keys: 'Ctrl K', label: 'scSearch' },
      { keys: 'Alt N', label: 'newPage' },
      { keys: 'Alt T', label: 'todayPage' },
      { keys: 'Alt Q', label: 'capture' },
      { keys: 'Alt M', label: 'tasks' },
      { keys: 'Ctrl \\', label: 'scSidebar' },
      { keys: 'Ctrl /', label: 'shortcuts' },
      { keys: 'Ctrl Z', label: 'undo' },
      { keys: 'Ctrl Y', label: 'redo' },
      { keys: 'Alt ←', label: 'back' },
    ],
  },
  {
    title: 'scWriting',
    rows: [
      { keys: '/', label: 'scSlash' },
      { keys: 'Ctrl B', label: 'scBold' },
      { keys: 'Ctrl I', label: 'scItalic' },
      { keys: 'Ctrl U', label: 'scUnderline' },
      { keys: 'Ctrl Shift S', label: 'scStrike' },
      { keys: 'Ctrl E', label: 'scCode' },
      { keys: '# ␣', label: 'scHeading' },
      { keys: '- ␣', label: 'scBullet' },
      { keys: '[] ␣', label: 'scTask' },
      { keys: 'Tab', label: 'scIndent' },
    ],
  },
]

export function ShortcutsDialog() {
  const open = useStore((s) => s.modal === 'shortcuts')
  const close = useStore((s) => s.closeModal)
  const show = (keys: string) => (mac() ? keys.replace('Ctrl', '⌘') : keys)
  // Option+letter types a character on a Mac, so those shortcuts are not offered there
  const usable = (keys: string) => !(mac() && keys.startsWith('Alt ') && keys !== 'Alt ←')
  return (
    <Modal open={open} onClose={close} title={t('shortcuts')} width={640}>
      <div className="shortcuts">
        {SHORTCUTS.map((g) => (
          <section key={g.title}>
            <h3 className="set-head">{t(g.title)}</h3>
            {g.rows.filter((r) => usable(r.keys)).map((r) => (
              <div key={r.keys} className="shortcut-row">
                <span>{t(r.label)}</span>
                <span className="shortcut-keys" dir="ltr">
                  {show(r.keys)
                    .split(' ')
                    .map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}
