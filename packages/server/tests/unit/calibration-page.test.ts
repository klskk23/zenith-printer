import { describe, expect, it } from 'vitest'
import { irToSvg } from '@zenith/shared'
import { calibrationPageIr } from '../../src/render/calibration-page.ts'
import { ApiError } from '../../src/api/errors.ts'

const page = () => calibrationPageIr({ widthMm: 50, heightMm: 30, dpi: 203 })

describe('calibration page', () => {
  it('matches the stock it is printed on', () => {
    expect(page()).toMatchObject({ widthMm: 50, heightMm: 30, dpi: 203 })
  })

  it('puts a cross at the exact centre', () => {
    // The measurement is "how far is this cross from the middle of the label",
    // so the cross being centred is the whole premise.
    const lines = page().elements.filter((e) => e.type === 'line')
    const horizontal = lines.find((l) => l.yMm === 15 && l.y2Mm === 15)
    const vertical = lines.find((l) => l.xMm === 25 && l.x2Mm === 25)
    expect(horizontal).toBeDefined()
    expect(vertical).toBeDefined()
  })

  it('draws a border so a shift shows without measuring', () => {
    expect(page().elements.some((e) => e.type === 'rect')).toBe(true)
  })

  it('puts ticks along every edge', () => {
    const lines = page().elements.filter((e) => e.type === 'line')
    // Two edges per axis, ticks every 5mm.
    expect(lines.length).toBeGreaterThan(20)
  })

  it('uses one-dot rules, the thinnest mark that survives thresholding', () => {
    const strokes = new Set(
      page().elements.filter((e) => 'strokeWidthDots' in e).map((e) => e.strokeWidthDots),
    )
    expect(strokes).toEqual(new Set([1]))
  })

  it('renders without error through the shared pipeline', () => {
    // Deliberately the same path as any other label, so the correction under
    // test is applied to it too.
    expect(() => irToSvg(page())).not.toThrow()
  })

  it('stays inside the label', () => {
    for (const element of page().elements) {
      if (element.type === 'line') {
        expect(Math.max(element.xMm, element.x2Mm)).toBeLessThanOrEqual(50)
        expect(Math.max(element.yMm, element.y2Mm)).toBeLessThanOrEqual(30)
      }
    }
  })

  it('adapts to a different stock size', () => {
    const wide = calibrationPageIr({ widthMm: 100, heightMm: 60, dpi: 203 })
    const lines = wide.elements.filter((e) => e.type === 'line')
    expect(lines.some((l) => l.xMm === 50 && l.x2Mm === 50)).toBe(true)
  })
})

/**
 * The endpoint guard.
 *
 * Printing consumes stock and cannot be undone, so the request has to say so
 * explicitly. This mirrors the CLI's `--confirm`, and exists for the same
 * reason: a command that quietly burns labels will eventually burn them by
 * accident.
 */
describe('confirmation', () => {
  it('has a distinct code for "you have not confirmed yet"', () => {
    // Not a validation failure — nothing about the request is wrong, it just
    // has not said yes to something irreversible.
    const error = ApiError.badRequest('CONFIRMATION_REQUIRED', { printerId: 'p1' })
    expect(error.status).toBe(400)
    expect(error.body.code).toBe('CONFIRMATION_REQUIRED')
  })

  it('words the confirmation in all three parts', () => {
    const error = ApiError.badRequest('CONFIRMATION_REQUIRED')
    expect(error.body.what.length).toBeGreaterThan(0)
    expect(error.body.why.length).toBeGreaterThan(0)
    expect(error.body.next.length).toBeGreaterThan(0)
  })
})
