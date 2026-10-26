import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, ChevronDown, Code, Italic, Link as LinkIcon, Sparkles, Strikethrough, Underline, X } from 'lucide-react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { Popover } from '../ui/Popover'
import { AiActionsMenu } from '../ai/AiActionsMenu'
import { ColorMenu } from './ColorMenu'
import { KINDS, TurnIntoMenu } from './TurnIntoMenu'
import { activeKind } from './actions'

export const BubbleToolbar = memo(function BubbleToolbar({ editor }: { editor: Editor }) {
  const isMobile = useStore((s) => s.isMobile)
  const [panel, setPanel] = useState<null | 'turn' | 'color' | 'link' | 'ai'>(null)
  const [href, setHref] = useState('')
  const turnRef = useRef<HTMLButtonElement>(null)
  const colorRef = useRef<HTMLButtonElement>(null)
  const aiRef = useRef<HTMLButtonElement>(null)

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      kind: activeKind(e),
      color: e.getAttributes('textStyle').color as string | undefined,
    }),
  })
  const kindLabel = KINDS.find((k) => k.kind === st.kind)?.label ?? 'bText'
  const options = useMemo(() => ({ placement: (isMobile ? 'bottom' : 'top') as 'bottom' | 'top', offset: 10, flip: true, shift: { padding: 8 } }), [isMobile])
  const shouldShow = useCallback(({ editor: e, state }: { editor: Editor; state: Editor['state'] }) => {
    if (!e.isEditable || state.selection.empty) return false
    if (state.selection instanceof NodeSelection) return false
    // Whole rows/columns picked from the table handles have their own menu
    if (state.selection instanceof CellSelection) return false
    if (e.isActive('codeBlock')) return false
    return true
  }, [])

  return (
    <BubbleMenu
      editor={editor}
      options={options}
      shouldShow={shouldShow}
    >
      <div className="toolbar" onMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
        {panel === 'link' ? (
          <form
            className="link-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (href.trim()) editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
              setPanel(null)
            }}
          >
            <input autoFocus value={href} dir="ltr" placeholder={t('linkPlaceholder')} onChange={(e) => setHref(e.target.value)} />
            {st.link && (
              <button
                type="button"
                className="tb-btn"
                title={t('removeLink')}
                onClick={() => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run()
                  setPanel(null)
                }}
              >
                <X size={16} />
              </button>
            )}
          </form>
        ) : (
          <>
            <button type="button" ref={turnRef} className="tb-btn tb-wide" onClick={() => setPanel(panel === 'turn' ? null : 'turn')}>
              {t(kindLabel)} <ChevronDown size={14} />
            </button>
            <span className="tb-sep" />
            <button type="button" className={'tb-btn' + (st.bold ? ' is-on' : '')} title={t('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold size={16} />
            </button>
            <button type="button" className={'tb-btn' + (st.italic ? ' is-on' : '')} title={t('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic size={16} />
            </button>
            <button type="button" className={'tb-btn' + (st.underline ? ' is-on' : '')} title={t('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <Underline size={16} />
            </button>
            <button type="button" className={'tb-btn' + (st.strike ? ' is-on' : '')} title={t('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
              <Strikethrough size={16} />
            </button>
            <button type="button" className={'tb-btn' + (st.code ? ' is-on' : '')} title={t('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
              <Code size={16} />
            </button>
            <button
              type="button"
              className={'tb-btn' + (st.link ? ' is-on' : '')}
              title={t('link')}
              onClick={() => {
                setHref(editor.getAttributes('link').href ?? '')
                setPanel('link')
              }}
            >
              <LinkIcon size={16} />
            </button>
            <button type="button" ref={colorRef} className="tb-btn" title={t('color')} onClick={() => setPanel(panel === 'color' ? null : 'color')}>
              <span className="tb-color" style={{ color: st.color || 'inherit' }}>
                A
              </span>
              <ChevronDown size={12} />
            </button>
            <span className="tb-sep" />
            <button type="button" ref={aiRef} className="tb-btn tb-ai" onClick={() => setPanel(panel === 'ai' ? null : 'ai')}>
              <Sparkles size={15} /> {t('aiMenu')}
            </button>
          </>
        )}
      </div>
      <Popover anchor={turnRef.current} open={panel === 'turn'} onClose={() => setPanel(null)} sheet>
        <TurnIntoMenu editor={editor} onDone={() => setPanel(null)} />
      </Popover>
      <Popover anchor={colorRef.current} open={panel === 'color'} onClose={() => setPanel(null)} sheet>
        <ColorMenu editor={editor} onDone={() => setPanel(null)} />
      </Popover>
      <Popover anchor={aiRef.current} open={panel === 'ai'} onClose={() => setPanel(null)} sheet>
        <AiActionsMenu editor={editor} onDone={() => setPanel(null)} />
      </Popover>
    </BubbleMenu>
  )
})
