import { offset } from '@floating-ui/dom'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { ChevronLeft, ChevronRight, Copy, Database, GripVertical, Palette, Plus, Repeat2, Sparkles, Trash2 } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { openAi } from '../ai/aiBus'
import { MenuItem, MenuSep, Popover } from '../ui/Popover'
import { deleteBlock, duplicateBlock, isListNode, listToDatabase, selectBlock } from './actions'
import { BlockColorMenu } from './ColorMenu'
import { TurnIntoMenu } from './TurnIntoMenu'

const TEXTUAL = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList', 'callout', 'details', 'codeBlock'])

export const BlockHandle = memo(function BlockHandle({ editor }: { editor: Editor }) {
  const lang = useStore((s) => s.settings.lang)
  const rtl = lang === 'ar'
  const current = useRef<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 })
  const [menu, setMenu] = useState<null | 'main' | 'turn' | 'color'>(null)
  const gripRef = useRef<HTMLButtonElement>(null)
  const [snapshot, setSnapshot] = useState<{ node: PMNode; pos: number } | null>(null)
  const Sub = rtl ? ChevronLeft : ChevronRight
  // Stable objects: a new one on every render would re-create the handle and hide it
  const positionConfig = useMemo(() => ({ placement: (rtl ? 'right-start' : 'left-start') as 'right-start' | 'left-start', strategy: 'absolute' as const, middleware: [offset(14)] }), [rtl])
  const nested = useMemo(() => ({ edgeDetection: (rtl ? 'right' : 'left') as 'right' | 'left' }), [rtl])

  const addBelow = () => {
    const { node, pos } = current.current
    if (!node) return
    const isItem = node.type.name === 'listItem' || node.type.name === 'taskItem'
    const at = pos + node.nodeSize
    const content = isItem
      ? { type: node.type.name, content: [{ type: 'paragraph', content: [{ type: 'text', text: '/' }] }] }
      : { type: 'paragraph', content: [{ type: 'text', text: '/' }] }
    editor
      .chain()
      .insertContentAt(at, content)
      .setTextSelection(at + (isItem ? 3 : 2))
      .focus()
      .run()
  }

  const openMenu = () => {
    const { node, pos } = current.current
    if (!node) return
    setSnapshot({ node, pos })
    selectBlock(editor, pos, node)
    setMenu('main')
  }

  const close = () => setMenu(null)
  const node = snapshot?.node ?? null
  const textual = !!node && TEXTUAL.has(node.type.name)
  // For a list item, "turn into database" applies to the whole list around it
  const listTarget = (() => {
    if (!snapshot) return null
    if (isListNode(snapshot.node)) return snapshot
    if (snapshot.node.type.name !== 'listItem' && snapshot.node.type.name !== 'taskItem') return null
    try {
      const $pos = editor.state.doc.resolve(snapshot.pos)
      const parent = $pos.parent
      if (!isListNode(parent) || $pos.depth < 1) return null
      return { node: parent, pos: $pos.before($pos.depth) }
    } catch {
      return null
    }
  })()

  return (
    <>
      <DragHandle
        editor={editor}
        nested={nested}
        computePositionConfig={positionConfig}
        onNodeChange={({ node: n, pos }) => {
          current.current = { node: n, pos }
        }}
      >
        <div className="block-handle" dir={rtl ? 'rtl' : 'ltr'}>
          <button type="button" className="bh-btn" title={t('addBlockBelow')} onClick={addBelow} onMouseDown={(e) => e.preventDefault()}>
            <Plus size={16} strokeWidth={1.8} />
          </button>
          <button type="button" ref={gripRef} className="bh-btn bh-grip" title={`${t('dragToMove')}\n${t('clickForMenu')}`} onClick={openMenu}>
            <GripVertical size={16} strokeWidth={1.8} />
          </button>
        </div>
      </DragHandle>

      <Popover anchor={gripRef.current} open={menu === 'main'} onClose={close} placement={rtl ? 'right-start' : 'left-start'} sheet>
        <div className="menu-list">
          {textual && <MenuItem icon={<Repeat2 size={16} />} label={t('turnInto')} trailing={<Sub size={14} />} onClick={() => setMenu('turn')} />}
          {textual && <MenuItem icon={<Palette size={16} />} label={t('color')} trailing={<Sub size={14} />} onClick={() => setMenu('color')} />}
          {listTarget && (
            <MenuItem
              icon={<Database size={16} />}
              label={t('convertToDatabase')}
              onClick={() => {
                listToDatabase(editor, listTarget.pos, listTarget.node)
                close()
              }}
            />
          )}
          {textual && (
            <MenuItem
              icon={<Sparkles size={16} />}
              label={t('bAi')}
              onClick={() => {
                close()
                openAi(editor)
              }}
            />
          )}
          <MenuItem
            icon={<Copy size={16} />}
            label={t('duplicate')}
            onClick={() => {
              if (snapshot) duplicateBlock(editor, snapshot.pos, snapshot.node)
              close()
            }}
          />
          <MenuSep />
          <MenuItem
            icon={<Trash2 size={16} />}
            label={t('delete')}
            danger
            onClick={() => {
              if (snapshot) deleteBlock(editor, snapshot.pos, snapshot.node)
              close()
            }}
          />
        </div>
      </Popover>
      <Popover anchor={gripRef.current} open={menu === 'turn'} onClose={close} placement={rtl ? 'right-start' : 'left-start'} sheet>
        <TurnIntoMenu editor={editor} onDone={close} />
      </Popover>
      <Popover anchor={gripRef.current} open={menu === 'color'} onClose={close} placement={rtl ? 'right-start' : 'left-start'} sheet>
        <BlockColorMenu
          onPick={(v) => {
            if (snapshot?.node.type.name === 'callout') {
              const color = v ? v.replace('_bg', '') : 'gray'
              editor.chain().focus().updateAttributes('callout', { color }).run()
            } else {
              editor.chain().focus().setBlockColor(v).run()
            }
            close()
          }}
        />
      </Popover>
    </>
  )
})
