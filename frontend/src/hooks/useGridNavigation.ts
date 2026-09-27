import { useState, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'

/** A focusable block in a row, with its times, epoch ms. */
export interface GridBlock {
  id: string
  startMs: number
  stopMs: number
}

/** A row: its label cell, then its blocks sorted by start time. */
export interface GridRow {
  id: string
  blocks: readonly GridBlock[]
}

/** A cell: the row's label (blockId null) or one of its blocks. */
export interface GridCell {
  rowId: string
  blockId: string | null
}

/** Which way a move went: to another row, or along the row. */
export type GridMoveAxis = 'row' | 'column'

/** The span of time in view, epoch ms. Unbounded when nothing is laid out. */
export interface TimeWindow {
  fromMs: number
  toMs: number
}

interface UseGridNavigationOptions {
  rows: readonly GridRow[]
  // The tab stop until a cell has been focused: the watched row's on-air block
  initialCell: GridCell | null
  // The programme clock, epoch ms: Right from a label enters at what's on now
  now: number
  // Read on each key press, so it follows the scroll without re-rendering
  getTimeWindow: () => TimeWindow
  // After a move has rendered: bring the cell into view and focus it
  onMove: (cell: GridCell, axis: GridMoveAxis) => void
  // Enter or Space on the focused cell
  onActivate: (cell: GridCell) => void
}

interface UseGridNavigationResult {
  // The one cell with tabIndex 0
  tabStop: GridCell | null
  handleKeyDown: (e: KeyboardEvent) => void
  // Focus arriving by pointer or Tab makes that cell the tab stop
  handleCellFocus: (rowId: string, blockId: string | null) => void
}

// PageUp and PageDown move this many rows. Only inside the grid: elsewhere
// they are channel up and down.
export const PAGE_ROWS = 5

/** The time window of a grid that isn't laid out: every time is in view. */
export const UNBOUNDED_TIME_WINDOW: TimeWindow = { fromMs: -Infinity, toMs: Infinity }

function sameCell(a: GridCell | null, b: GridCell | null): boolean {
  return a?.rowId === b?.rowId && a?.blockId === b?.blockId
}

function isValid(rows: readonly GridRow[], cell: GridCell | null): cell is GridCell {
  if (!cell) return false
  const row = rows.find((r) => r.id === cell.rowId)
  return !!row && (cell.blockId === null || row.blocks.some((b) => b.id === cell.blockId))
}

const covers = (block: GridBlock, ms: number) => block.startMs <= ms && ms < block.stopMs
const overlaps = (block: GridBlock, window: TimeWindow) => block.startMs < window.toMs && block.stopMs > window.fromMs
const clamp = (ms: number, window: TimeWindow) => Math.min(Math.max(ms, window.fromMs), window.toMs)

// Where a move to another row lands: the block on air at the anchor, else
// the block in view nearest to it, else the row's label
function landOn(row: GridRow, anchorMs: number, window: TimeWindow): GridCell {
  const covering = row.blocks.find((b) => covers(b, anchorMs))
  if (covering) return { rowId: row.id, blockId: covering.id }
  let nearest: GridBlock | null = null
  let nearestGap = Infinity
  for (const block of row.blocks) {
    if (!overlaps(block, window)) continue
    const gap = block.startMs > anchorMs ? block.startMs - anchorMs : anchorMs - block.stopMs
    if (gap < nearestGap) {
      nearest = block
      nearestGap = gap
    }
  }
  return { rowId: row.id, blockId: nearest?.id ?? null }
}

/**
 * Roving focus for a WAI-ARIA grid of rows of time blocks, such as a TV
 * guide. One cell is the tab stop. Up and Down keep an anchor time (now for
 * the block on now, else the focused block's start, held into the window in
 * view) and land on the block on air at it in the next row, so a column of
 * times survives rows whose blocks don't line up. Left and Right step along
 * the row, Left from the first block to the label; Home and End go to the
 * row's first and last block; PageUp and PageDown jump PAGE_ROWS rows; Enter
 * and Space activate.
 * Keys are handled only while focus is in the grid, as handleKeyDown is the
 * grid element's own handler.
 */
export function useGridNavigation({
  rows,
  initialCell,
  now,
  getTimeWindow,
  onMove,
  onActivate,
}: UseGridNavigationOptions): UseGridNavigationResult {
  const [active, setActive] = useState<GridCell | null>(null)
  // The same, for the focus handler, which stays stable so the memoised
  // blocks it's passed to don't re-render on every move
  const activeRef = useRef<GridCell | null>(null)
  // The time Up and Down keep to, while they are the only moves made
  const anchorMs = useRef<number | null>(null)
  // A key move waiting to render before it's focused
  const pendingMove = useRef<{ cell: GridCell; axis: GridMoveAxis } | null>(null)

  // The focused cell while it still exists (a refresh can drop a programme),
  // else the initial cell, else the first label
  const tabStop = useMemo(() => {
    if (isValid(rows, active)) return active
    if (isValid(rows, initialCell)) return initialCell
    return rows.length > 0 ? { rowId: rows[0].id, blockId: null } : null
  }, [rows, active, initialCell])

  useLayoutEffect(() => {
    const move = pendingMove.current
    if (!move) return
    pendingMove.current = null
    if (sameCell(move.cell, tabStop)) onMove(move.cell, move.axis)
  }, [tabStop, onMove])

  const handleCellFocus = useCallback((rowId: string, blockId: string | null) => {
    const cell = { rowId, blockId }
    // A key move focusing its cell keeps its anchor
    if (sameCell(activeRef.current, cell)) return
    // Focus from outside the keys (a click, Tab) starts a new anchor
    anchorMs.current = null
    activeRef.current = cell
    setActive(cell)
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || !tabStop) return
      const rowIndex = rows.findIndex((r) => r.id === tabStop.rowId)
      if (rowIndex < 0) return
      const row = rows[rowIndex]
      const blockIndex = tabStop.blockId === null ? -1 : row.blocks.findIndex((b) => b.id === tabStop.blockId)

      let next: GridCell | null = null
      let axis: GridMoveAxis = 'column'
      let nextAnchor: number | null = null

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'PageUp':
        case 'PageDown': {
          const step = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? 1 : PAGE_ROWS
          const direction = e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 1
          const target = Math.max(0, Math.min(rows.length - 1, rowIndex + direction * step))
          axis = 'row'
          if (target === rowIndex) break
          if (blockIndex < 0) {
            // Labels stay in the label column
            next = { rowId: rows[target].id, blockId: null }
            break
          }
          const block = row.blocks[blockIndex]
          const window = getTimeWindow()
          // Keep the anchor while this block is still on air at it. Otherwise
          // start a new one, held into the time in view: now for the block on
          // now, so Down from what's playing lands on what's playing next
          // door rather than on what was on at its start; else its start
          const held = anchorMs.current
          nextAnchor =
            held !== null && covers(block, held)
              ? held
              : clamp(covers(block, now) ? now : block.startMs, window)
          next = landOn(rows[target], nextAnchor, window)
          break
        }
        case 'ArrowRight':
          if (blockIndex < 0) {
            // Entering the programmes: what's on now, or at the edge of the time in view
            const window = getTimeWindow()
            const enterAt = clamp(now, window)
            const entry =
              row.blocks.find((b) => covers(b, enterAt)) ??
              row.blocks.find((b) => b.startMs >= enterAt) ??
              row.blocks[row.blocks.length - 1]
            if (entry) next = { rowId: row.id, blockId: entry.id }
          } else if (blockIndex < row.blocks.length - 1) {
            next = { rowId: row.id, blockId: row.blocks[blockIndex + 1].id }
          }
          break
        case 'ArrowLeft':
          if (blockIndex === 0) next = { rowId: row.id, blockId: null }
          else if (blockIndex > 0) next = { rowId: row.id, blockId: row.blocks[blockIndex - 1].id }
          break
        case 'Home':
          if (row.blocks.length > 0) next = { rowId: row.id, blockId: row.blocks[0].id }
          break
        case 'End':
          if (row.blocks.length > 0) next = { rowId: row.id, blockId: row.blocks[row.blocks.length - 1].id }
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          onActivate(tabStop)
          return
        default:
          return
      }

      // The grid's own keys: the scroller doesn't scroll and nothing else acts on them
      e.preventDefault()
      if (!next || sameCell(next, tabStop)) return
      anchorMs.current = nextAnchor
      pendingMove.current = { cell: next, axis }
      activeRef.current = next
      setActive(next)
    },
    [rows, tabStop, now, getTimeWindow, onActivate]
  )

  return { tabStop, handleKeyDown, handleCellFocus }
}
