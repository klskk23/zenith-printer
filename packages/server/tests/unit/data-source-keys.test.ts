/**
 * Key-based identity, against a real database.
 *
 * `row-upsert.test.ts` covers the merge as arithmetic. This covers what the
 * table actually ends up holding — including the part that is easy to get right
 * in the planner and lose on the way to disk: the stored `row_key`, which every
 * write path has to maintain and which nothing complains about if it does not.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { openDatabase } from '../../src/db/index.ts'
import { FixedClock, SequentialIdGenerator } from '../../src/clock.ts'
import { DataSourceRepo } from '../../src/db/repositories/data-source-repo.ts'
import { keyRows } from '../../src/domain/row-upsert.ts'

let repo: DataSourceRepo

beforeEach(() => {
  repo = new DataSourceRepo({
    db: openDatabase({ location: ':memory:' }),
    clock: new FixedClock('2026-09-01T00:00:00Z'),
    ids: new SequentialIdGenerator('id'),
  })
})

const COLUMNS = ['sys_id', 'name']
const rows = (...ids: string[]) => ids.map((id) => ({ sys_id: id, name: `名字-${id}` }))

function seeded(...ids: string[]): string {
  const source = repo.createNexus({ name: '设备表', categoryId: 'cat-1' })
  repo.upsertByKey(source.id, { columns: COLUMNS, rows: keyRows(rows(...ids), 'sys_id') })
  return source.id
}

const keysInOrder = (id: string): string[] =>
  repo.allRows(id).map((row) => String(row.values.sys_id))

describe('a source backed by the ledger', () => {
  it('starts with no rows and no refresh behind it', () => {
    // Creating and reading are separate acts: a ledger that happens to be down
    // must not stop the source being made.
    const source = repo.createNexus({ name: '设备表', categoryId: 'cat-1' })
    expect(source).toMatchObject({ sourceKind: 'nexus', rowCount: 0, lastRefreshedAt: null })
  })

  it('keeps the category and nothing else about the connection', () => {
    // No address and no key: what is not held cannot drift from the
    // environment it came from, and cannot leak from an endpoint that has no
    // authentication of its own.
    const source = repo.createNexus({ name: '设备表', categoryId: 'cat-1' })
    expect(source.nexus).toEqual({ categoryId: 'cat-1' })
    expect(JSON.stringify(source)).not.toContain('http')
  })

  it('reports a key column it never stored', () => {
    const source = repo.createNexus({ name: '设备表', categoryId: 'cat-1' })
    expect(source.keyColumn).toBe('sys_id')
  })
})

describe('what a refresh does to the stored table', () => {
  it('writes the key beside each row', () => {
    const id = seeded('a', 'b')
    expect([...repo.ordinalByKey(id).entries()].sort()).toEqual([['a', 1], ['b', 2]])
  })

  it('keeps ordinals dense from one', () => {
    // The row editor's patch path and the browser's select-all both assume it.
    const id = seeded('a', 'b', 'c')
    repo.upsertByKey(id, { columns: COLUMNS, rows: keyRows(rows('b'), 'sys_id') })
    expect(repo.allRows(id).map((row) => row.ordinal)).toEqual([1])
  })

  it('leaves a surviving row where it was when one is inserted upstream', () => {
    const id = seeded('a', 'b')
    repo.upsertByKey(id, { columns: COLUMNS, rows: keyRows(rows('a', 'inserted', 'b'), 'sys_id') })

    // `b` keeps its ordinal; the new row goes on the end.
    expect(keysInOrder(id)).toEqual(['a', 'b', 'inserted'])
    expect(repo.ordinalByKey(id).get('b')).toBe(2)
  })

  it('is what makes a selection survive the refresh', () => {
    // The whole purchase. Ordinal 2 meant `b` before and means `b` after,
    // where under a whole-table rebuild it would now mean `inserted`.
    const id = seeded('a', 'b')
    const chosen = repo.ordinalByKey(id).get('b')
    repo.upsertByKey(id, { columns: COLUMNS, rows: keyRows(rows('a', 'inserted', 'b'), 'sys_id') })
    expect(repo.rowsAt(id, [chosen!])[0]?.sys_id).toBe('b')
  })

  it('removes a row the producer stopped sending', () => {
    const id = seeded('a', 'b', 'c')
    const result = repo.upsertByKey(id, { columns: COLUMNS, rows: keyRows(rows('a', 'c'), 'sys_id') })
    expect(keysInOrder(id)).toEqual(['a', 'c'])
    expect(result).toMatchObject({ removed: 1, added: 0 })
  })

  it('keeps the row count in step', () => {
    // Denormalised on the source row; a stale one makes the list page lie.
    const id = seeded('a', 'b', 'c')
    repo.upsertByKey(id, { columns: COLUMNS, rows: keyRows(rows('a'), 'sys_id') })
    expect(repo.find(id)?.rowCount).toBe(1)
  })

  it('takes the producer as the authority on columns', () => {
    const id = seeded('a')
    repo.upsertByKey(id, {
      columns: [...COLUMNS, 'firmware'],
      rows: keyRows([{ sys_id: 'a', name: '名字-a', firmware: '2.1.3' }], 'sys_id'),
    })
    expect(repo.find(id)?.columns).toEqual(['sys_id', 'name', 'firmware'])
  })

  it('records when it last happened', () => {
    const id = seeded('a')
    expect(repo.find(id)?.lastRefreshedAt).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('the key survives the other write paths', () => {
  it('an edit through the row patcher does not null it', () => {
    // `patchRows` goes through the same private writer. If that writer needed
    // to be *told* the key column, this is where forgetting would show up —
    // silently, as a table whose keys all became null.
    const id = seeded('a', 'b')
    repo.patchRows(id, { upserts: [{ ordinal: 1, values: { name: '改过了' } }], deletes: [] })
    expect([...repo.ordinalByKey(id).keys()].sort()).toEqual(['a', 'b'])
  })

  it('and a delete through it renumbers without losing the rest', () => {
    const id = seeded('a', 'b', 'c')
    repo.patchRows(id, { upserts: [], deletes: [2] })
    expect(keysInOrder(id)).toEqual(['a', 'c'])
    expect(repo.ordinalByKey(id).get('c')).toBe(2)
  })
})

describe('unlinking', () => {
  it('keeps the rows and forgets everywhere they came from', () => {
    const id = seeded('a', 'b')
    repo.unlink(id)
    const after = repo.find(id)!
    expect(after).toMatchObject({ sourceKind: 'local', nexus: null, keyColumn: null, refreshBeforePrint: false })
    expect(after.rowCount).toBe(2)
  })

  it('leaves nothing to fetch from', () => {
    // Releasing forgets the category, and with it every way back to the ledger.
    const id = repo.createNexus({ name: '设备表二', categoryId: 'cat-1' }).id
    repo.unlink(id)
    expect(repo.find(id)?.nexus).toBeNull()
  })
})
