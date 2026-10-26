// Row and column actions for the simple tables inside a page (TipTap tables).
// A cell is addressed by its table's position and its row/column in the table grid.
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection, cellAround, deleteCellSelection, TableMap } from '@tiptap/pm/tables'
import type { ChainedCommands, Editor } from '@tiptap/react'

export interface CellRef {
  tablePos: number
  row: number
  col: number
}

export const sameRef = (a: CellRef | null, b: CellRef | null) =>
  a === b || (!!a && !!b && a.tablePos === b.tablePos && a.row === b.row && a.col === b.col)

function tableAt(doc: PMNode, tablePos: number): { table: PMNode; map: TableMap } | null {
  const table = doc.nodeAt(tablePos)
  if (!table || table.type.name !== 'table') return null
  return { table, map: TableMap.get(table) }
}

/** Grid size of the table at this position. */
export function tableSize(state: EditorState, tablePos: number): { rows: number; cols: number } | null {
  const t = tableAt(state.doc, tablePos)
  return t ? { rows: t.map.height, cols: t.map.width } : null
}

/** Position of the cell node covering (row, col). */
export function cellPos(doc: PMNode, ref: CellRef): number | null {
  const t = tableAt(doc, ref.tablePos)
  if (!t || ref.row >= t.map.height || ref.col >= t.map.width) return null
  return ref.tablePos + 1 + t.map.map[ref.row * t.map.width + ref.col]
}

/** The cell holding the selection, if it is inside a table. */
export function cellAtSelection(state: EditorState): CellRef | null {
  const sel = state.selection
  const $cell = sel instanceof CellSelection ? sel.$headCell : cellAround(sel.$head)
  if (!$cell) return null
  const table = $cell.node(-1)
  if (table.type.name !== 'table') return null
  const tableStart = $cell.start(-1)
  const rect = TableMap.get(table).findCell($cell.pos - tableStart)
  return { tablePos: tableStart - 1, row: rect.top, col: rect.left }
}

/** The cell a DOM element (td/th or something inside one) belongs to. */
export function cellFromDom(editor: Editor, el: Element): CellRef | null {
  const cell = el.closest('td, th')
  if (!cell || !editor.view.dom.contains(cell)) return null
  try {
    const pos = editor.view.posAtDOM(cell, 0)
    const $pos = editor.state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d--) {
      const n = $pos.node(d).type.name
      if (n === 'tableCell' || n === 'tableHeader') {
        const table = $pos.node(d - 2)
        if (table.type.name !== 'table') return null
        const tableStart = $pos.start(d - 2)
        const rect = TableMap.get(table).findCell($pos.before(d) - tableStart)
        return { tablePos: tableStart - 1, row: rect.top, col: rect.left }
      }
    }
  } catch {
    /* position outside the document */
  }
  return null
}

function cursorIn(tr: Transaction, ref: CellRef): boolean {
  const pos = cellPos(tr.doc, ref)
  if (pos === null) return false
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
  return true
}

function selectCells(tr: Transaction, ref: CellRef, kind: 'row' | 'col'): boolean {
  const t = tableAt(tr.doc, ref.tablePos)
  if (!t) return false
  const { map } = t
  const start = ref.tablePos + 1
  const [a, b] =
    kind === 'row'
      ? [map.map[ref.row * map.width], map.map[ref.row * map.width + map.width - 1]]
      : [map.map[ref.col], map.map[(map.height - 1) * map.width + ref.col]]
  tr.setSelection(new CellSelection(tr.doc.resolve(start + a), tr.doc.resolve(start + b)))
  return true
}

const chainAt = (editor: Editor, ref: CellRef): ChainedCommands =>
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => cursorIn(tr, ref))

/** Highlight a whole row or column (the target of its menu). */
export function selectLine(editor: Editor, ref: CellRef, kind: 'row' | 'col') {
  editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => selectCells(tr, ref, kind))
    .run()
}

export const insertRow = (editor: Editor, ref: CellRef, side: 'before' | 'after') =>
  side === 'before' ? chainAt(editor, ref).addRowBefore().run() : chainAt(editor, ref).addRowAfter().run()

export const insertCol = (editor: Editor, ref: CellRef, side: 'before' | 'after') =>
  side === 'before' ? chainAt(editor, ref).addColumnBefore().run() : chainAt(editor, ref).addColumnAfter().run()

export function deleteRow(editor: Editor, ref: CellRef) {
  const size = tableSize(editor.state, ref.tablePos)
  if (!size) return false
  // The last row takes the table with it (an empty table can't exist)
  if (size.rows <= 1) return chainAt(editor, ref).deleteTable().run()
  return chainAt(editor, ref).deleteRow().run()
}

