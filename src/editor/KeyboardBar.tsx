import { useEditorState, type Editor } from '@tiptap/react'
import {
  Bold,
  IndentDecrease,
  IndentIncrease,
  Italic,
  KeyboardOff,
  List,
  ListChecks,
  Palette,
  Plus,
  Redo2,
  Sparkles,
  Type,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { openAi } from '../ai/aiBus'
import { Popover } from '../ui/Popover'
import { ColorMenu } from './ColorMenu'
import { TurnIntoMenu } from './TurnIntoMenu'

/** Formatting bar that sits on top of the phone keyboard while writing. */
export function KeyboardBar({ editor }: { editor: Editor }) {
  const [bottom, setBottom] = useState(0)
  const [panel, setPanel] = useState<null | 'turn' | 'color'>(null)
  const turnRef = useRef<HTMLButtonElement>(null)
  const colorRef = useRef<HTMLButtonElement>(null)

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      focused: e.isFocused,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      task: e.isActive('taskList'),
      bullet: e.isActive('bulletList'),
      inList: e.isActive('listItem') || e.isActive('taskItem'),
    }),
  })

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  const [visible, setVisible] = useState(false)
  useEffect(() => {
    // Keep the bar while a panel from it is open
    if (st.focused) setVisible(true)
    else if (!panel) {
      const id = setTimeout(() => setVisible(false), 120)
      return () => clearTimeout(id)
    }
  }, [st.focused, panel])

  if (!visible) return null
  const listItemType = editor.isActive('taskItem') ? 'taskItem' : 'listItem'
  const keep = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault()

  return (
    <div className="kb-bar" style={{ bottom }} onMouseDown={keep} onPointerDown={keep}>
      <div className="kb-scroll">
        <button
          type="button"
          className="kb-btn"
          title={t('insert')}
          onClick={() => {
            const { $from } = editor.state.selection
            const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset)
            editor.chain().focus().insertContent(before === '' || before === ' ' ? '/' : ' /').run()
          }}
        >
          <Plus size={20} />
        </button>
        <button type="button" ref={turnRef} className="kb-btn" title={t('turnInto')} onClick={() => setPanel('turn')}>
          <Type size={19} />
        </button>
        <button type="button" className={'kb-btn' + (st.task ? ' is-on' : '')} title={t('bTask')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <ListChecks size={19} />
        </button>
        <button type="button" className={'kb-btn' + (st.bullet ? ' is-on' : '')} title={t('bBullet')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={19} />
        </button>
        <button type="button" className={'kb-btn' + (st.bold ? ' is-on' : '')} title={t('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={18} />
        </button>
        <button type="button" className={'kb-btn' + (st.italic ? ' is-on' : '')} title={t('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={18} />
        </button>
        <button type="button" ref={colorRef} className="kb-btn" title={t('color')} onClick={() => setPanel('color')}>
          <Palette size={19} />
        </button>
        <button type="button" className="kb-btn" title={t('aiMenu')} onClick={() => openAi(editor)}>
          <Sparkles size={19} />
        </button>
        <button type="button" className="kb-btn" title={t('indent')} disabled={!st.inList} onClick={() => editor.chain().focus().sinkListItem(listItemType).run()}>
          <IndentIncrease size={19} className="flip-rtl" />
        </button>
        <button type="button" className="kb-btn" title={t('outdent')} disabled={!st.inList} onClick={() => editor.chain().focus().liftListItem(listItemType).run()}>
          <IndentDecrease size={19} className="flip-rtl" />
        </button>
        <button type="button" className="kb-btn" title={t('undo')} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={19} className="flip-rtl" />
        </button>
        <button type="button" className="kb-btn" title={t('redo')} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={19} className="flip-rtl" />
        </button>
      </div>
      <button type="button" className="kb-btn kb-hide" title={t('hideKeyboard')} onClick={() => editor.commands.blur()}>
        <KeyboardOff size={19} />
      </button>
      <Popover anchor={turnRef.current} open={panel === 'turn'} onClose={() => setPanel(null)} sheet>
        <TurnIntoMenu editor={editor} onDone={() => setPanel(null)} />
      </Popover>
      <Popover anchor={colorRef.current} open={panel === 'color'} onClose={() => setPanel(null)} sheet>
        <ColorMenu editor={editor} onDone={() => setPanel(null)} />
      </Popover>
    </div>
  )
}
