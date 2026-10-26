// Handles around a page table: a grip on each row and column (insert, copy, clear, delete) and
// "+" bars along the bottom and the far side to add a row or column in one click.
// On a computer they follow the mouse; on a phone they follow the cell being edited.
import type { Transaction } from '@tiptap/pm/state'
import { useEditorState, type Editor } from '@tiptap/react'
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Copy,
  Eraser,
  GripHorizontal,
  GripVertical,
  PanelRight,
  PanelTop,
  Plus,
  Trash2,
} from 'lucide-react'
import { memo, useEffect, useReducer, useState } from 'react'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { MenuItem, MenuLabel, MenuSep, Popover } from '../ui/Popover'
import {
  addColAtEnd,
  addRowAtEnd,
  cellAtSelection,
  cellFromDom,
  cellPos,
  clearLine,
  deleteCol,
  deleteRow,
  deleteTable,
  duplicateCol,
  duplicateRow,
  headerState,
  insertCol,
  insertRow,
  lineHasSpans,
  mapRef,
  rowPos,
  sameRef,
  selectLine,
  tableSize,
  toggleHeaderCol,
  toggleHeaderRow,
  type CellRef,
} from './tableActions'

type Box = { top: number; left: number; right: number; bottom: number; width: number; height: number }

function measure(editor: Editor, wrap: HTMLElement, ref: CellRef) {
  // Check the document first: a position left over from before an edit may point at anything
  const doc = editor.state.doc
  const pos = cellPos(doc, ref)
  const rpos = rowPos(doc, ref)
  if (pos === null || rpos === null) return null
  const dom = editor.view.nodeDOM(ref.tablePos)
  if (!(dom instanceof HTMLElement) || !dom.isConnected) return null
  const table = dom.tagName === 'TABLE' ? dom : dom.querySelector('table')
  const cell = editor.view.nodeDOM(pos)
  const row = editor.view.nodeDOM(rpos)
  if (!table || !(cell instanceof HTMLElement) || !(row instanceof HTMLElement)) return null
  const w = wrap.getBoundingClientRect()
  const rel = (el: Element): Box => {
    const r = el.getBoundingClientRect()
    return { top: r.top - w.top, left: r.left - w.left, right: r.right - w.left, bottom: r.bottom - w.top, width: r.width, height: r.height }
  }
  const tb = rel(table)
  const box = rel(dom) // the scrolling wrapper: the part of the table that is visible
  return {
    table: tb,
    cell: rel(cell),
    row: rel(row),
    visLeft: Math.max(tb.left, box.left),
    visRight: Math.min(tb.right, box.right),
    rtl: getComputedStyle(table).direction === 'rtl',
  }
}

