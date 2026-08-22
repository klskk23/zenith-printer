import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef, useState } from 'react'
import { DataSheetGrid, keyColumn, type DataSheetGridRef } from 'react-datasheet-grid'
import {
  emptyGridRow,
  patchFromOperations,
  stringColumn,
  type GridOperation,
  type GridRow,
  type RowPatch,
} from '../src/features/data-sources/grid-operations.ts'
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

let restoreSize: () => void
let patches: RowPatch[]

beforeEach(() => {
  restoreSize = giveElementsSize()
  patches = []
})

afterEach(() => {
  restoreSize()
  cleanup()
})

/** The same props the editor passes, so this tests what actually ships. */
function Harness(): React.JSX.Element {
  const [rows, setRows] = useState<GridRow[]>([
    { 订单号: 'A-001', 收件人: '张三' },
    { 订单号: 'A-002', 收件人: '李四' },
  ])
  const grid = useRef<DataSheetGridRef>(null)
  ;(globalThis as Record<string, unknown>).__grid = grid

  return (
    <DataSheetGrid<GridRow>
      ref={grid}
      value={rows}
      onChange={(next: GridRow[], operations: GridOperation[]) => {
        setRows(next)
        patches.push(patchFromOperations(next, operations))
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

    expect(patches).toHaveLength(1)
    expect(patches[0]?.upserts).toEqual([
      { ordinal: 1, values: { 订单号: 'X-1', 收件人: '王五' } },
      { ordinal: 2, values: { 订单号: 'X-2', 收件人: '赵六' } },
    ])
  })

  it('appends rows when the block runs past the end', async () => {
    // Two rows in the table, three pasted. The third is a new row, not a
    // silently dropped one — this is the behaviour the hand-rolled version
    // had to implement and get right by itself.
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('X-1\t王五\nX-2\t赵六\nX-3\t孙七')

    expect(patches[0]?.upserts.map((u) => u.ordinal)).toEqual([1, 2, 3])
    expect(patches[0]?.upserts[2]?.values).toEqual({ 订单号: 'X-3', 收件人: '孙七' })
  })

  it('keeps a leading zero, as the importer does', async () => {
    // `007` becoming `7` is the same data loss arriving by a different door.
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('007\t张三')

    expect(patches[0]?.upserts[0]?.values.订单号).toBe('007')
  })

  it('keeps a value a spreadsheet would turn into a date', async () => {
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('2024-01-05\t张三')

    expect(patches[0]?.upserts[0]?.values.订单号).toBe('2024-01-05')
  })

  it('does not invent a column for a block wider than the table', async () => {
    // Column names are reference names; one arriving from a paste would have
    // got there without anybody choosing to call it that (FR-049).
    render(<Harness />)
    activateCell(grid() as never, 0, 0)

    await pasteTsv('A\tB\tC\tD')

    expect(Object.keys(patches[0]?.upserts[0]?.values ?? {}).sort()).toEqual(
      [...COLUMNS].sort(),
    )
  })

  it('pastes into the cell that is active, not always the first', async () => {
    render(<Harness />)
    activateCell(grid() as never, 1, 1)

    await pasteTsv('王五')

    expect(patches[0]?.upserts).toEqual([{ ordinal: 2, values: { 订单号: 'A-002', 收件人: '王五' } }])
  })

  it('does nothing when no cell is active', async () => {
    // Otherwise a stray Ctrl+V anywhere on the page would rewrite row one.
    render(<Harness />)

    await pasteTsv('X\tY')

    expect(patches).toHaveLength(0)
  })
})

/**
 * Deleting a row.
 *
 * The right-click menu is the only way to do it in this editor, which makes it
 * the one operation whose entire path — menu label, library action, our
 * translation to a patch — had no test at all. It is driven here by calling the
 * menu item's own action, because happy-dom does no layout and the menu is
 * positioned from pointer coordinates.
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

  it('turns a deleted row into a patch naming the ordinal it had', () => {
    // The row that goes is named by the position it *held*, not the position
    // the table ends up with: the server deletes by ordinal out of the current
    // table and only then renumbers what is left. Deleting the first of two
    // rows is therefore `deletes: [1]`, after which the survivor becomes row 1
    // on its own — no upsert needed to move it.
    const patch = patchFromOperations(
      [{ 订单号: 'A-002', 收件人: '李四' }],
      [{ type: 'DELETE', fromRowIndex: 0, toRowIndex: 1 }],
    )
    expect(patch.deletes).toEqual([1])
    expect(patch.upserts).toEqual([])
  })

  it('names every ordinal when a block of rows is deleted at once', () => {
    const patch = patchFromOperations(
      [{ 订单号: 'A-001', 收件人: '张三' }],
      [{ type: 'DELETE', fromRowIndex: 1, toRowIndex: 3 }],
    )
    expect(patch.deletes).toEqual([2, 3])
  })
})
