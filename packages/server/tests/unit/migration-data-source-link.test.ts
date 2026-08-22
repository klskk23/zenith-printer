/**
 * Migration 12: where a data source came from.
 *
 * The whole point of the defaults is that nothing needs backfilling — every
 * data source that already exists is a local one, and saying so is the correct
 * answer rather than a placeholder for one.
 */
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/index.ts'
import { DataSourceRepo } from '../../src/db/repositories/data-source-repo.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'

function repoOn(db: ReturnType<typeof openDatabase>): DataSourceRepo {
  return new DataSourceRepo({
    db,
    clock: new FixedClock('2026-08-22T00:00:00Z'),
    ids: new SequentialIdGenerator('ds'),
  })
}

describe('the data source link columns', () => {
  it('leaves an existing data source local, with no source of its own', () => {
    const db = openDatabase({ location: ':memory:' })
    const source = repoOn(db).create({ name: '订单表', columns: ['订单号'], rows: [{ 订单号: 'A' }] })

    const row = db.prepare('SELECT * FROM data_sources WHERE id = ?').get(source.id) as Record<
      string,
      unknown
    >
    expect(row.source_kind).toBe('local')
    expect(row.spreadsheet_id).toBeNull()
    expect(row.worksheet_id).toBeNull()
    expect(row.last_refreshed_at).toBeNull()
  })

  it('does not disturb the columns or the rows it already had', () => {
    const db = openDatabase({ location: ':memory:' })
    const repo = repoOn(db)
    const source = repo.create({
      name: '订单表',
      columns: ['订单号', '收件人'],
      rows: [{ 订单号: 'A-001', 收件人: '张三' }],
    })

    const after = repo.find(source.id)
    expect(after?.columns).toEqual(['订单号', '收件人'])
    expect(repo.allRows(source.id)).toEqual([{ ordinal: 1, values: { 订单号: 'A-001', 收件人: '张三' } }])
  })

  it('refuses a source kind it does not know', () => {
    // The CHECK is what keeps a typo from becoming a data source nothing can
    // classify — neither local nor linked.
    const db = openDatabase({ location: ':memory:' })
    const source = repoOn(db).create({ name: 'x', columns: ['a'], rows: [] })
    expect(() =>
      db.prepare('UPDATE data_sources SET source_kind = ? WHERE id = ?').run('dropbox', source.id),
    ).toThrow()
  })
})
