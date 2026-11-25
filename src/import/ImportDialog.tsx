// "Import from other apps": choose (or drop) the export of another app, see what is in it, bring it in.
import { CheckCircle2, FileUp, FolderOpen, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { navigate } from '../data/nav'
import { useStore } from '../data/store'
import { num } from '../lib/hijri'
import { t, type Key } from '../lib/i18n'
import { isNative } from '../lib/platform'
import { Modal } from '../ui/Modal'
import { planImport, runImport, sourceName, type ImportPlan, type ImportResult, type Source } from './importer'
import type { Picked } from './util'

type Step = { name: 'pick'; error?: string } | { name: 'reading' } | { name: 'ready'; plan: ImportPlan } | { name: 'importing'; done: number; total: number } | { name: 'done'; result: ImportResult; source: Source }

const SOURCES: { id: Source; mark: string; hint: Key }[] = [
  { id: 'notion', mark: 'N', hint: 'impHowNotion' },
  { id: 'obsidian', mark: '◆', hint: 'impHowObsidian' },
  { id: 'keep', mark: '💡', hint: 'impHowKeep' },
  { id: 'evernote', mark: '🐘', hint: 'impHowEvernote' },
  { id: 'files', mark: 'MD', hint: 'impHowFiles' },
]

/** The files of a dropped folder, with their paths inside it. */
async function droppedFiles(items: DataTransferItemList): Promise<Picked[]> {
  const out: Picked[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ file, path: prefix + entry.name })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // a folder is read in batches until one comes back empty
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const e of batch) await walk(e, prefix + entry.name + '/')
      }
    }
  }
  const entries = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  for (const e of entries) await walk(e, '')
  return out
}

