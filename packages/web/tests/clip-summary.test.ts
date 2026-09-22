/**
 * What will be lost, and — mostly — that nothing will be.
 *
 * `null` is the answer this function gives on the ordinary path, and that is
 * the point of it: the confirm step says nothing at all unless something is
 * about to be cut off. A warning that is always on screen is one nobody reads,
 * which is how the standing "printing uses paper" notice earned its removal.
 */
import { describe, expect, it } from 'vitest'
import { clipSummary, type OverflowWarning } from '../src/features/print/flow.ts'

const CAPS = {
  dpi: 203, printheadPixels: 384, densityMin: 1, densityMax: 5, densityDefault: 3,
  paperTypes: [1], printDirection: 'top' as const, supportsConsumableLevel: true,
  model: 'B1', serial: null, firmwareVersion: null,
}

// 384 dots at 203 dpi is 48.0 mm of head.
const HEAD_MM = 48

const warning = (rowIndex: number, over: number): OverflowWarning => ({
  rowIndex,
  elementId: 'e1',
  reason: 'ELEMENT_OUT_OF_BOUNDS',
  actualWidthMm: 40 + over,
  availableWidthMm: 40,
})

describe('clipSummary', () => {
  it('says nothing when the label fits and no row overflows', () => {
    expect(clipSummary({ warnings: [], labelWidthMm: HEAD_MM - 8, capabilities: CAPS })).toBeNull()
  })

  it('counts the labels that lose content, not the warnings', () => {
    // Two elements on the same label is one label with a problem.
    const risk = clipSummary({
      warnings: [warning(3, 9), { ...warning(3, 2), elementId: 'e2' }],
      labelWidthMm: HEAD_MM - 8,
      capabilities: CAPS,
    })
    expect(risk).toMatchObject({ affected: 1, beyondHeadMm: 0, unprobed: false })
  })

  it('reports the worst overflow among them', () => {
    const risk = clipSummary({
      warnings: [warning(1, 2), warning(2, 9.25)],
      labelWidthMm: HEAD_MM - 8,
      capabilities: CAPS,
    })
    expect(risk?.affected).toBe(2)
    expect(risk?.overflowMm).toBe(9.3)
  })

  it('notices a label wider than the head, even with no warnings', () => {
    const risk = clipSummary({ warnings: [], labelWidthMm: HEAD_MM + 12, capabilities: CAPS })
    expect(risk).toMatchObject({ affected: 0, beyondHeadMm: 12, unprobed: false })
  })

  it('says the width is unknown when nobody has probed the machine', () => {
    const risk = clipSummary({ warnings: [], labelWidthMm: 100, capabilities: null })
    expect(risk).toMatchObject({ unprobed: true, beyondHeadMm: 0 })
  })

  it('does not invent an overflow for a label that just fits', () => {
    expect(clipSummary({ warnings: [], labelWidthMm: HEAD_MM, capabilities: CAPS })).toBeNull()
  })
})
