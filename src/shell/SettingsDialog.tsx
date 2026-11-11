import { useState, useEffect } from 'react'
import { useStore, ws, type Settings } from '../data/store'
import { t } from '../lib/i18n'
import { Modal } from '../ui/Modal'
import { AccountSection } from '../sync/AccountSection'
import { DataSection } from './DataSection'
import { promptInstall, useInstall } from '../data/install'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  allowBackground,
  allowExactAlarms,
  notificationState,
  openAppSettings,
  reminderHealth,
  requestNotifications,
  testNotification,
  type NotifyState,
} from '../data/reminders'
import type { ReminderHealth } from '../lib/platform'

export type SettingsTab = 'general' | 'account' | 'ai' | 'data'
type Tab = SettingsTab

let requestedTab: Tab | null = null
/** Open the settings on a given tab (e.g. "Sign in" buttons go straight to the account tab). */
export function openSettingsAt(tab: Tab) {
  requestedTab = tab
  useStore.getState().openModal('settings')
}
window.addEventListener('qirtas:settings', (e) => openSettingsAt(((e as CustomEvent).detail as Tab) ?? 'general'))

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
  const installable = useInstall((s) => s.available)
  const [tab, setTab] = useState<Tab>('general')
  const set = (patch: Partial<Settings>) => setSettings(patch)
  useEffect(() => {
    if (open && requestedTab) {
      setTab(requestedTab)
      requestedTab = null
    }
  }, [open])

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
              <Row label={t('spellcheck')} desc={t('spellcheckDesc')}>
                <input type="checkbox" className="switch" checked={settings.spellcheck} onChange={(e) => set({ spellcheck: e.target.checked })} />
              </Row>
              <NotificationsRow />
              {installable && (
                <Row label={t('installApp')} desc={t('installAppDesc')}>
                  <button type="button" className="btn btn-small" onClick={() => void promptInstall()}>
                    {t('install')}
                  </button>
                </Row>
              )}
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
          {tab === 'data' && <DataSection />}
        </div>
      </div>
    </Modal>
  )
}

/** Calls `fn` now and every time the app comes back (e.g. from the system settings). */
function useOnReturn(fn: () => void) {
  useEffect(() => {
    fn()
    const on = () => document.visibilityState === 'visible' && fn()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function NotificationsRow() {
  const [state, setState] = useState<NotifyState | null>(null)
  useOnReturn(() => void notificationState().then(setState))
  if (!state || state === 'none') return null
  return (
    <>
      <Row label={t('notifications')} desc={state === 'denied' ? t('notificationsBlocked') : t('notificationsDesc')}>
        {state === 'granted' ? (
          <span className="set-inline">
            <span className="set-ok">{t('notificationsOn')}</span>
            <button type="button" className="btn btn-small" onClick={() => void testNotification()}>
              {t('notificationsTest')}
            </button>
          </span>
        ) : state === 'ask' ? (
          <button type="button" className="btn btn-small" onClick={() => void requestNotifications().then(setState)}>
            {t('notificationsAllow')}
          </button>
        ) : null}
      </Row>
      <ReminderHealthView />
    </>
  )
}

/** Phones that stop closed apps to save battery unless told otherwise. */
const STRICT_MAKERS = /oneplus|oppo|realme|xiaomi|redmi|poco|vivo|iqoo|huawei|honor|samsung|meizu|asus|nothing|tecno|infinix/i

/** Android: what keeps reminders from arriving on time with the app closed, each with its fix. */
function ReminderHealthView() {
  const [h, setH] = useState<ReminderHealth | null>(null)
  useOnReturn(() => void reminderHealth().then(setH))
  if (!h) return null
  const checks = [
    { ok: h.notifications, label: t('rhNotifications'), fix: () => void openAppSettings() },
    { ok: h.exact, label: t('rhExact'), fix: () => void allowExactAlarms() },
    { ok: h.battery && !h.restricted, label: t('rhBattery'), fix: () => void (h.restricted ? openAppSettings() : allowBackground()) },
  ]
  return (
    <div className="rem-health">
      <div className="rem-health-title">{t('rhTitle')}</div>
      <ul>
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? 'is-ok' : 'is-bad'}>
            {c.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{c.label}</span>
            {!c.ok && (
              <button type="button" className="btn btn-small" onClick={c.fix}>
                {t('rhFix')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {STRICT_MAKERS.test(h.maker) && (
        <p className="set-desc rem-health-note">
          {t('rhMaker', { maker: h.maker.charAt(0).toUpperCase() + h.maker.slice(1) })}{' '}
          <button type="button" className="link-btn" onClick={() => void openAppSettings()}>
            {t('rhAppInfo')}
          </button>
        </p>
      )}
      <div className="rem-health-test">
        <span className="set-desc">{t('rhTestHint')}</span>
        <button type="button" className="btn btn-small" onClick={() => void testNotification(60)}>
          {t('rhTestLater')}
        </button>
      </div>
    </div>
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
