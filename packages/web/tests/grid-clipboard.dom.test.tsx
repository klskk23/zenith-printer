import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef, useState } from 'react'
import { DataSheetGrid, keyColumn, type DataSheetGridRef } from 'react-datasheet-grid'
import { emptyGridRow, stringColumn, type GridRow } from '../src/features/data-sources/grid-operations.ts'
import { diffRows } from '../src/features/data-sources/table-history.ts'
import { giveElementsSize } from './support/layout.ts'
import { activateCell, pasteTsv } from './support/grid.ts'
import { renderMenuItem } from '../src/features/data-sources/grid-context-menu.tsx'

/**
 * Pasting a block from a spreadsheet, through our own grid configuration.
 *
 * This is the whole reason the editor was rebuilt. What is under test is the
 * configuration and the translation — our column type, our `createRow`, our
 * operations-to-patch step — not the library's internals. The grid is driven
 * through its imperative ref, because happy-dom does no layout and the grid
 * hit-tests cells from pointer coordinates.
 */
const COLUMNS = ['订单号', '收件人']

const START: GridRow[] = [
  { 订单号: 'A-001', 收件人: '张三' },
  { 订单号: 'A-002', 收件人: '李四' },
]

let restoreSize: () => void
/** What the grid handed back, one entry per change. */
let states: GridRow[][]

beforeEach(() => {
  restoreSize = giveElementsSize()
  states = []
})

afterEach(() => {
  restoreSize()
  cleanup()
})

/** The same props the editor passes, so this tests what actually ships. */
function Harness(): React.JSX.Element {
  const [rows, setRows] = useState<GridRow[]>(START)
  const grid = useRef<DataSheetGridRef>(null)
  ;(globalThis as Record<string, unknown>).__grid = grid

  return (
    <DataSheetGrid<GridRow>
      ref={grid}
      value={rows}
      onChange={(next: GridRow[]) => {
        setRows(next)
        states.push(next)
      }}
      columns={COLUMNS.map((column) => ({
        ...keyColumn<GridRow, string>(column, stringColumn),
        title: column,
      }))}
      createRow={() => emptyGridRow(COLUMNS)}
      height={400}
    />
  )
}

function grid(): { current: { setActiveCell: (c: unknown) => void } } {
  return (globalThis as Record<string, unknown>).__grid as never
}

describe('pasting a block', () => {
  it('applies a block wider and taller than one cell', async () => {
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('X-1\t王五\nX-2\t赵六')

    expect(states).toHaveLength(1)
    expect(states[0]).toEqual([
      { 订单号: 'X-1', 收件人: '王五' },
      { 订单号: 'X-2', 收件人: '赵六' },
    ])
  })

  it('appends rows when the block runs past the end', async () => {
    // Two rows in the table, three pasted. The third is a new row, not a
    // silently dropped one — this is the behaviour the hand-rolled version
    // had to implement and get right by itself.
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('X-1\t王五\nX-2\t赵六\nX-3\t孙七')

    expect(states[0]).toHaveLength(3)
    expect(states[0]?.[2]).toEqual({ 订单号: 'X-3', 收件人: '孙七' })
  })

  it('keeps a leading zero, as the importer does', async () => {
    // `007` becoming `7` is the same data loss arriving by a different door.
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('007\t张三')

    expect(states[0]?.[0]?.订单号).toBe('007')
  })

  it('keeps a value a spreadsheet would turn into a date', async () => {
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('2024-01-05\t张三')

    expect(states[0]?.[0]?.订单号).toBe('2024-01-05')
  })

  it('does not invent a column for a block wider than the table', async () => {
    // Column names are reference names; one arriving from a paste would have
    // got there without anybody choosing to call it that (FR-049).
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('A\tB\tC\tD')

    expect(Object.keys(states[0]?.[0] ?? {}).sort()).toEqual([...COLUMNS].sort())
  })

  it('pastes into the cell that is active, not always the first', async () => {
    render(<Harness />)
    activateCell(grid() as never, 1, 1)

    await pasteTsv('王五')

    expect(states[0]).toEqual([
      { 订单号: 'A-001', 收件人: '张三' },
      { 订单号: 'A-002', 收件人: '王五' },
    ])
  })

  it('does nothing when no cell is active', async () => {
    // Otherwise a stray Ctrl+V anywhere on the page would rewrite row one.
    render(<Harness />)

    await pasteTsv('X\tY')

    expect(states).toHaveLength(0)
  })

  it('becomes one upsert per changed row once saved', async () => {
    // The patch is no longer built from the grid's change description; it is
    // the difference between the table on screen and the table on the server,
    // computed when Save is pressed. This is that step, over a real paste.
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('X-1\t王五')

    const patch = diffRows(START, states[0] ?? [])
    expect(patch.upserts).toEqual([{ ordinal: 1, values: { 订单号: 'X-1', 收件人: '王五' } }])
    expect(patch.deletes).toEqual([])
  })
})

/**
 * Deleting a row.
 *
 * The right-click menu is the only way to do it in this editor, which makes it
 * the one operation whose whole path — menu label, library action, the patch
 * that reaches the server — had no test at all.
 */
describe('the right-click menu', () => {
  it('labels its items in the interface language, not the library default', () => {
    // The library renders 'Delete row' on a hard-coded white background. Both
    // halves of that are wrong here; this is the half a test can see.
    expect(renderMenuItem({ type: 'DELETE_ROW', action: () => {} })).toBe('删除本行')
    expect(renderMenuItem({ type: 'INSERT_ROW_BELLOW', action: () => {} })).toBe('在下方插入一行')
    expect(renderMenuItem({ type: 'COPY', action: () => {} })).toBe('复制')
  })

  it('names the range when several rows are selected', () => {
    expect(renderMenuItem({ type: 'DELETE_ROWS', action: () => {}, fromRow: 2, toRow: 5 })).toBe(
      '删除第 2 到 5 行',
    )
  })

  it('sends the survivors forward and drops the trailing ordinal', () => {
    // Deleting the first of two rows leaves one row, so the patch rewrites
    // row 1 with the survivor's values and removes row 2. Naming the deleted
    // row's own ordinal instead would delete the wrong row, because the server
    // renumbers what is left.
    const patch = diffRows(START, [{ 订单号: 'A-002', 收件人: '李四' }])
    expect(patch.upserts).toEqual([{ ordinal: 1, values: { 订单号: 'A-002', 收件人: '李四' } }])
    expect(patch.deletes).toEqual([2])
  })
})
