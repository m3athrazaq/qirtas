import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { buildBackup, restoreBackup } from '../data/backup'
import { resetDocs } from '../data/docs'
import { wipeAll } from '../data/idb'
import { useStore, ws, type Settings } from '../data/store'
import { pickFile } from '../data/assets'
import { t } from '../lib/i18n'
import { saveFile } from '../lib/platform'
import { Modal } from '../ui/Modal'
import { askConfirm, askText } from '../ui/dialogs'
import { AccountSection } from '../sync/AccountSection'

type Tab = 'general' | 'account' | 'ai' | 'data'

export const APP_VERSION = '1.0.0'

function Seg<T extends string | number | boolean>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button type="button" key={String(o.v)} className={value === o.v ? 'is-on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsDialog() {
  const open = useStore((s) => s.modal === 'settings')
  const close = useStore((s) => s.closeModal)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const wsName = useStore((s) => s.wsName)
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<Tab>('general')
  const set = (patch: Partial<Settings>) => setSettings(patch)

  return (
    <Modal open={open} onClose={close} title={t('settingsTitle')} width={640} className="settings-modal">
      <div className="settings">
        <div className="settings-tabs" role="tablist">
          {(
            [
              ['general', t('sGeneral')],
              ['account', t('sAccount')],
              ['ai', t('sAi')],
              ['data', t('sData')],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button type="button" role="tab" key={k} aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="settings-body">
          {tab === 'general' && (
            <>
              <Row label={t('language')}>
                <Seg
                  value={settings.lang}
                  options={[
                    { v: 'ar', label: 'العربية' },
                    { v: 'en', label: 'English' },
                  ]}
                  onChange={(lang) => set({ lang, numerals: lang === 'en' ? 'latn' : settings.numerals })}
                />
              </Row>
              <Row label={t('theme')}>
                <Seg
                  value={settings.theme}
                  options={[
                    { v: 'light', label: t('themeLight') },
                    { v: 'dark', label: t('themeDark') },
                    { v: 'system', label: t('themeSystem') },
                  ]}
                  onChange={(theme) => set({ theme })}
                />
              </Row>
              <Row label={t('defaultCalendar')}>
                <Seg
                  value={settings.calendar}
                  options={[
                    { v: 'hijri', label: t('hijri') },
                    { v: 'gregorian', label: t('gregorian') },
                  ]}
                  onChange={(calendar) => set({ calendar })}
                />
              </Row>
              <Row label={t('numerals')}>
                <Seg
                  value={settings.numerals}
                  options={[
                    { v: 'arab', label: '١٢٣' },
                    { v: 'latn', label: '123' },
                  ]}
                  onChange={(numerals) => set({ numerals })}
                />
              </Row>
              <Row label={t('weekStart')}>
                <Seg
                  value={settings.weekStart}
                  options={[
                    { v: 0, label: settings.lang === 'ar' ? 'الأحد' : 'Sunday' },
                    { v: 6, label: settings.lang === 'ar' ? 'السبت' : 'Saturday' },
                    { v: 1, label: settings.lang === 'ar' ? 'الاثنين' : 'Monday' },
                  ]}
                  onChange={(weekStart) => set({ weekStart })}
                />
              </Row>
              <Row label={t('marginLine')} desc={t('marginLineDesc')}>
                <input type="checkbox" className="switch" checked={settings.marginLine} onChange={(e) => set({ marginLine: e.target.checked })} />
              </Row>
              <Row label={t('yourName')}>
                <input className="input" dir="auto" value={settings.userName} onChange={(e) => set({ userName: e.target.value })} />
              </Row>
              <Row label={t('workspaceName')}>
                <input
                  className="input"
                  dir="auto"
                  defaultValue={wsName}
                  placeholder={t('appName')}
                  onBlur={(e) => {
                    ws().setName(e.target.value.trim())
                    useStore.setState({ wsName: e.target.value.trim() })
                  }}
                />
              </Row>
            </>
          )}
          {tab === 'account' && <AccountSection />}
          {tab === 'ai' && (
            <>
              <Row label={t('aiKey')} desc={t('aiKeyDesc')}>
                <input className="input" type="password" dir="ltr" autoComplete="off" placeholder="sk-ant-…" value={settings.aiKey} onChange={(e) => set({ aiKey: e.target.value.trim() })} />
              </Row>
              <Row label={t('aiModel')}>
                <Seg
                  value={settings.aiModel}
                  options={[
                    { v: 'smart', label: t('aiModelSmart') },
                    { v: 'fast', label: t('aiModelFast') },
                  ]}
                  onChange={(aiModel) => set({ aiModel })}
                />
              </Row>
            </>
          )}
          {tab === 'data' && (
            <>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const json = await buildBackup()
                    const d = new Date().toISOString().slice(0, 10)
                    await saveFile(`qirtas-backup-${d}.json`, json, 'application/json')
                    toast(t('backupDone'))
                  }}
                >
                  <Download size={15} /> {t('backupExport')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const f = await pickFile('application/json,.json')
                    if (!f || !(await askConfirm(t('restoreConfirm')))) return
                    try {
                      await restoreBackup(await f.text())
                      toast(t('restoreDone'))
                    } catch (err) {
                      toast(String(err))
                    }
                  }}
                >
                  <Upload size={15} /> {t('backupImport')}
                </button>
              </div>
              <div className="danger-zone">
                <button
                  type="button"
                  className="btn is-danger"
                  onClick={async () => {
                    const word = await askText(t('wipeConfirm'), { requireText: t('wipeWord'), danger: true, confirmLabel: t('delete') })
                    if (word?.trim() !== t('wipeWord')) return
                    resetDocs()
                    await wipeAll()
                    localStorage.clear()
                    location.hash = ''
                    location.reload()
                  }}
                >
                  {t('wipe')}
                </button>
              </div>
              <p className="muted small">
                {t('version')} {APP_VERSION}
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}
