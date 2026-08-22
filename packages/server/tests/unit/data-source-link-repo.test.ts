/**
 * Storing where a data source came from, and letting go of it.
 *
 * Unlinking is the part worth pinning: the rows stay and the origin goes, so
 * afterwards the row is indistinguishable from one built by uploading a CSV.
 * Anything less would make "take this table over" mean "lose this table".
 */
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/index.ts'
import { DataSourceRepo } from '../../src/db/repositories/data-source-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

function repo(): DataSourceRepo {
  return new DataSourceRepo({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    ids: new SequentialIdGenerator('ds'),
  })
}

const LINK = {
  spreadsheetId: 'sheet-1',
  spreadsheetTitle: '出货台账',
  worksheetId: 0,
  worksheetTitle: '本月出货',
}

describe('a linked data source', () => {
  it('remembers where it came from', () => {
    const store = repo()
    const source = store.createLinked({
      name: '本月出货',
      columns: ['订单号'],
      rows: [{ 订单号: 'A-001' }],
      link: LINK,
    })

    expect(source.sourceKind).toBe('google-sheets')
    expect(source.link).toEqual({ ...LINK, lastRefreshedAt: '2026-08-22T00:00:00.000Z' })
  })

  it('is what a local one is not', () => {
    const store = repo()
    const local = store.create({ name: '本地表', columns: ['a'], rows: [] })
    expect(local.sourceKind).toBe('local')
    expect(local.link).toBeNull()
  })

  it('replaces its rows and moves the refresh time', () => {
    const clock = new FixedClock('2026-08-22T00:00:00Z')
    const store = new DataSourceRepo({
      db: openDatabase({ location: ':memory:' }),
      clock,
      ids: new SequentialIdGenerator('ds'),
    })
    const source = store.createLinked({
      name: 'x', columns: ['a'], rows: [{ a: '1' }], link: LINK,
    })

    clock.set('2026-08-23T10:00:00Z')
    store.replaceLinked(source.id, {
      columns: ['a', 'b'],
      rows: [{ a: '2', b: '3' }],
      worksheetTitle: '改过名的工作表',
    })

    const after = store.find(source.id)!
    expect(after.columns).toEqual(['a', 'b'])
    expect(store.allRows(source.id)).toEqual([{ ordinal: 1, values: { a: '2', b: '3' } }])
    expect(after.link?.lastRefreshedAt).toBe('2026-08-23T10:00:00.000Z')
    // The title is refreshed too: it is how the next read addresses the sheet.
    expect(after.link?.worksheetTitle).toBe('改过名的工作表')
  })

  it('keeps every row when the link is severed', () => {
    const store = repo()
    const source = store.createLinked({
      name: 'x', columns: ['a'], rows: [{ a: '1' }, { a: '2' }], link: LINK,
    })

    store.unlink(source.id)

    const after = store.find(source.id)!
    expect(after.sourceKind).toBe('local')
    expect(after.link).toBeNull()
    expect(after.rowCount).toBe(2)
    expect(store.allRows(source.id)).toHaveLength(2)
  })

  it('leaves nothing of the origin behind after unlinking', () => {
    // Not merely hidden: the columns are cleared, so nothing can later decide
    // the source is "sort of" still linked.
    const store = repo()
    const source = store.createLinked({ name: 'x', columns: ['a'], rows: [], link: LINK })
    store.unlink(source.id)

    const row = store.rawRow(source.id)
    for (const field of [
      'spreadsheet_id', 'spreadsheet_title', 'worksheet_id', 'worksheet_title', 'last_refreshed_at',
    ]) {
      expect(row[field]).toBeNull()
    }
  })
})
