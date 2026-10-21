// Editor actions shared by the slash menu, block menu, toolbars and the mobile keyboard bar.
import type { Editor, Range } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { importImage, pickFile } from '../data/assets'
import { createDatabase, defaultRowProps, defaultStatusOptions } from '../data/dbops'
import { navigate } from '../data/nav'
import { useStore, ws } from '../data/store'
import type { ViewType } from '../data/types'
import { uid } from '../lib/ids'
import { t } from '../lib/i18n'
import { todayIso } from '../lib/hijri'
import { requestPagePicker } from '../ui/pickerBus'
import { openDateChipNext } from './views/dateChipBus'

const editorPages = new WeakMap<Editor, string>()
export function setEditorPage(editor: Editor, pageId: string) {
  editorPages.set(editor, pageId)
}
export function editorPageId(editor: Editor): string | null {
  return editorPages.get(editor) ?? null
}

export type BlockKind =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'

function start(editor: Editor, range?: Range) {
  const c = editor.chain().focus()
  return range ? c.deleteRange(range) : c
}

export function turnInto(editor: Editor, kind: BlockKind, range?: Range) {
  const c = start(editor, range)
  switch (kind) {
    case 'paragraph':
      c.clearNodes().setParagraph().run()
      break
    case 'h1':
    case 'h2':
    case 'h3':
      c.clearNodes().setHeading({ level: Number(kind[1]) as 1 | 2 | 3 }).run()
      break
    case 'bullet':
      c.clearNodes().toggleBulletList().run()
      break
    case 'ordered':
      c.clearNodes().toggleOrderedList().run()
      break
    case 'task':
      c.clearNodes().toggleTaskList().run()
      break
    case 'toggle':
      c.clearNodes().setDetails().run()
      break
    case 'quote':
      c.clearNodes().setBlockquote().run()
      break
    case 'callout':
      c.clearNodes().setCallout().run()
      break
    case 'code':
      c.clearNodes().setCodeBlock().run()
      break
  }
}

export function activeKind(editor: Editor): BlockKind {
  if (editor.isActive('heading', { level: 1 })) return 'h1'
  if (editor.isActive('heading', { level: 2 })) return 'h2'
  if (editor.isActive('heading', { level: 3 })) return 'h3'
  if (editor.isActive('taskList')) return 'task'
  if (editor.isActive('bulletList')) return 'bullet'
  if (editor.isActive('orderedList')) return 'ordered'
  if (editor.isActive('details')) return 'toggle'
  if (editor.isActive('callout')) return 'callout'
  if (editor.isActive('blockquote')) return 'quote'
  if (editor.isActive('codeBlock')) return 'code'
  return 'paragraph'
}

export function insertDivider(editor: Editor, range?: Range) {
  start(editor, range).setHorizontalRule().run()
}

export function insertSimpleTable(editor: Editor, range?: Range) {
  start(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}

export function insertSubPage(editor: Editor, range?: Range) {
  const parentId = editorPageId(editor)
  const id = ws().createPage({ parentId })
  start(editor, range).insertContent({ type: 'pageLink', attrs: { pageId: id } }).run()
  setTimeout(() => navigate(id), 30)
}

export function insertDatabase(editor: Editor, viewType: ViewType, range?: Range) {
  const parentId = editorPageId(editor)
  const w = ws()
  let schema
  if (viewType === 'board') {
    schema = [
      { id: 'title', name: t('p_name'), type: 'title' as const },
      { id: uid(6), name: t('p_status'), type: 'status' as const, options: defaultStatusOptions(true) },
      { id: uid(6), name: t('p_assignee'), type: 'person' as const, options: [] },
      { id: uid(6), name: t('p_date'), type: 'date' as const },
    ]
  }
  const id = createDatabase(w, { parentId, inline: true, viewType, schema })
  // Seed a few empty rows so the view isn't blank
  const initial = defaultRowProps(w.toMeta(id, w.page(id)!).schema ?? [])
  for (let i = 0; i < 3; i++) w.createPage({ type: 'row', parentId: id, props: initial })
  start(editor, range).insertContent([{ type: 'database', attrs: { databaseId: id } }, { type: 'paragraph' }]).run()
}

export async function insertImage(editor: Editor, range?: Range) {
  if (range) editor.chain().focus().deleteRange(range).run()
  const pos = editor.state.selection.from
  const file = await pickFile('image/*')
  if (!file) return
  const src = await importImage(file)
  editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src, alt: file.name } }).run()
}

