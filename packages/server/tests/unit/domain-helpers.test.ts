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
import { sequenceVariables, templateInputSchema, type Template } from '../../src/domain/template.ts'

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
  rows: [], copiesPerRow: 1, constants: {},
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
    seqClaims: [],
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

  it('leaves rowSelection absent when the design uses no data source', () => {
    expect(printJobInputSchema.parse(base).rowSelection).toBeUndefined()
  })

  it('accepts the three ways of naming rows', () => {
    expect(printJobInputSchema.parse({ ...base, rowSelection: { all: true } }).rowSelection).toEqual({ all: true })
    const explicit = printJobInputSchema.parse({ ...base, rowSelection: { ranges: [[5, 12]], ids: [3] } })
    expect(explicit.rowSelection).toEqual({ ranges: [[5, 12]], ids: [3] })
  })

  it('rejects a row ordinal below one, since ordinals start at one', () => {
    expect(() => printJobInputSchema.parse({ ...base, rowSelection: { ids: [0] } })).toThrow()
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
    variables: [
      { name: 'partNo', kind: 'constant', value: 'ABC' },
      { name: 'serial', kind: 'sequence', poolId: 'pool-1' },
      { name: 'batch', kind: 'constant', value: 'B1' },
    ],
    dataSourceId: null,
    createdAt: '2026-08-21T00:00:00Z',
    updatedAt: '2026-08-21T00:00:00Z',
  }

  it('lists the sequences that need a span claimed', () => {
    expect(sequenceVariables(template).map((v) => v.name)).toEqual(['serial'])
  })

  it('carries the pool id, which is what the claim is made against', () => {
    expect(sequenceVariables(template)[0]?.poolId).toBe('pool-1')
  })

  it('returns nothing for a design with fixed content only', () => {
    expect(sequenceVariables({ ...template, variables: [] })).toEqual([])
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

  it('defaults to no variables and no data source', () => {
    const parsed = templateInputSchema.parse(base)
    expect(parsed.variables).toEqual([])
    expect(parsed.dataSourceId).toBeNull()
  })

  it('rejects duplicate variable names', () => {
    expect(() =>
      templateInputSchema.parse({
        ...base,
        variables: [
          { name: 'a', kind: 'constant', value: 'x' },
          { name: 'a', kind: 'constant', value: 'y' },
        ],
      }),
    ).toThrow(/unique/i)
  })

  it('accepts a Chinese variable name containing a dot', () => {
    // Column names come from somebody's spreadsheet; the grammar reserves only
    // the closing brace.
    const parsed = templateInputSchema.parse({
      ...base,
      variables: [{ name: '单价.含税', kind: 'constant', value: '19.90' }],
    })
    expect(parsed.variables[0]?.name).toBe('单价.含税')
  })

  it('rejects a variable name containing the closing brace', () => {
    expect(() =>
      templateInputSchema.parse({ ...base, variables: [{ name: 'a}b', kind: 'constant', value: 'x' }] }),
    ).toThrow()
  })

  it('trims surrounding whitespace from a variable name', () => {
    // `${ sku }` resolves to `sku`; a definition named " sku " would never match.
    const parsed = templateInputSchema.parse({
      ...base,
      variables: [{ name: '  sku  ', kind: 'constant', value: 'x' }],
    })
    expect(parsed.variables[0]?.name).toBe('sku')
  })

  it('rejects a non-positive canvas', () => {
    expect(() => templateInputSchema.parse({ ...base, widthMm: 0 })).toThrow()
  })
})
