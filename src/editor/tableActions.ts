// Row and column actions for the simple tables inside a page (TipTap tables).
// A cell is addressed by its table's position and its row/column in the table grid.
// Deleting, clearing and copying work on exactly that grid row or column, also when merged cells
// (pasted from other apps) cross it: nothing outside the line is lost.
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { addColumn, addRow, CellSelection, cellAround, removeColumn, removeRow, TableMap, type TableRect } from '@tiptap/pm/tables'
import type { ChainedCommands, Editor } from '@tiptap/react'

export interface CellRef {
  tablePos: number
  row: number
  col: number
}

export const sameRef = (a: CellRef | null, b: CellRef | null) =>
  a === b || (!!a && !!b && a.tablePos === b.tablePos && a.row === b.row && a.col === b.col)

function tableAt(doc: PMNode, tablePos: number): { table: PMNode; map: TableMap } | null {
  if (tablePos < 0 || tablePos >= doc.content.size) return null
  const table = doc.nodeAt(tablePos)
  if (!table || table.type.name !== 'table') return null
  return { table, map: TableMap.get(table) }
}

/** The whole table as prosemirror-tables expects it. */
function tableRect(doc: PMNode, tablePos: number): TableRect | null {
  const t = tableAt(doc, tablePos)
  if (!t) return null
  return { ...t, tableStart: tablePos + 1, left: 0, top: 0, right: t.map.width, bottom: t.map.height }
}

/** Grid size of the table at this position. */
export function tableSize(state: EditorState, tablePos: number): { rows: number; cols: number } | null {
  const t = tableAt(state.doc, tablePos)
  return t ? { rows: t.map.height, cols: t.map.width } : null
}

/** Position of the cell node covering (row, col); null when the table or the cell isn't there. */
export function cellPos(doc: PMNode, ref: CellRef): number | null {
  const t = tableAt(doc, ref.tablePos)
  if (!t || ref.row < 0 || ref.col < 0 || ref.row >= t.map.height || ref.col >= t.map.width) return null
  return ref.tablePos + 1 + t.map.map[ref.row * t.map.width + ref.col]
}

/** Position of the row node for grid row `row`. */
export function rowPos(doc: PMNode, ref: CellRef): number | null {
  const t = tableAt(doc, ref.tablePos)
  if (!t || ref.row < 0 || ref.row >= t.table.childCount) return null
  let pos = ref.tablePos + 1
  for (let i = 0; i < ref.row; i++) pos += t.table.child(i).nodeSize
  return pos
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

/** Follow a cell through a change to the document; null once its table or line is gone. */
export function mapRef(ref: CellRef, tr: Transaction): CellRef | null {
  const res = tr.mapping.mapResult(ref.tablePos, 1)
  if (res.deleted) return null
  const t = tableAt(tr.doc, res.pos)
  if (!t || ref.row >= t.map.height || ref.col >= t.map.width) return null
  return res.pos === ref.tablePos ? ref : { ...ref, tablePos: res.pos }
}

/** Put the cursor in the cell at (row, col), kept inside the table. */
function cursorIn(tr: Transaction, ref: CellRef): boolean {
  const t = tableAt(tr.doc, ref.tablePos)
  if (!t) return false
  const row = Math.max(0, Math.min(ref.row, t.map.height - 1))
  const col = Math.max(0, Math.min(ref.col, t.map.width - 1))
  const pos = ref.tablePos + 1 + t.map.map[row * t.map.width + col]
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
  return true
}

/** Cells that begin in this row / column: what its handle highlights, clears and copies. */
function lineCells(map: TableMap, ref: CellRef, kind: 'row' | 'col'): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  const n = kind === 'row' ? map.width : map.height
  for (let k = 0; k < n; k++) {
    const i = kind === 'row' ? ref.row * map.width + k : k * map.width + ref.col
    const pos = map.map[i]
    if (seen.has(pos)) continue
    seen.add(pos)
    // A merged cell that starts in the line before belongs to that line
    if (kind === 'row' ? ref.row > 0 && map.map[i - map.width] === pos : ref.col > 0 && map.map[i - 1] === pos) continue
    out.push(pos)
  }
  return out
}

function selectCells(tr: Transaction, ref: CellRef, kind: 'row' | 'col'): boolean {
  const t = tableAt(tr.doc, ref.tablePos)
  if (!t) return false
  const { map } = t
  const cells = lineCells(map, ref, kind)
  // Anchor on cells that stay inside the line, so the highlight doesn't grow into the next one
  const inside = cells.filter((pos) => {
    const r = map.findCell(pos)
    return kind === 'row' ? r.bottom - r.top === 1 : r.right - r.left === 1
  })
  const ends = inside.length ? inside : cells
  if (!ends.length) return false
  const start = ref.tablePos + 1
  tr.setSelection(new CellSelection(tr.doc.resolve(start + ends[0]), tr.doc.resolve(start + ends[ends.length - 1])))
  return true
}

const run = (editor: Editor): ChainedCommands => editor.chain().focus(undefined, { scrollIntoView: false })

const chainAt = (editor: Editor, ref: CellRef): ChainedCommands => run(editor).command(({ tr }) => cursorIn(tr, ref))

/** Highlight a whole row or column (the target of its menu). */
export function selectLine(editor: Editor, ref: CellRef, kind: 'row' | 'col') {
  run(editor)
    .command(({ tr }) => selectCells(tr, ref, kind))
    .run()
}

/** Insert a row above / below the cell (below a merged cell = below all of it). */
export function insertRow(editor: Editor, ref: CellRef, side: 'before' | 'after') {
  return run(editor)
    .command(({ tr }) => {
      const rect = tableRect(tr.doc, ref.tablePos)
      const pos = cellPos(tr.doc, ref)
      if (!rect || pos === null) return false
      const cell = rect.map.findCell(pos - rect.tableStart)
      const at = side === 'before' ? cell.top : cell.bottom
      addRow(tr, rect, at)
      return cursorIn(tr, { ...ref, row: at })
    })
    .run()
}

