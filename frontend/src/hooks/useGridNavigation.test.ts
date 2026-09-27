import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@/test/utils'
import type { KeyboardEvent } from 'react'
import {
  useGridNavigation,
  UNBOUNDED_TIME_WINDOW,
  PAGE_ROWS,
  type GridCell,
  type GridRow,
  type TimeWindow,
} from './useGridNavigation'

const MINUTE = 60_000
const block = (id: string, from: number, to: number) => ({ id, startMs: from * MINUTE, stopMs: to * MINUTE })

// Rows whose blocks don't line up, in minutes
const rows: GridRow[] = [
  { id: 'a', blocks: [block('a1', 0, 30), block('a2', 30, 60), block('a3', 60, 120)] },
  { id: 'b', blocks: [block('b1', 0, 45), block('b2', 45, 90), block('b3', 90, 120)] },
  { id: 'c', blocks: [block('c1', 0, 20), block('c2', 20, 100), block('c3', 100, 120)] },
  // Nothing in the guide
  { id: 'd', blocks: [] },
  // Only a programme much later
  { id: 'e', blocks: [block('e1', 500, 530)] },
  ...['f', 'g', 'h'].map((id) => ({ id, blocks: [block(`${id}1`, 0, 120)] })),
]

function key(name: string, modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey'>> = {}) {
  return { key: name, altKey: false, ctrlKey: false, metaKey: false, ...modifiers, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

function setup({
  initialCell = { rowId: 'a', blockId: 'a2' } as GridCell | null,
  // After every block but e1, so no block is on now unless a test says so
  now = 200 * MINUTE,
  window = UNBOUNDED_TIME_WINDOW as TimeWindow,
  gridRows = rows,
} = {}) {
  const onMove = vi.fn()
  const onActivate = vi.fn()
  const hook = renderHook(
    (props: { gridRows: readonly GridRow[]; window: TimeWindow }) =>
      useGridNavigation({
        rows: props.gridRows,
        initialCell,
        now,
        getTimeWindow: () => props.window,
        onMove,
        onActivate,
      }),
    { initialProps: { gridRows, window } }
  )
  const press = (name: string) => {
    const event = key(name)
    act(() => hook.result.current.handleKeyDown(event))
    return event
  }
  const focus = (rowId: string, blockId: string | null) => act(() => hook.result.current.handleCellFocus(rowId, blockId))
  const tabStop = () => hook.result.current.tabStop
  return { ...hook, press, focus, tabStop, onMove, onActivate }
}

describe('useGridNavigation', () => {
  it('starts the tab stop on the initial cell and moves it to whatever is focused', () => {
    const { tabStop, focus } = setup()
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a2' })

    focus('c', 'c3')
    expect(tabStop()).toEqual({ rowId: 'c', blockId: 'c3' })
  })

  it('falls back to the first label when the initial cell is not in the grid', () => {
    const { tabStop } = setup({ initialCell: { rowId: 'a', blockId: 'gone' } })
    expect(tabStop()).toEqual({ rowId: 'a', blockId: null })
  })

  it('drops a focused block that a refresh removed, back to the initial cell', () => {
    const { tabStop, focus, rerender } = setup()
    focus('b', 'b3')

    const refreshed = rows.map((row) => (row.id === 'b' ? { ...row, blocks: row.blocks.slice(0, 2) } : row))
    rerender({ gridRows: refreshed, window: UNBOUNDED_TIME_WINDOW })

    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a2' })
  })

  it('keeps the anchor time across Up and Down, landing on the block on air at it', () => {
    const { press, tabStop } = setup()

    // a2 starts at 0:30; b1 (0:00-0:45) is on then
    press('ArrowDown')
    expect(tabStop()).toEqual({ rowId: 'b', blockId: 'b1' })
    // Still 0:30, not b1's start: c2 (0:20-1:40), not c1 (0:00-0:20)
    press('ArrowDown')
    expect(tabStop()).toEqual({ rowId: 'c', blockId: 'c2' })
    press('ArrowUp')
    expect(tabStop()).toEqual({ rowId: 'b', blockId: 'b1' })
    press('ArrowUp')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a2' })
  })

  it('holds the anchor into the time in view when the block started before it', () => {
    // Scrolled to 0:40: b1 started at 0:00, off to the left
    const { press, focus, tabStop } = setup({ window: { fromMs: 40 * MINUTE, toMs: 160 * MINUTE } })
    focus('b', 'b1')

    press('ArrowDown')

    // 0:40 is in c2, where b1's own start would be c1
    expect(tabStop()).toEqual({ rowId: 'c', blockId: 'c2' })
  })

  it("anchors a new move from the block on now at now, not at its start", () => {
    const onNow: GridRow[] = [
      { id: 'p', blocks: [block('p1', 0, 60)] },
      { id: 'x', blocks: [block('x1', 0, 60)] },
      { id: 'y', blocks: [block('y1', 0, 30), block('y2', 30, 60)] },
    ]
    // Now 0:40, and the view starts 20 minutes before it
    const { press, focus, tabStop } = setup({
      gridRows: onNow,
      initialCell: { rowId: 'x', blockId: 'x1' },
      now: 40 * MINUTE,
      window: { fromMs: 20 * MINUTE, toMs: 140 * MINUTE },
    })

    // On entry: y2 is on now, where x1's start (held into view at 0:20) is y1
    press('ArrowDown')
    expect(tabStop()).toEqual({ rowId: 'y', blockId: 'y2' })

    // A click on it too
    focus('x', 'x1')
    press('ArrowDown')
    expect(tabStop()).toEqual({ rowId: 'y', blockId: 'y2' })

    // An anchor the keys are keeping still wins: from y1's start, 0:20
    focus('y', 'y1')
    press('ArrowUp')
    expect(tabStop()).toEqual({ rowId: 'x', blockId: 'x1' })
    press('ArrowUp')
    press('ArrowDown')
    press('ArrowDown')
    expect(tabStop()).toEqual({ rowId: 'y', blockId: 'y1' })
  })

  it('starts a new anchor after a move along the row or a click', () => {
    const { press, focus, tabStop } = setup()
    press('ArrowDown') // b1, anchor 0:30
    press('ArrowRight') // b2, 0:45-1:30
    press('ArrowDown')
    // From b2's start, 0:45: c2
    expect(tabStop()).toEqual({ rowId: 'c', blockId: 'c2' })

    focus('b', 'b3')
    press('ArrowUp')
    // From b3's start, 1:30: a3
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a3' })
  })

  it('lands on the label of a row with nothing at the anchor or in view, and moves labels between rows', () => {
    const { press, focus, tabStop } = setup({ window: { fromMs: 0, toMs: 120 * MINUTE } })
    focus('c', 'c2')

    press('ArrowDown')
    expect(tabStop()).toEqual({ rowId: 'd', blockId: null })
    // Labels stay in the label column
    press('ArrowDown')
    expect(tabStop()).toEqual({ rowId: 'e', blockId: null })
    press('ArrowUp')
    expect(tabStop()).toEqual({ rowId: 'd', blockId: null })
  })

  it('lands on the nearest block in view when the anchor falls in a gap', () => {
    const gappy: GridRow[] = [
      { id: 'x', blocks: [block('x1', 30, 60)] },
      { id: 'y', blocks: [block('y1', 0, 20), block('y2', 50, 80)] },
    ]
    const { press, tabStop } = setup({ gridRows: gappy, initialCell: { rowId: 'x', blockId: 'x1' } })

    press('ArrowDown')

    // 0:30 is 10 minutes after y1 and 20 before y2
    expect(tabStop()).toEqual({ rowId: 'y', blockId: 'y1' })
  })

  it('steps along the row with Left and Right, Left from the first block to the label', () => {
    const { press, tabStop } = setup()

    press('ArrowRight')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a3' })
    // The last block stays put
    press('ArrowRight')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a3' })
    press('ArrowLeft')
    press('ArrowLeft')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a1' })
    press('ArrowLeft')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: null })
    // Nothing further left
    press('ArrowLeft')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: null })
  })

  it("goes Right from a label to what's on now, or to the edge of the time in view", () => {
    const { press, focus, tabStop, rerender } = setup({ now: 50 * MINUTE })
    focus('b', null)
    press('ArrowRight')
    expect(tabStop()).toEqual({ rowId: 'b', blockId: 'b2' })

    // Scrolled on to 1:35: now is out of view
    rerender({ gridRows: rows, window: { fromMs: 95 * MINUTE, toMs: 200 * MINUTE } })
    focus('b', null)
    press('ArrowRight')
    expect(tabStop()).toEqual({ rowId: 'b', blockId: 'b3' })
  })

  it('goes to the first and last block with Home and End, from a block or the label', () => {
    const { press, focus, tabStop } = setup()

    press('End')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a3' })
    press('Home')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: 'a1' })

    focus('c', null)
    press('End')
    expect(tabStop()).toEqual({ rowId: 'c', blockId: 'c3' })
  })

  it('jumps PAGE_ROWS rows with PageDown and PageUp, clamped to the first and last row', () => {
    expect(PAGE_ROWS).toBe(5)
    const { press, focus, tabStop } = setup()

    press('PageDown')
    // Row f, whose one block covers 0:30
    expect(tabStop()).toEqual({ rowId: 'f', blockId: 'f1' })
    press('PageDown')
    expect(tabStop()).toEqual({ rowId: 'h', blockId: 'h1' })
    // Already on the last row: nothing moves, but the key is still the grid's
    const atEnd = press('PageDown')
    expect(tabStop()).toEqual({ rowId: 'h', blockId: 'h1' })
    expect(atEnd.preventDefault).toHaveBeenCalled()

    focus('c', null)
    press('PageUp')
    expect(tabStop()).toEqual({ rowId: 'a', blockId: null })
  })

  it('hands each move to onMove once it has rendered, saying whether it changed row', () => {
    const { press, onMove } = setup()

    press('ArrowDown')
    expect(onMove).toHaveBeenLastCalledWith({ rowId: 'b', blockId: 'b1' }, 'row')
    press('ArrowRight')
    expect(onMove).toHaveBeenLastCalledWith({ rowId: 'b', blockId: 'b2' }, 'column')
    expect(onMove).toHaveBeenCalledTimes(2)

    // No move, no call
    press('ArrowUp')
    press('ArrowUp')
    press('ArrowUp')
    expect(onMove).toHaveBeenCalledTimes(3)
  })

  it('activates the focused cell with Enter and Space', () => {
    const { press, onActivate } = setup()

    const enter = press('Enter')
    expect(onActivate).toHaveBeenLastCalledWith({ rowId: 'a', blockId: 'a2' })
    expect(enter.preventDefault).toHaveBeenCalled()
    press(' ')
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('stops the default only for its own keys, and leaves keys with modifiers alone', () => {
    const { result, tabStop } = setup()

    const arrow = key('ArrowDown')
    act(() => result.current.handleKeyDown(arrow))
    expect(arrow.preventDefault).toHaveBeenCalled()

    const tab = key('Tab')
    act(() => result.current.handleKeyDown(tab))
    expect(tab.preventDefault).not.toHaveBeenCalled()

    const ctrlHome = key('Home', { ctrlKey: true })
    act(() => result.current.handleKeyDown(ctrlHome))
    expect(ctrlHome.preventDefault).not.toHaveBeenCalled()
    expect(tabStop()).toEqual({ rowId: 'b', blockId: 'b1' })
  })
})