export function deleteCol(editor: Editor, ref: CellRef) {
  const size = tableSize(editor.state, ref.tablePos)
  if (!size) return false
  if (size.cols <= 1) return chainAt(editor, ref).deleteTable().run()
  return chainAt(editor, ref).deleteColumn().run()
}

export const deleteTable = (editor: Editor, ref: CellRef) => chainAt(editor, ref).deleteTable().run()
export const toggleHeaderRow = (editor: Editor, ref: CellRef) => chainAt(editor, ref).toggleHeaderRow().run()
export const toggleHeaderCol = (editor: Editor, ref: CellRef) => chainAt(editor, ref).toggleHeaderColumn().run()

export function clearLine(editor: Editor, ref: CellRef, kind: 'row' | 'col') {
  return editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => selectCells(tr, ref, kind))
    .command(({ state, dispatch }) => deleteCellSelection(state, dispatch))
    .run()
}

/** Merged cells reaching into a neighbouring row/column make copying a line ambiguous. */
export function lineHasSpans(state: EditorState, ref: CellRef, kind: 'row' | 'col'): boolean {
  const t = tableAt(state.doc, ref.tablePos)
  if (!t) return true
  const { map } = t
  const at = (r: number, c: number) => map.map[r * map.width + c]
  if (kind === 'row') {
    for (let c = 0; c < map.width; c++) {
      const idx = at(ref.row, c)
      if ((ref.row > 0 && at(ref.row - 1, c) === idx) || (ref.row < map.height - 1 && at(ref.row + 1, c) === idx)) return true
    }
  } else {
    for (let r = 0; r < map.height; r++) {
      const idx = at(r, ref.col)
      if ((ref.col > 0 && at(r, ref.col - 1) === idx) || (ref.col < map.width - 1 && at(r, ref.col + 1) === idx)) return true
    }
  }
  return false
}

export function duplicateRow(editor: Editor, ref: CellRef) {
  if (lineHasSpans(editor.state, ref, 'row')) return false
  return editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => {
      const t = tableAt(tr.doc, ref.tablePos)
      if (!t) return false
      let pos = ref.tablePos + 1
      for (let i = 0; i < ref.row; i++) pos += t.table.child(i).nodeSize
      const row = t.table.child(ref.row)
      const cellType = tr.doc.type.schema.nodes.tableCell
      // A copy of the heading row becomes an ordinary row
      const cells: PMNode[] = []
      row.forEach((c) => cells.push(c.type.name === 'tableHeader' && ref.row === 0 ? cellType.create(c.attrs, c.content) : c.copy(c.content)))
      const at = pos + row.nodeSize
      tr.insert(at, row.type.create(row.attrs, cells))
      tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)))
      return true
    })
    .run()
}

export function duplicateCol(editor: Editor, ref: CellRef) {
  if (lineHasSpans(editor.state, ref, 'col')) return false
  return editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => {
      const t = tableAt(tr.doc, ref.tablePos)
      if (!t) return false
      const { map } = t
      const start = ref.tablePos + 1
      // Bottom row first, so the positions above stay valid
      for (let r = map.height - 1; r >= 0; r--) {
        const pos = start + map.map[r * map.width + ref.col]
        const cell = tr.doc.nodeAt(pos)
        if (cell) tr.insert(pos + cell.nodeSize, cell.copy(cell.content))
      }
      return true
    })
    .run()
}

/** Add a row at the bottom and put the cursor in its first cell. */
export function addRowAtEnd(editor: Editor, tablePos: number) {
  const size = tableSize(editor.state, tablePos)
  if (!size) return false
  return chainAt(editor, { tablePos, row: size.rows - 1, col: 0 })
    .addRowAfter()
    .command(({ tr }) => cursorIn(tr, { tablePos, row: size.rows, col: 0 }))
    .run()
}

/** Add a column at the end and put the cursor in its first cell. */
export function addColAtEnd(editor: Editor, tablePos: number) {
  const size = tableSize(editor.state, tablePos)
  if (!size) return false
  return chainAt(editor, { tablePos, row: 0, col: size.cols - 1 })
    .addColumnAfter()
    .command(({ tr }) => cursorIn(tr, { tablePos, row: 0, col: size.cols }))
    .run()
}

/** Whether the first row / first column is set as headings. */
export function headerState(state: EditorState, tablePos: number): { row: boolean; col: boolean } {
  const t = tableAt(state.doc, tablePos)
  if (!t) return { row: false, col: false }
  let row = true
  t.table.child(0).forEach((c) => {
    if (c.type.name !== 'tableHeader') row = false
  })
  let col = true
  t.table.forEach((r) => {
    if (r.firstChild?.type.name !== 'tableHeader') col = false
  })
  return { row, col }
}
