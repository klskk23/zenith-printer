import { describe, expect, it } from 'vitest'
import {
  MAX_COPIES,
  isCancellable,
  isTerminal,
  printJobInputSchema,
  remainingCopies,
  type ContentSnapshot,
  type PrintJob,
} from '../../src/domain/print-job.ts'
import { requiredManualFields, sequenceFields, templateInputSchema, type Template } from '../../src/domain/template.ts'

const snapshot: ContentSnapshot = {
  templateName: null,
  printerName: 'w',
  printerModel: 'B3S_P',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  ir: { widthMm: 50, heightMm: 30, dpi: 203, elements: [] },
  profile: { name: null, density: 3, labelType: 1 }, offsetXDots: 0, offsetYDots: 0,
}

function job(overrides: Partial<PrintJob> = {}): PrintJob {
  return {
    id: 'j1',
    idempotencyKey: 'k1',
    printerId: 'p1',
    templateId: null,
    profileId: null,
    requestedCopies: 80,
    pagesPrinted: 0,
    manualFieldValues: {},
    seqRanges: {},
    status: 'queued',
    failureCode: null,
    failureMessage: null,
    snapshot,
    createdAt: '2026-08-21T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

describe('remaining copies', () => {
  it('reports the shortfall after a partial failure', () => {
    // FR-020: reprinting exactly what is missing, not the whole batch.
    expect(remainingCopies(job({ pagesPrinted: 37 }))).toBe(37 + 6)
  })

  it('reports zero for a completed job', () => {
    expect(remainingCopies(job({ pagesPrinted: 80, status: 'completed' }))).toBe(0)
  })

  it('refuses to guess when the count is unknown', () => {
    // FR-053: a crash leaves this genuinely unknowable, and a confident wrong
    // number would duplicate or skip labels.
    expect(remainingCopies(job({ pagesPrinted: null }))).toBeNull()
  })

  it('never reports a negative shortfall', () => {
    expect(remainingCopies(job({ pagesPrinted: 100 }))).toBe(0)
  })
})

describe('cancellation and terminal states', () => {
  it('allows cancelling only before printing starts', () => {
    expect(isCancellable(job({ status: 'queued' }))).toBe(true)
    expect(isCancellable(job({ status: 'printing' }))).toBe(false)
  })

  it.each(['completed', 'failed', 'cancelled'] as const)('treats %s as terminal', (status) => {
    expect(isTerminal(status)).toBe(true)
  })

  it.each(['queued', 'printing'] as const)('treats %s as non-terminal', (status) => {
    expect(isTerminal(status)).toBe(false)
  })
})

describe('submission schema', () => {
  const base = { printerId: 'p1', ir: { widthMm: 50, heightMm: 30, dpi: 203, elements: [] } }

  it('defaults to a single copy', () => {
    expect(printJobInputSchema.parse(base).copies).toBe(1)
  })

  it('caps the batch at the supported size', () => {
    expect(() => printJobInputSchema.parse({ ...base, copies: MAX_COPIES + 1 })).toThrow()
    expect(() => printJobInputSchema.parse({ ...base, copies: MAX_COPIES })).not.toThrow()
  })

  it('rejects a fractional or zero copy count', () => {
    expect(() => printJobInputSchema.parse({ ...base, copies: 0 })).toThrow()
    expect(() => printJobInputSchema.parse({ ...base, copies: 2.5 })).toThrow()
  })

  it('defaults the value maps to empty', () => {
    const parsed = printJobInputSchema.parse(base)
    expect(parsed.manualFieldValues).toEqual({})
    expect(parsed.sequenceOverrides).toEqual({})
  })
})

describe('template field helpers', () => {
  const template: Template = {
    id: 't1',
    version: 1,
    name: 'label',
    printerKind: 'niimbot',
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: [],
    variableFields: [
      { name: 'partNo', label: 'Part', source: 'manual', sampleValue: 'ABC' },
      { name: 'serial', label: 'Serial', source: 'sequence', seqStart: 1, seqDigits: 3, seqStep: 1 },
      { name: 'batch', label: 'Batch', source: 'manual', sampleValue: 'B1' },
    ],
    createdAt: '2026-08-21T00:00:00Z',
    updatedAt: '2026-08-21T00:00:00Z',
  }

  it('lists what the print form must collect', () => {
    // FR-038: a blank where a part number belongs wastes the label as surely
    // as a jam does.
    expect(requiredManualFields(template).map((f) => f.name)).toEqual(['partNo', 'batch'])
  })

  it('lists the sequences that need a range claimed', () => {
    expect(sequenceFields(template).map((f) => f.name)).toEqual(['serial'])
  })

  it('returns nothing for a template with fixed content only', () => {
    const fixed = { ...template, variableFields: [] }
    expect(requiredManualFields(fixed)).toEqual([])
    expect(sequenceFields(fixed)).toEqual([])
  })
})

describe('template schema', () => {
  const base = {
    name: 'label',
    printerKind: 'niimbot' as const,
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: [],
  }

  it('defaults to no variable fields', () => {
    expect(templateInputSchema.parse(base).variableFields).toEqual([])
  })

  it('rejects duplicate field names', () => {
    expect(() =>
      templateInputSchema.parse({
        ...base,
        variableFields: [
          { name: 'a', label: 'A', source: 'manual', sampleValue: 'x' },
          { name: 'a', label: 'B', source: 'manual', sampleValue: 'y' },
        ],
      }),
    ).toThrow(/unique/i)
  })

  it('rejects a non-positive canvas', () => {
    expect(() => templateInputSchema.parse({ ...base, widthMm: 0 })).toThrow()
  })
})