export const TableControls = memo(function TableControls({ editor }: { editor: Editor }) {
  const isMobile = useStore((s) => s.isMobile)
  const [hover, setHover] = useState<CellRef | null>(null)
  const [menu, setMenu] = useState<{ kind: 'row' | 'col'; cell: CellRef; anchor: HTMLElement } | null>(null)
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const [wrap, setWrap] = useState<HTMLElement | null>(null)

  // On a phone there's no hover: the cell being edited decides
  const sel = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isEditable && (e.isFocused || isMobile) ? cellAtSelection(e.state) : null),
    equalityFn: sameRef,
  })

  // Positions change with the content, the window and horizontal table scrolling
  useEffect(() => {
    const el = editor.view.dom.closest('.editor-wrap') as HTMLElement | null
    setWrap(el)
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    editor.on('update', schedule)
    window.addEventListener('resize', schedule)
    el?.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('update', schedule)
      window.removeEventListener('resize', schedule)
      el?.removeEventListener('scroll', schedule, true)
    }
  }, [editor])

  // Edits above the table (yours, a collaborator's, undo) move it: keep pointing at the same cell
  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return
      setHover((prev) => (prev ? mapRef(prev, transaction) : prev))
      setMenu((prev) => {
        if (!prev) return prev
        const cell = mapRef(prev.cell, transaction)
        return !cell ? null : cell === prev.cell ? prev : { ...prev, cell }
      })
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  // Follow the mouse over table cells (computers)
  useEffect(() => {
    if (!wrap || isMobile) return
    let lastCell: Element | null = null
    let timer = 0
    const clearSoon = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        lastCell = null
        setHover(null)
      }, 400)
    }
    const onMove = (e: MouseEvent) => {
      const el = e.target as Element
      if (el.closest?.('.tbl-ctrl')) return clearTimeout(timer)
      const cellEl = el.closest?.('td, th') ?? null
      if (!cellEl) return clearSoon()
      clearTimeout(timer)
      if (cellEl === lastCell) return
      lastCell = cellEl
      const ref = cellFromDom(editor, cellEl)
      setHover((prev) => (sameRef(prev, ref) ? prev : ref))
    }
    wrap.addEventListener('mousemove', onMove)
    wrap.addEventListener('mouseleave', clearSoon)
    return () => {
      clearTimeout(timer)
      wrap.removeEventListener('mousemove', onMove)
      wrap.removeEventListener('mouseleave', clearSoon)
    }
  }, [editor, isMobile, wrap])

  const target = menu?.cell ?? (isMobile ? sel : hover)
  if (!target || !wrap || !editor.isEditable) return null
  const g = measure(editor, wrap, target)
  if (!g) return null

  const keep = (e: React.MouseEvent | React.PointerEvent) => e.preventDefault()
  const open = (kind: 'row' | 'col', anchor: HTMLElement) => {
    selectLine(editor, target, kind)
    setMenu({ kind, cell: target, anchor })
  }
  const startX = g.rtl ? g.visRight : g.visLeft
  const endX = g.rtl ? g.visLeft : g.visRight
  // The "+ column" bar sits just past the table's far edge (wider on touch screens)
  const barW = matchMedia('(pointer: coarse)').matches ? 26 : 18
  const addColLeft = g.rtl ? endX - barW - 4 : endX + 4
  const colCenter = g.cell.left + g.cell.width / 2
  const colVisible = colCenter >= g.visLeft - 1 && colCenter <= g.visRight + 1

  return (
    <>
      <button
        type="button"
        className={'tbl-ctrl tbl-grip tbl-grip-row' + (menu?.kind === 'row' ? ' is-on' : '')}
        style={{ top: g.row.top + g.row.height / 2 - 12, left: startX - 9 }}
        title={t('tRowActions')}
        aria-label={t('tRowActions')}
        onMouseDown={keep}
        onClick={(e) => open('row', e.currentTarget)}
      >
        <GripVertical size={14} />
      </button>
      {colVisible && (
        <button
          type="button"
          className={'tbl-ctrl tbl-grip tbl-grip-col' + (menu?.kind === 'col' ? ' is-on' : '')}
          style={{ top: g.table.top - 9, left: colCenter - 12 }}
          title={t('tColActions')}
          aria-label={t('tColActions')}
          onMouseDown={keep}
          onClick={(e) => open('col', e.currentTarget)}
        >
          <GripHorizontal size={14} />
        </button>
      )}
      <button
        type="button"
        className="tbl-ctrl tbl-add tbl-add-row"
        style={{ top: g.table.bottom + 4, left: g.visLeft, width: Math.max(24, g.visRight - g.visLeft) }}
        title={t('tAddRow')}
        aria-label={t('tAddRow')}
        onMouseDown={keep}
        onClick={() => addRowAtEnd(editor, target.tablePos)}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        className="tbl-ctrl tbl-add tbl-add-col"
        style={{ top: g.table.top, left: addColLeft, height: g.table.height }}
        title={t('tAddCol')}
        aria-label={t('tAddCol')}
        onMouseDown={keep}
        onClick={() => addColAtEnd(editor, target.tablePos)}
      >
        <Plus size={14} />
      </button>
      {menu && (
        <Popover anchor={menu.anchor} open onClose={() => setMenu(null)} placement={menu.kind === 'row' ? (g.rtl ? 'left-start' : 'right-start') : 'bottom'} sheet width={232}>
          <TableMenu editor={editor} cell={menu.cell} kind={menu.kind} rtl={g.rtl} onClose={() => setMenu(null)} />
        </Popover>
      )}
    </>
  )
})

