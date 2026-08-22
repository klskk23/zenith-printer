/**
 * What a refresh should do, decided before anything is written.
 *
 * Kept separate from the endpoint because the decision is where the damage
 * would be: applying a header change nobody was told about breaks every design
 * that referenced the missing column, and it breaks it silently — the label
 * prints with a blank where a name used to be.
 */
import { describe, expect, it } from 'vitest'
import { decideRefresh } from '../../src/domain/refresh.ts'
import { MAX_ROWS } from '../../src/domain/data-source.ts'

const table = (columns: string[], rows: number) => ({
  columns,
  rows: Array.from({ length: rows }, (_, i) => Object.fromEntries(columns.map((c) => [c, String(i)]))),
})

describe('deciding what a refresh does', () => {
  it('applies when nothing about the header changed', () => {
    const decision = decideRefresh({ columns: ['a', 'b'] }, table(['a', 'b'], 3), { confirmed: false })
    expect(decision).toEqual({ kind: 'apply', columnsAdded: [] })
  })

  it('applies a new column without asking, because it breaks nothing', () => {
    const decision = decideRefresh({ columns: ['a'] }, table(['a', 'b'], 1), { confirmed: false })
    expect(decision).toEqual({ kind: 'apply', columnsAdded: ['b'] })
  })

  it('stops when a column is gone, because references to it stop resolving', () => {
    const decision = decideRefresh({ columns: ['a', 'b'] }, table(['a'], 1), { confirmed: false })
    expect(decision).toEqual({
      kind: 'needsConfirmation',
      removedColumns: ['b'],
      addedColumns: [],
    })
  })

  it('treats a rename as a removal, since Google reports no difference', () => {
    const decision = decideRefresh({ columns: ['收件人'] }, table(['客户名称'], 1), { confirmed: false })
    expect(decision).toMatchObject({ kind: 'needsConfirmation', removedColumns: ['收件人'] })
  })

  it('goes ahead with a removal once it has been confirmed', () => {
    const decision = decideRefresh({ columns: ['a', 'b'] }, table(['a'], 1), { confirmed: true })
    expect(decision).toMatchObject({ kind: 'apply' })
  })

  it('refuses more rows than a data source may hold', () => {
    const decision = decideRefresh({ columns: ['a'] }, table(['a'], MAX_ROWS + 1), { confirmed: false })
    expect(decision).toEqual({ kind: 'refusedTooManyRows', rowCount: MAX_ROWS + 1, limit: MAX_ROWS })
  })

  it('accepts exactly the limit', () => {
    // The boundary itself, because "more than" and "at least" are one keystroke
    // apart and only one of them is right.
    expect(decideRefresh({ columns: ['a'] }, table(['a'], MAX_ROWS), { confirmed: false })).toMatchObject({
      kind: 'apply',
    })
  })

  it('refuses on row count even when the caller confirmed a header change', () => {
    // Confirming a column change is not consent to lose ten thousand rows.
    const decision = decideRefresh({ columns: ['a', 'b'] }, table(['a'], MAX_ROWS + 1), {
      confirmed: true,
    })
    expect(decision).toMatchObject({ kind: 'refusedTooManyRows' })
  })

  it('checks the row count before the header, so the worse problem wins', () => {
    const decision = decideRefresh({ columns: ['a', 'b'] }, table(['a'], MAX_ROWS + 1), {
      confirmed: false,
    })
    expect(decision).toMatchObject({ kind: 'refusedTooManyRows' })
  })
})