export async function insertImageFile(editor: Editor, file: File, pos?: number) {
  const src = await importImage(file)
  const at = pos ?? editor.state.selection.from
  editor.chain().focus().insertContentAt(at, { type: 'image', attrs: { src, alt: file.name } }).run()
}

export function insertDate(editor: Editor, range?: Range, pick = false) {
  if (pick) openDateChipNext()
  start(editor, range).insertContent([{ type: 'dateChip', attrs: { date: todayIso() } }, { type: 'text', text: ' ' }]).run()
}

export function insertPageMention(editor: Editor, range?: Range) {
  if (range) editor.chain().focus().deleteRange(range).run()
  const pos = editor.state.selection.from
  requestPagePicker((id) => {
    editor
      .chain()
      .focus()
      .insertContentAt(pos, [{ type: 'pageMention', attrs: { pageId: id } }, { type: 'text', text: ' ' }])
      .run()
  })
}

/** Select the block at `pos` so menu actions apply to it. */
export function selectBlock(editor: Editor, pos: number, node: PMNode) {
  const { state, view } = editor
  // A node selection marks the whole block and keeps the text toolbar out of the way
  if (NodeSelection.isSelectable(node)) {
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
  } else {
    const end = Math.min(pos + node.nodeSize - 1, state.doc.content.size)
    const sel = TextSelection.between(state.doc.resolve(pos + 1), state.doc.resolve(Math.max(pos + 1, end)))
    view.dispatch(state.tr.setSelection(sel))
  }
}

export function deleteBlock(editor: Editor, pos: number, node: PMNode) {
  const { state, view } = editor
  view.dispatch(state.tr.delete(pos, pos + node.nodeSize))
  editor.commands.focus()
}

export function duplicateBlock(editor: Editor, pos: number, node: PMNode) {
  const { state, view } = editor
  const insertAt = pos + node.nodeSize
  view.dispatch(state.tr.insert(insertAt, node.copy(node.content)))
}

export function isListNode(node: PMNode | null): boolean {
  return !!node && ['bulletList', 'orderedList', 'taskList'].includes(node.type.name)
}

/** Replace a list block by an inline database whose rows are the list items. */
export function listToDatabase(editor: Editor, pos: number, node: PMNode) {
  if (!isListNode(node)) return
  const w = ws()
  const parentId = editorPageId(editor)
  const isTask = node.type.name === 'taskList'
  const statusOptions = defaultStatusOptions()
  const statusId = uid(6)
  const schema = [
    { id: 'title', name: t('p_name'), type: 'title' as const },
    { id: statusId, name: t('p_status'), type: 'status' as const, options: statusOptions },
    { id: uid(6), name: t('p_date'), type: 'date' as const },
  ]
  const dbId = createDatabase(w, { parentId, inline: true, viewType: 'table', schema })
  node.forEach((item) => {
    const title = (item.firstChild?.textContent ?? '').trim()
    const done = isTask && item.attrs.checked
    const props: Record<string, string> = { [statusId]: done ? statusOptions[statusOptions.length - 1].id : statusOptions[0].id }
    w.createPage({ type: 'row', parentId: dbId, title, props })
  })
  const { state, view } = editor
  const dbNode = state.schema.nodes.database.create({ databaseId: dbId })
  view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, dbNode))
}

export function openPageFromEditor(id: string) {
  const st = useStore.getState()
  const p = st.pages[id]
  if (p?.type === 'row') useStore.setState({ peek: id })
  else navigate(id)
}
