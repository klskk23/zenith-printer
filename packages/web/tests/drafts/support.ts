/**
 * Fixtures for the draft tests.
 *
 * A draft carries a whole label IR, so every test would otherwise open with
 * the same twelve lines of rect. Built through the shared schema so a fixture
 * can never drift from what the application actually stores.
 */
import { labelIrSchema, type LabelIR } from '@zenith/shared'
import type { DraftInput } from '../../src/features/drafts/schema.ts'
import { memoryDraftStorage, type DraftStorage } from '../../src/features/drafts/storage.ts'

export function ir(xMm = 2): LabelIR {
  return labelIrSchema.parse({
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: [{ id: 'r', type: 'rect', xMm, yMm: 2, widthMm: 20, heightMm: 10, strokeWidthDots: 2 }],
  })
}

export function draftInput(over: Partial<DraftInput> = {}): DraftInput {
  return {
    draftId: 'tpl-1',
    templateId: 'tpl-1',
    baseVersion: 3,
    present: ir(),
    past: [],
    variables: [],
    dataSourceId: null,
    name: null,
    ...over,
  }
}

export const CLOCK = '2026-09-21T10:00:00.000Z'
export const WINDOW = 'win-a'

/**
 * A storage that throws on the next N writes, the way a full localStorage
 * does — a `QuotaExceededError`, thrown from `setItem`, with nothing stored.
 */
export function failingStorage(failures: number, inner: DraftStorage = memoryDraftStorage()): DraftStorage & { failures: number } {
  const wrapped = {
    failures,
    getItem: (key: string) => inner.getItem(key),
    removeItem: (key: string) => inner.removeItem(key),
    keys: () => inner.keys(),
    setItem: (key: string, value: string) => {
      if (wrapped.failures > 0) {
        wrapped.failures -= 1
        const error = new Error('quota exceeded')
        error.name = 'QuotaExceededError'
        throw error
      }
      inner.setItem(key, value)
    },
  }
  return wrapped
}
