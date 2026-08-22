import { describe, expect, it } from 'vitest'
import { contentIndex, hasPerLabelContent, pageSource, valuesForLabel } from '../../src/render/job-pages.ts'
import type { BinaryBitmap } from '../../src/drivers/port.ts'
import type { ContentSnapshot, PrintJob } from '../../src/domain/print-job.ts'
import type { LabelIR } from '@zenith/shared'

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
      { id: 'code', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 12, rotation: 0, content: '${serial}', symbology: 'code128', showHumanReadable: true, moduleWidthDots: 2 },
      { id: 'part', type: 'text', xMm: 2, yMm: 16, widthMm: 40, heightMm: 5, rotation: 0, content: '${partNo}', fontFamily: 'F', fontSizeMm: 3, bold: false, align: 'left' },
    ],
  },
  profile: { name: null, density: 3, labelType: 1 }, offsetXDots: 0, offsetYDots: 0,
  rows: [], copiesPerRow: 1, constants: { partNo: 'ABC-12345' },
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
    seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 80, step: 1, digits: 3 }],
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

/** Pull every page, for the assertions that are about content rather than timing. */
function drain(job: PrintJob, render: (ir: LabelIR) => BinaryBitmap): BinaryBitmap[] {
  const source = pageSource(job, render)
  return Array.from({ length: source.total }, (_unused, index) => source.at(index))
}

describe('per-copy values', () => {
  it('steps the sequence once per label when there is no data source', () => {
    // FR-044: eighty labels, eighty serials. This is what printing a numbered
    // batch meant before data sources existed, and it has to keep meaning it.
    const job = makeJob()
    expect(valuesForLabel(job, 0)).toEqual({ partNo: 'ABC-12345', serial: '001' })
    expect(valuesForLabel(job, 79)).toEqual({ partNo: 'ABC-12345', serial: '080' })
  })

  it('pads to the width the range was configured with', () => {
    const job = makeJob({ seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 999, step: 1, digits: 3 }] })
    expect(valuesForLabel(job, 0).serial).toBe('001')
  })

  it('honours a step larger than one', () => {
    const job = makeJob({ requestedCopies: 4, seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 10, end: 25, step: 5, digits: 2 }] })
    expect([0, 1, 2, 3].map((i) => valuesForLabel(job, i).serial)).toEqual(['10', '15', '20', '25'])
  })

  it('uses the width the field was configured with, not the one implied by end', () => {
    // A three-digit field that only reaches 80 must still print 080, or the
    // labels will not sort. Inferring the width from `end` gets this wrong.
    const narrow = makeJob({ seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 80, step: 1, digits: 3 }] })
    expect(valuesForLabel(narrow, 79).serial).toBe('080')

    const wide = makeJob({ seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 80, step: 1, digits: 5 }] })
    expect(valuesForLabel(wide, 79).serial).toBe('00080')
  })
})

describe('page building', () => {
  it('renders every copy when a sequence varies them', () => {
    const rendered: string[] = []
    const job = makeJob({ requestedCopies: 5, seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 5, step: 1, digits: 3 }] })

    const pages = drain(job, (ir) => {
      const code = ir.elements.find((e) => e.id === 'code')
      rendered.push(code !== undefined && 'content' in code ? String(code.content) : '')
      return page(rendered.length)
    })

    expect(rendered).toEqual(['001', '002', '003', '004', '005'])
    expect(pages).toHaveLength(5)
  })

  it('gives every copy a distinct bitmap when they differ', () => {
    const job = makeJob({ requestedCopies: 3, seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 3, step: 1, digits: 3 }] })
    let n = 0
    const pages = drain(job, () => page((n += 1)))
    expect(new Set(pages).size).toBe(3)
  })

  it('renders once and reuses it when every copy is identical', () => {
    // A hundred pointers to one bitmap rather than a hundred bitmaps.
    let calls = 0
    const staticSnapshot = structuredClone(snapshot)
    staticSnapshot.ir.elements = staticSnapshot.ir.elements.filter((e) => e.id !== 'code')
    const job = makeJob({ requestedCopies: 100, seqClaims: [], snapshot: staticSnapshot })

    const pages = drain(job, () => {
      calls += 1
      return page(1)
    })

    expect(calls).toBe(1)
    expect(pages).toHaveLength(100)
    expect(new Set(pages).size).toBe(1)
  })

  it('substitutes the row value into every copy of that row', () => {
    // FR-036: the copies of one row are identical, serial included. Somebody
    // asking for two of each expects two matching labels, not two variants.
    const seen: Array<{ part: string; serial: string }> = []
    const rowed = structuredClone(snapshot)
    rowed.constants = {}
    rowed.rows = [{ partNo: 'ABC-12345' }, { partNo: 'XYZ-99' }]
    rowed.copiesPerRow = 2
    const job = makeJob({
      requestedCopies: 4,
      snapshot: rowed,
      seqClaims: [{ poolId: 'pool-1', variableName: 'serial', start: 1, end: 2, step: 1, digits: 3 }],
    })

    drain(job, (ir) => {
      const part = ir.elements.find((e) => e.id === 'part')
      const code = ir.elements.find((e) => e.id === 'code')
      seen.push({
        part: part !== undefined && 'content' in part ? String(part.content) : '',
        serial: code !== undefined && 'content' in code ? String(code.content) : '',
      })
      return page(1)
    })

    expect(seen).toEqual([
      { part: 'ABC-12345', serial: '001' },
      { part: 'ABC-12345', serial: '001' },
      { part: 'XYZ-99', serial: '002' },
      { part: 'XYZ-99', serial: '002' },
    ])
  })

  it('does not mutate the stored snapshot', () => {
    const job = makeJob({ requestedCopies: 3 })
    const before = structuredClone(job.snapshot)
    drain(job, () => page(1))
    expect(job.snapshot).toEqual(before)
  })
})

