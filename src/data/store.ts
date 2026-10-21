import { create } from 'zustand'
import { setLang, type Lang } from '../lib/i18n'
import type { PageMeta } from './types'
import type { Workspace } from './workspace'

export type Theme = 'light' | 'dark' | 'system'

export interface Settings {
  lang: Lang
  theme: Theme
  calendar: 'hijri' | 'gregorian'
  numerals: 'arab' | 'latn'
  weekStart: number
  marginLine: boolean
  userName: string
  aiKey: string
  aiModel: 'fast' | 'smart'
  sidebarWidth: number
}

const SETTINGS_KEY = 'qirtas.settings'

const defaultSettings: Settings = {
  lang: navigator.language?.startsWith('en') ? 'en' : 'ar',
  theme: 'system',
  calendar: 'hijri',
  numerals: 'arab',
  weekStart: 0,
  marginLine: true,
  userName: '',
  aiKey: '',
  aiModel: 'smart',
  sidebarWidth: 256,
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable */
  }
  return { ...defaultSettings, numerals: defaultSettings.lang === 'en' ? 'latn' : 'arab' }
}

export type Modal = null | 'search' | 'templates' | 'settings' | 'trash' | 'share'

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export type Route = { name: 'home' } | { name: 'page'; id: string } | { name: 'join'; token: string }

interface State {
  ready: boolean
  ws: Workspace | null
  wsName: string
  pages: Record<string, PageMeta>
  favorites: string[]
  route: Route
  sidebarOpen: boolean
  modal: Modal
  peek: string | null
  toasts: Toast[]
  settings: Settings
  isMobile: boolean
  syncStatus: 'local' | 'syncing' | 'synced' | 'offline'
  wsRole: 'owner' | 'editor' | 'viewer' | null
  setSettings: (patch: Partial<Settings>) => void
  openModal: (m: Modal) => void
  closeModal: () => void
  toast: (text: string, action?: Toast['action']) => void
  dismissToast: (id: number) => void
}

let toastId = 0

export const useStore = create<State>((set, get) => ({
  ready: false,
  ws: null,
  wsName: '',
  pages: {},
  favorites: [],
  route: { name: 'home' },
  sidebarOpen: true,
  modal: null,
  peek: null,
  toasts: [],
  settings: loadSettings(),
  isMobile: false,
  syncStatus: 'local',
  wsRole: null,
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* ignore */
    }
    setLang(settings.lang)
    set({ settings })
  },
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  toast: (text, action) => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, action }] })
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}))

setLang(useStore.getState().settings.lang)

export const ws = (): Workspace => {
  const w = useStore.getState().ws
  if (!w) throw new Error('workspace not ready')
  return w
}

/** Viewers of a shared workspace can read but not change anything. */
export function useCanEdit() {
  return useStore((s) => s.wsRole !== 'viewer')
}

export function useSettings() {
  return useStore((s) => s.settings)
}

/** Format options for dates based on current settings. */
export function useDateFmt() {
  const s = useStore((st) => st.settings)
  return { lang: s.lang, numerals: s.numerals } as const
}
