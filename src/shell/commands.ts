// The commands offered in search (Ctrl+K): the things the app can do, findable by name.
import { runAction } from '../data/actions'
import { downloadBackup } from '../data/autobackup'
import { canInstall, promptInstall } from '../data/install'
import { useStore } from '../data/store'
import { matchScore } from '../lib/arabic'
import { t, type Key } from '../lib/i18n'

export interface Command {
  id: string
  label: string
  /** Shown at the end of the row. */
  keys?: string
  run: () => void
}

const mac = () => /Mac|iPhone|iPad/.test(navigator.platform)

/** Every command that makes sense right now, most used first. */
export function listCommands(): Command[] {
  const st = useStore.getState()
  const canEdit = st.wsRole !== 'viewer'
  const page = st.route.name === 'page' ? st.pages[st.route.id] : undefined
  const alt = (k: string) => (mac() ? undefined : `Alt ${k}`)
  const cmd = (id: string, label: Key, run: () => void, keys?: string): Command => ({ id, label: t(label), run, keys })
  const out: (Command | false | undefined)[] = [
    canEdit && cmd('new', 'newPage', () => runAction('new'), alt('N')),
    cmd('today', 'todayPage', () => runAction('today'), alt('T')),
    canEdit && cmd('capture', 'capture', () => runAction('capture'), alt('Q')),
    cmd('tasks', 'tasks', () => runAction('tasks'), alt('M')),
    canEdit && cmd('templates', 'templates', () => st.openModal('templates')),
    page && page.type !== 'database' && cmd('history', 'history', () => st.openHistory(page.id)),
    cmd('backup', 'backupExport', () =>
      void downloadBackup()
        .then((info) => useStore.getState().toast(info.partial ? t('bkPartial') : t('backupDone')))
        .catch((err) => useStore.getState().toast(t('rsFailed', { msg: String((err as Error).message) }))),
    ),
    cmd('theme', st.settings.theme === 'dark' ? 'cmdLight' : 'cmdDark', () => st.setSettings({ theme: st.settings.theme === 'dark' ? 'light' : 'dark' })),
    cmd('shortcuts', 'shortcuts', () => st.openModal('shortcuts'), mac() ? '⌘ /' : 'Ctrl /'),
    cmd('share', 'share', () => st.openModal('share')),
    cmd('trash', 'trash', () => st.openModal('trash')),
    cmd('settings', 'settings', () => st.openModal('settings')),
    canInstall() && cmd('install', 'installApp', () => void promptInstall()),
  ]
  return out.filter((c): c is Command => !!c)
}

/** Commands whose name matches what was typed, best first. */
export function findCommands(query: string): Command[] {
  const q = query.replace(/^>\s*/, '').trim()
  const all = listCommands()
  if (!q) return all
  return all
    .map((c) => ({ c, score: matchScore(c.label, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c)
}