export default function ImportDialog() {
  const close = useStore((s) => s.closeModal)
  const canEdit = useStore((s) => s.wsRole !== 'viewer')
  const numerals = useStore((s) => s.settings.numerals)
  const [step, setStep] = useState<Step>({ name: 'pick' })
  const [over, setOver] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)
  const n = (x: number) => num(x, numerals)
  const busy = step.name === 'reading' || step.name === 'importing'

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [step.name])

  const read = async (files: Picked[]) => {
    if (!files.length) return
    setStep({ name: 'reading' })
    try {
      setStep({ name: 'ready', plan: await planImport(files) })
    } catch (err) {
      const code = (err as Error).message
      setStep({ name: 'pick', error: t(code === 'bad_zip' ? 'impBadZip' : code === 'empty' || code === 'nothing' ? 'impNothing' : 'impFailed') })
    }
  }

  const start = async (plan: ImportPlan) => {
    setStep({ name: 'importing', done: 0, total: 1 })
    try {
      const result = await runImport(plan, (done, total) => setStep({ name: 'importing', done, total }))
      setStep({ name: 'done', result, source: plan.source })
    } catch {
      setStep({ name: 'pick', error: t('impFailed') })
    }
  }

  const onClose = () => !busy && close()

  return (
    <Modal open onClose={onClose} title={t('impTitle')} width={560} className="import-modal">
      <div className="imp-body">
        {!canEdit && <p className="imp-error">{t('impViewer')}</p>}

        {step.name === 'pick' && canEdit && (
          <>
            <p className="muted imp-intro">{t('impIntro')}</p>
            <ul className="imp-sources">
              {SOURCES.map((s) => (
                <li key={s.id} className="imp-source">
                  <span className={'imp-mark is-' + s.id} aria-hidden>
                    {s.mark}
                  </span>
                  <span className="imp-source-text">
                    <strong>{sourceName(s.id)}</strong>
                    <span className="muted small">{t(s.hint)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div
              className={'imp-drop' + (over ? ' is-over' : '')}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setOver(false)
                const items = e.dataTransfer.items
                if (items?.length && [...items].some((i) => i.webkitGetAsEntry?.()?.isDirectory)) void droppedFiles(items).then(read)
                else void read([...e.dataTransfer.files].map((file) => ({ file })))
              }}
            >
              <p className="muted small">{t('impDrop')}</p>
              <div className="imp-actions">
                <label className="btn btn-primary">
                  <FileUp size={15} /> {t('impChooseFiles')}
                  <input
                    type="file"
                    multiple
                    hidden
                    accept={isNative() ? undefined : '.zip,.md,.markdown,.txt,.html,.htm,.csv,.enex,.json'}
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])].map((file) => ({ file }))
                      e.target.value = ''
                      void read(files)
                    }}
                  />
                </label>
                {!isNative() && (
                  <label className="btn">
                    <FolderOpen size={15} /> {t('impChooseFolder')}
                    <input
                      ref={folderInput}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => {
                        const files = [...(e.target.files ?? [])].map((file) => ({ file }))
                        e.target.value = ''
                        void read(files)
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            {step.error && <p className="imp-error">{step.error}</p>}
          </>
        )}

        {step.name === 'reading' && (
          <div className="imp-wait">
            <Loader2 className="spin" size={22} />
            <span>{t('impReading')}</span>
          </div>
        )}

        {step.name === 'ready' && (
          <>
            <p className="imp-found">
              {t('impFound', {
                source: sourceName(step.plan.source),
                what: [
                  step.plan.counts.pages ? t('impNPages', { n: n(step.plan.counts.pages) }) : '',
                  step.plan.counts.databases ? t('impNTables', { n: n(step.plan.counts.databases), rows: n(step.plan.counts.rows) }) : '',
                  step.plan.counts.images ? t('impNImages', { n: n(step.plan.counts.images) }) : '',
                ]
                  .filter(Boolean)
                  .join('، '),
              })}
            </p>
            <ul className="imp-preview">
              {step.plan.pages.slice(0, 8).map((p) => (
                <li key={p.key}>
                  <span className="imp-icon">{p.icon || (p.db ? '▦' : '📄')}</span>
                  <span className="imp-title" dir="auto">
                    {p.title}
                  </span>
                  {p.children.length > 0 && <span className="muted small">+{n(p.children.length)}</span>}
                </li>
              ))}
              {step.plan.pages.length > 8 && <li className="muted small">{t('impMore', { n: n(step.plan.pages.length - 8) })}</li>}
            </ul>
            {step.plan.skipped.length > 0 && (
              <p className="muted small imp-skipped" dir="auto">
                {t('impSkipped', { n: n(step.plan.skipped.length), names: step.plan.skipped.slice(0, 3).map((p) => p.split('/').pop()).join('، ') + (step.plan.skipped.length > 3 ? '…' : '') })}
              </p>
            )}
            <p className="muted small">{t(step.plan.pages.length === 1 && !step.plan.pages[0].db ? 'impWhereOne' : 'impWhere')}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setStep({ name: 'pick' })}>
                {t('impBack')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void start(step.plan)}>
                {t('impStart')}
              </button>
            </div>
          </>
        )}

        {step.name === 'importing' && (
          <div className="imp-wait">
            <div className="tp-bar imp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={step.total} aria-valuenow={step.done}>
              <span style={{ width: `${step.total ? Math.round((100 * step.done) / step.total) : 0}%` }} />
            </div>
            <span>{t('impProgress', { done: n(step.done), total: n(step.total) })}</span>
          </div>
        )}

        {step.name === 'done' && (
          <>
            <p className="imp-done">
              <CheckCircle2 size={20} />
              <span>
                {t('impDone', {
                  what: [
                    step.result.pages ? t('impNPages', { n: n(step.result.pages) }) : '',
                    step.result.databases ? t('impNTables', { n: n(step.result.databases), rows: n(step.result.rows) }) : '',
                    step.result.images ? t('impNImages', { n: n(step.result.images) }) : '',
                  ]
                    .filter(Boolean)
                    .join('، '),
                })}
              </span>
            </p>
            {step.result.failed.length > 0 && <p className="imp-error">{t('impSomeFailed', { names: step.result.failed.slice(0, 4).join('، ') })}</p>}
            {step.result.missingImages > 0 && <p className="muted small">{t('impMissingImages', { n: n(step.result.missingImages) })}</p>}
            <p className="muted small">{t('impUndoHint')}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={close}>
                {t('close')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  close()
                  navigate(step.result.rootId)
                }}
              >
                {t('impOpen')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
