/**
 * What a stored draft is allowed to look like.
 *
 * Stored data is outside input: a draft written by last week's code, or
 * edited by hand, or half-written when the tab died. Everything read back
 * goes through this schema, and anything that fails is reported as corrupt
 * rather than trusted. These check the shape is strict where it matters —
 * a `past` longer than the undo limit would be a draft that quietly grew
 * without bound.
 */
import { describe, expect, it } from 'vitest'
import { draftIndexSchema, draftSchema } from '../../src/features/drafts/schema.ts'
import { UNDO_LIMIT } from '../../src/editor/undo.ts'
import { CLOCK, WINDOW, draftInput, ir } from './support.ts'

const stored = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...draftInput(),
  createdAt: CLOCK,
  updatedAt: CLOCK,
  writerId: WINDOW,
  ...over,
})

describe('a draft', () => {
  it('accepts the full shape', () => {
    expect(draftSchema.safeParse(stored()).success).toBe(true)
  })

  it('accepts a brand-new label with no template and no baseline', () => {
    expect(draftSchema.safeParse(stored({ templateId: null, baseVersion: null, draftId: 'd-9' })).success).toBe(true)
  })

  it.each(['draftId', 'present', 'past', 'createdAt', 'updatedAt', 'writerId'])('rejects a draft missing %s', (field) => {
    const bad = stored()
    delete bad[field]
    expect(draftSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an undo stack longer than the limit', () => {
    const past = Array.from({ length: UNDO_LIMIT + 1 }, (_, i) => ir(i))
    expect(draftSchema.safeParse(stored({ past })).success).toBe(false)
    expect(draftSchema.safeParse(stored({ past: past.slice(1) })).success).toBe(true)
  })

  it('rejects a timestamp that is not ISO 8601', () => {
    expect(draftSchema.safeParse(stored({ updatedAt: 'yesterday' })).success).toBe(false)
  })

  it('rejects a present that is not a label', () => {
    expect(draftSchema.safeParse(stored({ present: { widthMm: -1 } })).success).toBe(false)
  })
})

describe('the index', () => {
  const entry = {
    draftId: 'tpl-1',
    templateId: 'tpl-1',
    name: null,
    widthMm: 50,
    heightMm: 30,
    createdAt: CLOCK,
    updatedAt: CLOCK,
  }

  it('accepts version 1', () => {
    expect(draftIndexSchema.safeParse({ version: 1, entries: [entry] }).success).toBe(true)
  })

  it('rejects any other version', () => {
    // A future shape has to be migrated, not read as if it were this one.
    expect(draftIndexSchema.safeParse({ version: 2, entries: [] }).success).toBe(false)
  })
})
