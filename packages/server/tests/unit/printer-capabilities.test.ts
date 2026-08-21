import { describe, expect, it } from 'vitest'
import {
  PrinterNotProbedError,
  acceptsTemplateKind,
  isDensityInRange,
  maxLabelWidthMm,
  minStrokeWidthMm,
  printerInputSchema,
  requireCapabilities,
  type Printer,
  type ProbedCapabilities,
} from '../../src/domain/printer.ts'

/** Values as actually reported by B3S_P (docs/B3S_P.info). */
const b3sp: ProbedCapabilities = {
  dpi: 203,
  printheadPixels: 576,
  densityMin: 1,
  densityMax: 5,
  densityDefault: 3,
  paperTypes: [1, 2, 3, 5],
  printDirection: 'top',
  supportsConsumableLevel: true,
  model: 'B3S_P',
  serial: 'H508010165',
  firmwareVersion: '0x030f',
}

const printer: Printer = {
  id: 'p1',
  name: 'warehouse',
  kind: 'niimbot',
  transport: 'serial',
  address: '/dev/ttyACM0',
  printTaskName: 'B1',
  capabilities: b3sp,
  queueState: 'running',
  queuePausedReason: null,
  lastProbedAt: '2026-08-21T00:00:00Z',
  createdAt: '2026-08-21T00:00:00Z',
}

describe('derived limits', () => {
  it('derives the maximum label width from probed metadata', () => {
    // 576 dots at 203 dpi is 72.1mm. Nothing here is hardcoded per model.
    expect(maxLabelWidthMm(b3sp)).toBeCloseTo(72.071, 3)
  })

  it('derives a different width for a wider head without any code change', () => {
    // PC310T at 203 dpi: 4 inches, 832 dots.
    expect(maxLabelWidthMm({ ...b3sp, printheadPixels: 832 })).toBeCloseTo(104.1, 1)
  })

  it('derives the minimum stroke width from dpi', () => {
    expect(minStrokeWidthMm(b3sp)).toBeCloseTo(0.125, 3)
  })

  it('halves the minimum stroke width at 406 dpi', () => {
    expect(minStrokeWidthMm({ ...b3sp, dpi: 406 })).toBeCloseTo(minStrokeWidthMm(b3sp) / 2, 6)
  })
})

describe('density range', () => {
  it('accepts values the model supports', () => {
    expect(isDensityInRange(b3sp, 1)).toBe(true)
    expect(isDensityInRange(b3sp, 5)).toBe(true)
  })

  it('rejects values outside the probed range', () => {
    expect(isDensityInRange(b3sp, 0)).toBe(false)
    expect(isDensityInRange(b3sp, 6)).toBe(false)
  })

  it('rejects a fractional density', () => {
    expect(isDensityInRange(b3sp, 3.5)).toBe(false)
  })
})

describe('unprobed printers', () => {
  it('fails with a typed error rather than a null dereference', () => {
    expect(() => requireCapabilities({ ...printer, capabilities: null })).toThrow(PrinterNotProbedError)
  })

  it('names the printer in the error', () => {
    try {
      requireCapabilities({ ...printer, capabilities: null })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as PrinterNotProbedError).printerId).toBe('p1')
    }
  })
})

describe('input validation', () => {
  it('requires a print task for niimbot printers', () => {
    // getPrintTaskType() is unreliable, so this must be chosen by hand.
    expect(() =>
      printerInputSchema.parse({ name: 'x', kind: 'niimbot', transport: 'serial', address: '/dev/ttyACM0' }),
    ).toThrow(/printTaskName/)
  })

  it('does not require one for zpl printers', () => {
    expect(() =>
      printerInputSchema.parse({ name: 'x', kind: 'zpl', transport: 'tcp', address: '192.168.1.50:9100' }),
    ).not.toThrow()
  })

  it('rejects an empty address', () => {
    expect(() =>
      printerInputSchema.parse({ name: 'x', kind: 'zpl', transport: 'tcp', address: '' }),
    ).toThrow()
  })
})

describe('template compatibility', () => {
  it('accepts a template built for the same kind', () => {
    expect(acceptsTemplateKind(printer, 'niimbot')).toBe(true)
  })

  it('rejects a template built for the other kind', () => {
    // FR-032: a 72mm niimbot design has no meaning on a 104mm ZPL printer.
    expect(acceptsTemplateKind(printer, 'zpl')).toBe(false)
  })
})
