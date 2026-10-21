import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { marked } from 'marked'
import { ArrowUp, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openSettingsAt } from '../shell/SettingsDialog'
import { markdownToJson } from '../lib/exporter'
import { t } from '../lib/i18n'
import { Popover } from '../ui/Popover'
import { AI_ACTIONS } from './AiActionsMenu'
import { closeAi, useAi, type AiAction } from './aiBus'
import { AiError, buildPrompt, streamAi } from './client'
import { VoicePanel } from './VoicePanel'

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((el) => {
    ;[...el.attributes].forEach((a) => {
      if (a.name.startsWith('on') || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name)
    })
  })
  return doc.body.innerHTML
}

export function selectionMarkdown(editor: Editor, from: number, to: number): string {
  try {
    if (from === to) return ''
    const slice = editor.state.doc.slice(from, to)
    const json: JSONContent = { type: 'doc', content: slice.content.toJSON() ?? [] }
    // A selection inside one paragraph comes back as inline nodes: wrap them
    if (json.content?.length && json.content.every((n) => n.type === 'text' || n.type === 'hardBreak')) json.content = [{ type: 'paragraph', content: json.content }]
    return editor.markdown?.serialize(json) ?? editor.state.doc.textBetween(from, to, '\n')
  } catch {
    return editor.state.doc.textBetween(from, to, '\n')
  }
}

export function insertMarkdown(editor: Editor, markdown: string, from: number, to: number, replace: boolean) {
  const json = markdownToJson(markdown)
  let nodes = json.content ?? []
  if (!nodes.length) return
  const $from = editor.state.doc.resolve(from)
  const $to = editor.state.doc.resolve(to)
  const sameBlock = $from.sameParent($to) && $from.parent.isTextblock
  if (replace && from < to) {
    if (sameBlock && nodes.length === 1 && nodes[0].type === 'paragraph') nodes = nodes[0].content ?? []
    editor.chain().focus().insertContentAt({ from, to }, nodes).run()
  } else {
    const after = $to.depth >= 1 ? $to.after(1) : to
    editor.chain().focus().insertContentAt(after, nodes).run()
  }
}

export function AiPanel() {
  const { editor, from, to, action, voice } = useAi()
  if (!editor || editor.isDestroyed) return null
  if (voice) return <VoicePanel editor={editor} at={from} />
  return <AiPanelInner key={`${from}:${to}`} editor={editor} from={from} to={to} initial={action} />
}

function AiPanelInner({ editor, from, to, initial }: { editor: Editor; from: number; to: number; initial: AiAction | null }) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{ action: AiAction; custom?: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const hasSelection = from < to

  const anchor = useMemo(() => {
    try {
      const c = editor.view.coordsAtPos(Math.min(to, editor.state.doc.content.size))
      const rect = new DOMRect(c.left, c.top, Math.max(1, c.right - c.left), c.bottom - c.top)
      return { getBoundingClientRect: () => rect }
    } catch {
      return null
    }
  }, [editor, to])

  const run = useCallback(
    async (action: AiAction, custom?: string) => {
      abort.current?.abort()
      const ctrl = new AbortController()
      abort.current = ctrl
      setLast({ action, custom })
      setError(null)
      setResult('')
      setRunning(true)
      let source = hasSelection ? selectionMarkdown(editor, from, to) : ''
      if (!source) {
        // No selection: the page so far (for "continue" only the text before the cursor)
        const all = action === 'continue' ? editor.state.doc.textBetween(0, from, '\n') : editor.markdown?.serialize(editor.getJSON()) ?? editor.getText()
        source = all.slice(-12000)
      }
      try {
        const out = await streamAi(buildPrompt(action, source, custom), setResult, ctrl.signal)
        setResult(out)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        if (e instanceof AiError && e.code === 'nokey') setError(t('aiNoKey'))
        else if (e instanceof AiError && e.code === 'quota') setError(t('aiQuota'))
        else setError(t('aiError', { msg: (e as Error).message }))
      } finally {
        setRunning(false)
      }
    },
    [editor, from, to, hasSelection],
  )

  useEffect(() => {
    if (initial) void run(initial)
    return () => abort.current?.abort()
  }, [initial, run])

  const html = useMemo(() => (result ? sanitize(marked.parse(result, { async: false }) as string) : ''), [result])
  const close = () => {
    abort.current?.abort()
    closeAi()
  }
  const canReplace = hasSelection && last && last.action !== 'continue' && last.action !== 'summarize' && last.action !== 'tasks'

  return (
    <Popover anchor={anchor} open onClose={close} placement="bottom-start" sheet width={460} className="ai-pop">
      <div className="ai-panel">
        {!last && (
          <>
            <form
              className="ai-ask"
              onSubmit={(e) => {
                e.preventDefault()
                if (prompt.trim()) void run('custom', prompt.trim())
              }}
            >
              <Sparkles size={16} className="ai-spark" />
              <input autoFocus dir="auto" value={prompt} placeholder={t('aiAsk')} onChange={(e) => setPrompt(e.target.value)} />
              <button type="submit" className="icon-btn ai-send" disabled={!prompt.trim()} aria-label={t('aiAsk')}>
                <ArrowUp size={16} />
              </button>
            </form>
            <div className="menu-list ai-actions">
              {AI_ACTIONS.filter((a) => hasSelection || !['fix', 'fusha', 'shorter', 'longer', 'toEnglish', 'toArabic'].includes(a.action)).map(({ action, label, icon: Icon }) => (
                <button type="button" key={action} className="menu-item" onClick={() => void run(action)}>
                  <span className="menu-icon">
                    <Icon size={15} />
                  </span>
                  <span className="menu-label">{t(label)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {last && (
          <div className="ai-result">
            {error ? (
              <div className="ai-error">
                <p>{error}</p>
                {error === t('aiNoKey') && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      close()
                      openSettingsAt('ai')
                    }}
                  >
                    {t('settings')}
                  </button>
                )}
              </div>
            ) : (
              <div className="ai-text prose-preview" dir="auto" dangerouslySetInnerHTML={{ __html: html || `<p class="muted">${t('aiThinking')}</p>` }} />
            )}
            <div className="ai-buttons">
              {running && (
                <span className="muted ai-status">
                  <Loader2 size={14} className="spin" /> {t('aiThinking')}
                </span>
              )}
              {!running && result && (
                <>
                  {canReplace && (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => {
                        insertMarkdown(editor, result, from, to, true)
                        closeAi()
                      }}
                    >
                      {t('aiReplace')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={'btn btn-small' + (canReplace ? '' : ' btn-primary')}
                    onClick={() => {
                      insertMarkdown(editor, result, from, to, false)
                      closeAi()
                    }}
                  >
                    {t('aiInsertBelow')}
                  </button>
                </>
              )}
              {!running && (
                <button type="button" className="btn-text" onClick={() => last && void run(last.action, last.custom)}>
                  <RotateCcw size={14} /> {t('aiRetry')}
                </button>
              )}
              <button type="button" className="btn-text" onClick={close}>
                <X size={14} /> {t('aiDiscard')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Popover>
  )
}
