import { create } from 'zustand'

interface PickerState {
  onPick: ((id: string) => void) | null
  title: string
  excludeId: string | null
  allowRoot: boolean
}

export const usePicker = create<PickerState>(() => ({ onPick: null, title: '', excludeId: null, allowRoot: false }))

export function requestPagePicker(onPick: (id: string) => void, opts: { title?: string; excludeId?: string; allowRoot?: boolean } = {}) {
  usePicker.setState({ onPick, title: opts.title ?? '', excludeId: opts.excludeId ?? null, allowRoot: !!opts.allowRoot })
}

export function closePagePicker() {
  usePicker.setState({ onPick: null })
}
