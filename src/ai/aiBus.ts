import type { Editor, Range } from '@tiptap/core'
import { create } from 'zustand'

export type AiAction =
  | 'continue'
  | 'summarize'
  | 'fix'
  | 'fusha'
  | 'toEnglish'
  | 'toArabic'
  | 'shorter'
  | 'longer'
  | 'tasks'
  | 'custom'

interface AiState {
  editor: Editor | null
  /** document range the request is about (selection or whole page) */
  from: number
  to: number
  action: AiAction | null
  prompt: string
  voice: boolean
}

export const useAi = create<AiState>(() => ({ editor: null, from: 0, to: 0, action: null, prompt: '', voice: false }))

export function openAi(editor: Editor, opts: { range?: Range; action?: AiAction } = {}) {
  if (opts.range) editor.chain().focus().deleteRange(opts.range).run()
  const { from, to } = editor.state.selection
  useAi.setState({ editor, from, to, action: opts.action ?? null, prompt: '', voice: false })
}

export function openVoice(editor: Editor, range?: Range) {
  if (range) editor.chain().focus().deleteRange(range).run()
  const { from } = editor.state.selection
  useAi.setState({ editor, from, to: from, action: null, prompt: '', voice: true })
}

export function closeAi() {
  useAi.setState({ editor: null, action: null, voice: false, prompt: '' })
}
