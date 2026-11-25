// Opening the verse picker (QuranDialog) from the editor.
import { create } from 'zustand'
import type { VerseRef } from './quran'

export type QuranPick = (ref: VerseRef, verses: string[]) => void

interface QuranPickState {
  onPick: QuranPick | null
  /** When changing a quotation: the verses it has now. */
  initial: VerseRef | null
}

export const useQuranPick = create<QuranPickState>(() => ({ onPick: null, initial: null }))

export function requestQuran(onPick: QuranPick, initial?: VerseRef | null) {
  useQuranPick.setState({ onPick, initial: initial ?? null })
}

export function closeQuran() {
  useQuranPick.setState({ onPick: null, initial: null })
}
