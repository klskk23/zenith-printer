import { describe, expect, it } from 'vitest'
import { MIN_MODULE_WIDTH_DOTS, dotsToMm } from '@zenith/shared'
import {
  largestModuleWidthWithin,
  snapWidth,
  widthForModule,
} from '../src/editor/barcode-width.ts'

const DPI = 203
/** 'ABC-12345' in Code 128, measured. */
const MODULES = 123

describe('snapWidth', () => {
  it('lands on a whole multiple of the module count', () => {
    for (const targetMm of [10, 15.4, 23, 30.8, 46.2, 61.5]) {
      const result = snapWidth(targetMm, MODULES, DPI)
      expect(result.widthDots % MODULES).toBe(0)
    }
  })

  it('picks the nearest achievable width', () => {
    // Module 2 is 246 dots (30.8mm); module 3 is 369 (46.2mm). 32mm is nearer 2.
    expect(snapWidth(32, MODULES, DPI).moduleWidthDots).toBe(2)
    expect(snapWidth(45, MODULES, DPI).moduleWidthDots).toBe(3)
  })

  it('never goes below the scanning floor', () => {
    const result = snapWidth(1, MODULES, DPI)
    expect(result.moduleWidthDots).toBe(MIN_MODULE_WIDTH_DOTS)
    expect(result.clampedToFloor).toBe(true)
  })

  it('does not report clamping when the request was already legal', () => {
    expect(snapWidth(31, MODULES, DPI).clampedToFloor).toBe(false)
  })

  it('accepts odd module widths', () => {
    // The even-only rule this project used to enforce was a measurement error;
    // odd widths align on whole dots just as well.
    expect(snapWidth(dotsToMm(3 * MODULES, DPI), MODULES, DPI).moduleWidthDots).toBe(3)
    expect(snapWidth(dotsToMm(5 * MODULES, DPI), MODULES, DPI).moduleWidthDots).toBe(5)
  })

  it('is idempotent — snapping a snapped width changes nothing', () => {
    const once = snapWidth(37, MODULES, DPI)
    expect(snapWidth(once.widthMm, MODULES, DPI)).toEqual(once)
  })

  it('is stable for a different module count', () => {
    // EAN-13 is 96 modules; the steps are different but the rule is the same.
    const result = snapWidth(30, 96, DPI)
    expect(result.widthDots % 96).toBe(0)
  })

  it('survives a zero module count without dividing by it', () => {
    expect(snapWidth(30, 0, DPI).moduleWidthDots).toBe(MIN_MODULE_WIDTH_DOTS)
  })
})

describe('widthForModule', () => {
  it('reports the width each step produces', () => {
    expect(widthForModule(2, MODULES, DPI)).toBeCloseTo(30.8, 1)
    expect(widthForModule(3, MODULES, DPI)).toBeCloseTo(46.2, 1)
  })

  it('scales linearly, which is what makes the steps predictable', () => {
    expect(widthForModule(4, MODULES, DPI)).toBeCloseTo(widthForModule(2, MODULES, DPI) * 2, 6)
  })
})

describe('largestModuleWidthWithin', () => {
  it('rounds down so the symbol stays inside the box', () => {
    // 40mm is 320 dots; 320/123 is 2.6, so 2 — 3 would overflow.
    expect(largestModuleWidthWithin(40, MODULES, DPI)).toBe(2)
  })

  it('never returns something that overflows', () => {
    for (const availableMm of [12, 20, 31, 47, 62, 100]) {
      const module = largestModuleWidthWithin(availableMm, MODULES, DPI)
      // The floor can exceed a very small box; that is a warning, not a silent
      // overflow, and is reported by the overflow check instead.
      if (module > MIN_MODULE_WIDTH_DOTS) {
        expect(widthForModule(module, MODULES, DPI)).toBeLessThanOrEqual(availableMm + 1e-9)
      }
    }
  })

  it('respects the floor even in a box too small for it', () => {
    expect(largestModuleWidthWithin(5, MODULES, DPI)).toBe(MIN_MODULE_WIDTH_DOTS)
  })
})
