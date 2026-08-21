import { describe, expect, it } from 'vitest'
import { buildJobPages, hasPerCopyContent, valuesForCopy } from '../../src/render/job-pages.ts'
import type { BinaryBitmap } from '../../src/drivers/port.ts'
import type { ContentSnapshot, PrintJob } from '../../src/domain/print-job.ts'

const snapshot: ContentSnapshot = {
  templateName: 'part label',
  printerName: 'w',
  printerModel: 'B3S_P',
  printerKind: 'niimbot',
  widthMm: 50,
  heightMm: 30,
  dpi: 203,
  ir: {
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    elements: [
      { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, rotation: 0, content: { $var: 'serial' }, symbology: 'code128', showHumanReadable: true, moduleWidthDots: 2 },
      { id: 'part', type: 'text', xMm: 2, yMm: 16, widthMm: 40, heightMm: 5, rotation: 0, content: { $var: 'partNo' }, fontFamily: 'F', fontSizeMm: 3, bold: false, align: 'left' },
    ],
  },
  profile: { name: null, density: 3, labelType: 1 }, offsetXDots: 0, offsetYDots: 0,
}

function makeJob(overrides: Partial<PrintJob> = {}): PrintJob {
  return {
    id: 'j1',
    idempotencyKey: 'k1',
    printerId: 'p1',
    templateId: 't1',
    profileId: null,
    requestedCopies: 80,
    pagesPrinted: 0,
    manualFieldValues: { partNo: 'ABC-12345' },
    seqRanges: { serial: { start: 1, end: 80, step: 1, digits: 3 } },
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

const page = (n: number): BinaryBitmap => ({ widthDots: n, heightDots: 1, data: new Uint8Array(1) })

describe('per-copy values', () => {
  it('steps the sequence and holds the manual field', () => {
    // FR-044: eighty labels, eighty serials, one part number.
    const job = makeJob()
    expect(valuesForCopy(job, 0)).toEqual({ partNo: 'ABC-12345', serial: '001' })
    expect(valuesForCopy(job, 79)).toEqual({ partNo: 'ABC-12345', serial: '080' })
  })

  it('pads to the width the range was configured with', () => {
    const job = makeJob({ seqRanges: { serial: { start: 1, end: 999, step: 1, digits: 3 } } })
    expect(valuesForCopy(job, 0).serial).toBe('001')
  })

  it('honours a step larger than one', () => {
    const job = makeJob({ requestedCopies: 4, seqRanges: { serial: { start: 10, end: 25, step: 5, digits: 2 } } })
    expect([0, 1, 2, 3].map((i) => valuesForCopy(job, i).serial)).toEqual(['10', '15', '20', '25'])
  })

  it('uses the width the field was configured with, not the one implied by end', () => {
    // A three-digit field that only reaches 80 must still print 080, or the
    // labels will not sort. Inferring the width from `end` gets this wrong.
    const narrow = makeJob({ seqRanges: { serial: { start: 1, end: 80, step: 1, digits: 3 } } })
    expect(valuesForCopy(narrow, 79).serial).toBe('080')

    const wide = makeJob({ seqRanges: { serial: { start: 1, end: 80, step: 1, digits: 5 } } })
    expect(valuesForCopy(wide, 79).serial).toBe('00080')
  })
})

describe('page building', () => {
  it('renders every copy when a sequence varies them', () => {
    const rendered: string[] = []
    const job = makeJob({ requestedCopies: 5, seqRanges: { serial: { start: 1, end: 5, step: 1, digits: 3 } } })

    const pages = buildJobPages(job, (ir) => {
      const code = ir.elements.find((e) => e.id === 'code')
      rendered.push(code !== undefined && 'content' in code ? String(code.content) : '')
      return page(rendered.length)
    })

    expect(rendered).toEqual(['001', '002', '003', '004', '005'])
    expect(pages).toHaveLength(5)
  })

  it('gives every copy a distinct bitmap when they differ', () => {
    const job = makeJob({ requestedCopies: 3, seqRanges: { serial: { start: 1, end: 3, step: 1, digits: 3 } } })
    let n = 0
    const pages = buildJobPages(job, () => page((n += 1)))
    expect(new Set(pages).size).toBe(3)
  })

  it('renders once and reuses it when every copy is identical', () => {
    // A hundred pointers to one bitmap rather than a hundred bitmaps.
    let calls = 0
    const staticSnapshot = structuredClone(snapshot)
    staticSnapshot.ir.elements = staticSnapshot.ir.elements.filter((e) => e.id !== 'code')
    const job = makeJob({ requestedCopies: 100, seqRanges: {}, snapshot: staticSnapshot })

    const pages = buildJobPages(job, () => {
      calls += 1
      return page(1)
    })

    expect(calls).toBe(1)
    expect(pages).toHaveLength(100)
    expect(new Set(pages).size).toBe(1)
  })

  it('substitutes the manual value into every copy', () => {
    const seen: string[] = []
    const job = makeJob({ requestedCopies: 2, seqRanges: { serial: { start: 1, end: 2, step: 1, digits: 3 } } })

    buildJobPages(job, (ir) => {
      const part = ir.elements.find((e) => e.id === 'part')
      seen.push(part !== undefined && 'content' in part ? String(part.content) : '')
      return page(1)
    })

    expect(seen).toEqual(['ABC-12345', 'ABC-12345'])
  })

  it('does not mutate the stored snapshot', () => {
    const job = makeJob({ requestedCopies: 3 })
    const before = structuredClone(job.snapshot)
    buildJobPages(job, () => page(1))
    expect(job.snapshot).toEqual(before)
  })
})

describe('detection', () => {
  it('reports per-copy content when a sequence is claimed', () => {
    expect(hasPerCopyContent(makeJob())).toBe(true)
  })

  it('reports none when no sequence is claimed', () => {
    expect(hasPerCopyContent(makeJob({ seqRanges: {} }))).toBe(false)
  })
})