/** Row and/or column actions for one cell. `cell` shows both (the phone's table button). */
export function TableMenu({ editor, cell, kind, rtl, onClose }: { editor: Editor; cell: CellRef; kind: 'row' | 'col' | 'cell'; rtl: boolean; onClose: () => void }) {
  const size = tableSize(editor.state, cell.tablePos)
  if (!size) return null
  const head = headerState(editor.state, cell.tablePos)
  const done = (fn: () => unknown) => () => {
    fn()
    onClose()
  }
  const showRow = kind !== 'col'
  const showCol = kind !== 'row'
  // "Before" a column is on its right in a right-to-left table
  const right = rtl ? 'before' : 'after'
  const left = rtl ? 'after' : 'before'
  return (
    <div className="menu-list">
      {showRow && (
        <>
          {kind === 'cell' && <MenuLabel>{t('tRow')}</MenuLabel>}
          <MenuItem icon={<BetweenHorizontalStart size={15} />} label={t('tInsertRowAbove')} onClick={done(() => insertRow(editor, cell, 'before'))} />
          <MenuItem icon={<BetweenHorizontalEnd size={15} />} label={t('tInsertRowBelow')} onClick={done(() => insertRow(editor, cell, 'after'))} />
          <MenuItem icon={<Copy size={15} />} label={t('tDuplicateRow')} disabled={lineHasSpans(editor.state, cell, 'row')} onClick={done(() => duplicateRow(editor, cell))} />
          {cell.row === 0 && <MenuItem icon={<PanelTop size={15} />} label={t('tHeaderRow')} active={head.row} onClick={done(() => toggleHeaderRow(editor, cell))} />}
          <MenuItem icon={<Eraser size={15} />} label={t('tClearRow')} onClick={done(() => clearLine(editor, cell, 'row'))} />
          <MenuItem icon={<Trash2 size={15} />} label={size.rows <= 1 ? t('tDeleteTable') : t('tDeleteRow')} danger onClick={done(() => deleteRow(editor, cell))} />
        </>
      )}
      {showRow && showCol && <MenuSep />}
      {showCol && (
        <>
          {kind === 'cell' && <MenuLabel>{t('tCol')}</MenuLabel>}
          <MenuItem icon={<BetweenVerticalEnd size={15} />} label={t('tInsertColRight')} onClick={done(() => insertCol(editor, cell, right))} />
          <MenuItem icon={<BetweenVerticalStart size={15} />} label={t('tInsertColLeft')} onClick={done(() => insertCol(editor, cell, left))} />
          <MenuItem icon={<Copy size={15} />} label={t('tDuplicateCol')} disabled={lineHasSpans(editor.state, cell, 'col')} onClick={done(() => duplicateCol(editor, cell))} />
          {cell.col === 0 && <MenuItem icon={<PanelRight size={15} className="flip-rtl" />} label={t('tHeaderCol')} active={head.col} onClick={done(() => toggleHeaderCol(editor, cell))} />}
          <MenuItem icon={<Eraser size={15} />} label={t('tClearCol')} onClick={done(() => clearLine(editor, cell, 'col'))} />
          <MenuItem icon={<Trash2 size={15} />} label={size.cols <= 1 ? t('tDeleteTable') : t('tDeleteCol')} danger onClick={done(() => deleteCol(editor, cell))} />
        </>
      )}
      {(kind !== 'row' || size.rows > 1) && (kind !== 'col' || size.cols > 1) && (
        <>
          <MenuSep />
          <MenuItem icon={<Trash2 size={15} />} label={t('tDeleteTable')} danger onClick={done(() => deleteTable(editor, cell))} />
        </>
      )}
    </div>
  )
}