/** Insert a column before / after the cell (in document order: "before" is on the right in RTL). */
export function insertCol(editor: Editor, ref: CellRef, side: 'before' | 'after') {
  return run(editor)
    .command(({ tr }) => {
      const rect = tableRect(tr.doc, ref.tablePos)
      const pos = cellPos(tr.doc, ref)
      if (!rect || pos === null) return false
      const cell = rect.map.findCell(pos - rect.tableStart)
      const at = side === 'before' ? cell.left : cell.right
      addColumn(tr, rect, at)
      return cursorIn(tr, { ...ref, col: at })
    })
    .run()
}

/** Delete exactly this grid row (merged cells crossing it just get shorter). */
export function deleteRow(editor: Editor, ref: CellRef) {
  const size = tableSize(editor.state, ref.tablePos)
  if (!size) return false
  // The last row takes the table with it (an empty table can't exist)
  if (size.rows <= 1) return deleteTable(editor, ref)
  return run(editor)
    .command(({ tr }) => {
      const rect = tableRect(tr.doc, ref.tablePos)
      if (!rect || ref.row >= rect.map.height) return false
      removeRow(tr, rect, ref.row)
      return cursorIn(tr, ref)
    })
    .run()
}

/** Delete exactly this grid column (merged cells crossing it just get narrower). */
export function deleteCol(editor: Editor, ref: CellRef) {
  const size = tableSize(editor.state, ref.tablePos)
  if (!size) return false
  if (size.cols <= 1) return deleteTable(editor, ref)
  return run(editor)
    .command(({ tr }) => {
      const rect = tableRect(tr.doc, ref.tablePos)
      if (!rect || ref.col >= rect.map.width) return false
      removeColumn(tr, rect, ref.col)
      return cursorIn(tr, ref)
    })
    .run()
}

export const deleteTable = (editor: Editor, ref: CellRef) => chainAt(editor, ref).deleteTable().run()
export const toggleHeaderRow = (editor: Editor, ref: CellRef) => chainAt(editor, ref).toggleHeaderRow().run()
export const toggleHeaderCol = (editor: Editor, ref: CellRef) => chainAt(editor, ref).toggleHeaderColumn().run()

/** Empty the cells that begin in this row / column; cells of other lines are never touched. */
export function clearLine(editor: Editor, ref: CellRef, kind: 'row' | 'col') {
  return run(editor)
    .command(({ tr }) => {
      const t = tableAt(tr.doc, ref.tablePos)
      if (!t) return false
      const start = ref.tablePos + 1
      const empty = tr.doc.type.schema.nodes.paragraph.create()
      // Last cell first, so the positions before it stay valid
      for (const pos of lineCells(t.map, ref, kind).sort((a, b) => b - a)) {
        const cell = tr.doc.nodeAt(start + pos)
        if (!cell || (cell.childCount === 1 && cell.firstChild!.type.name === 'paragraph' && !cell.firstChild!.content.size)) continue
        tr.replaceWith(start + pos + 1, start + pos + cell.nodeSize - 1, empty)
      }
      return selectCells(tr, ref, kind)
    })
    .run()
}

/** Copying is ambiguous when merged cells reach out of the line: a row with cells reaching into the
 *  rows around it, a column with cells reaching into the columns beside it. */
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
  return run(editor)
    .command(({ tr }) => {
      const t = tableAt(tr.doc, ref.tablePos)
      const pos = rowPos(tr.doc, ref)
      if (!t || pos === null) return false
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
  const heads = headerState(editor.state, ref.tablePos)
  return run(editor)
    .command(({ tr }) => {
      const t = tableAt(tr.doc, ref.tablePos)
      if (!t) return false
      const { map } = t
      const start = ref.tablePos + 1
      const cellType = tr.doc.type.schema.nodes.tableCell
      // Bottom row first, so the positions above stay valid
      for (let r = map.height - 1; r >= 0; r--) {
        const idx = map.map[r * map.width + ref.col]
        // A cell merged over several rows is copied once, from the row it starts in
        if (r > 0 && map.map[(r - 1) * map.width + ref.col] === idx) continue
        const pos = start + idx
        const cell = tr.doc.nodeAt(pos)
        if (!cell) continue
        // A copy of the heading column becomes an ordinary column (the heading row stays a heading)
        const plain = ref.col === 0 && heads.col && cell.type.name === 'tableHeader' && !(r === 0 && heads.row)
        tr.insert(pos + cell.nodeSize, plain ? cellType.create(cell.attrs, cell.content) : cell.copy(cell.content))
      }
      return cursorIn(tr, { ...ref, row: 0, col: ref.col + 1 })
    })
    .run()
}

/** Add a row at the bottom and put the cursor in its first cell. */
export function addRowAtEnd(editor: Editor, tablePos: number) {
  return run(editor)
    .command(({ tr }) => {
      const rect = tableRect(tr.doc, tablePos)
      if (!rect) return false
      addRow(tr, rect, rect.map.height)
      return cursorIn(tr, { tablePos, row: rect.map.height, col: 0 })
    })
    .run()
}

/** Add a column at the end and put the cursor in its first cell. */
export function addColAtEnd(editor: Editor, tablePos: number) {
  return run(editor)
    .command(({ tr }) => {
      const rect = tableRect(tr.doc, tablePos)
      if (!rect) return false
      addColumn(tr, rect, rect.map.width)
      return cursorIn(tr, { tablePos, row: 0, col: rect.map.width })
    })
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