describe('detection', () => {
  it('reports per-copy content when a sequence is claimed', () => {
    expect(hasPerLabelContent(makeJob())).toBe(true)
  })

  it('reports none when no sequence is claimed', () => {
    expect(hasPerLabelContent(makeJob({ seqClaims: [] }))).toBe(false)
  })
})

describe('content index', () => {
  it('is the label index when there is no data source', () => {
    // Otherwise five copies of a numbered label would all carry serial 001.
    const job = makeJob({ requestedCopies: 5 })
    expect([0, 1, 2, 3, 4].map((i) => contentIndex(job, i))).toEqual([0, 1, 2, 3, 4])
  })

  it('is the row index when there is one', () => {
    const rowed = structuredClone(snapshot)
    rowed.constants = {}
    rowed.rows = [{ partNo: 'A' }, { partNo: 'B' }, { partNo: 'C' }]
    rowed.copiesPerRow = 2
    const job = makeJob({ requestedCopies: 6, snapshot: rowed })
    expect([0, 1, 2, 3, 4, 5].map((i) => contentIndex(job, i))).toEqual([0, 0, 1, 1, 2, 2])
  })
})

describe('snapshot self-containment', () => {
  it('takes constants off the snapshot, not off the design', () => {
    // A constant edited after submission must not change what a reprint
    // produces. Reading it live would also make reprinting a deleted design
    // fail outright (FR-039, FR-040).
    const job = makeJob({ requestedCopies: 1 })
    expect(valuesForLabel(job, 0).partNo).toBe('ABC-12345')
  })

  it('refuses a job whose page count outruns its rows', () => {
    // Blanks where row values belong look like a printing fault, not a data
    // fault, and get investigated in the wrong place.
    const rowed = structuredClone(snapshot)
    rowed.rows = [{ partNo: 'A' }]
    rowed.copiesPerRow = 1
    const job = makeJob({ requestedCopies: 3, snapshot: rowed, seqClaims: [] })
    expect(() => valuesForLabel(job, 2)).toThrow(/row 2 of 1/)
  })
})

describe('laziness', () => {
  /**
   * The point of the whole change. A thousand-label job used to render a
   * thousand bitmaps before the first label could start; the wait grew with
   * the batch, and during it nothing distinguished "working" from "hung".
   *
   * These assert the *timing* of rendering. Asserting the pages are correct
   * would pass just as well against the eager version — it was correct, only
   * slow.
   */
  it('renders nothing when the source is built', () => {
    let calls = 0
    pageSource(makeJob({ requestedCopies: 1000 }), () => {
      calls += 1
      return page(1)
    })
    expect(calls).toBe(0)
  })

  it('renders exactly one page when the first is asked for', () => {
    let calls = 0
    const source = pageSource(makeJob({ requestedCopies: 1000 }), () => {
      calls += 1
      return page(1)
    })
    source.at(0)
    expect(calls).toBe(1)
  })

  it('knows the total before any page is rendered', () => {
    // The driver needs it up front: TSPL's PRINT carries it, and progress is
    // reported against it. An Iterable could not say.
    const source = pageSource(makeJob({ requestedCopies: 1000 }), () => page(1))
    expect(source.total).toBe(1000)
  })

  it('counts rows times copies, not rows', () => {
    const rowed = structuredClone(snapshot)
    rowed.constants = {}
    rowed.rows = [{ partNo: 'A' }, { partNo: 'B' }]
    rowed.copiesPerRow = 3
    const source = pageSource(makeJob({ requestedCopies: 6, snapshot: rowed }), () => page(1))
    expect(source.total).toBe(6)
  })

  it('renders identical copies once and hands the same bitmap back', () => {
    // A hundred pointers to one bitmap, not a hundred bitmaps.
    let calls = 0
    const staticSnapshot = structuredClone(snapshot)
    staticSnapshot.ir.elements = staticSnapshot.ir.elements.filter((e) => e.id !== 'code')
    const source = pageSource(
      makeJob({ requestedCopies: 100, seqClaims: [], snapshot: staticSnapshot }),
      () => {
        calls += 1
        return page(1)
      },
    )

    const first = source.at(0)
    const last = source.at(99)

    expect(calls).toBe(1)
    expect(last).toBe(first)
  })

  it('still renders nothing for identical copies until one is asked for', () => {
    let calls = 0
    const staticSnapshot = structuredClone(snapshot)
    staticSnapshot.ir.elements = staticSnapshot.ir.elements.filter((e) => e.id !== 'code')
    pageSource(makeJob({ requestedCopies: 100, seqClaims: [], snapshot: staticSnapshot }), () => {
      calls += 1
      return page(1)
    })
    expect(calls).toBe(0)
  })

  it('can be asked for pages out of order, which is what a reprint does', () => {
    const seen: number[] = []
    const source = pageSource(makeJob({ requestedCopies: 10 }), (ir) => {
      const code = ir.elements.find((e) => e.id === 'code')
      seen.push(Number(code !== undefined && 'content' in code ? code.content : 0))
      return page(1)
    })

    source.at(5)
    source.at(2)

    expect(seen).toEqual([6, 3])
  })
})
