/**
 * What a draft gives up when storage is short.
 *
 * The order is the whole point: history first, content never. A draft that
 * kept its undo stack and lost its content would have preserved the record
 * of edits to a label that no longer exists.
 */
import { describe, expect, it } from 'vitest'
import { dropHistory, trimForStorage } from '../../src/features/drafts/trim.ts'
import { UNDO_LIMIT } from '../../src/editor/undo.ts'
import { draftInput, ir } from './support.ts'

describe('trimForStorage', () => {
  it('keeps the most recent steps up to the limit', () => {
    const past = Array.from({ length: UNDO_LIMIT + 7 }, (_, i) => ir(i))
    const trimmed = trimForStorage(draftInput({ past }))
    expect(trimmed.past).toHaveLength(UNDO_LIMIT)
    // The oldest seven are the ones dropped; the newest is still last.
    expect(trimmed.past[0]).toBe(past[7])
    expect(trimmed.past[UNDO_LIMIT - 1]).toBe(past[past.length - 1])
  })

  it('leaves a short stack alone', () => {
    const input = draftInput({ past: [ir(1), ir(2)] })
    expect(trimForStorage(input).past).toEqual(input.past)
  })

  it('does not modify its input', () => {
    const past = Array.from({ length: UNDO_LIMIT + 1 }, (_, i) => ir(i))
    const input = draftInput({ past })
    trimForStorage(input)
    expect(input.past).toHaveLength(UNDO_LIMIT + 1)
  })
})

describe('dropHistory', () => {
  it('empties the stack and keeps the content', () => {
    const input = draftInput({ past: [ir(1), ir(2)], present: ir(9) })
    const dropped = dropHistory(input)
    expect(dropped.past).toEqual([])
    expect(dropped.present).toBe(input.present)
  })

  it('does not modify its input', () => {
    const input = draftInput({ past: [ir(1)] })
    dropHistory(input)
    expect(input.past).toHaveLength(1)
  })
})
