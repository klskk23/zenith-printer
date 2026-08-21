/**
 * Zoom rules.
 *
 * Pure, so they are checked directly rather than through a rendered canvas —
 * which is just as well, since the DOM used in tests does not carry `altKey`
 * on a synthetic wheel event and could not express the main question here.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  MIN_FIT_SHARE,
  clampZoom,
  fitZoom,
  isZoomGesture,
  zoomFromWheel,
} from '../src/editor/zoom.ts'

describe('isZoomGesture', () => {
  it('accepts Alt', () => {
    expect(isZoomGesture({ altKey: true, deltaY: -100 })).toBe(true)
  })

  /**
   * Ctrl + wheel is the browser's page zoom and the browser wins: React's wheel
   * listener is passive, so preventDefault in an onWheel prop is ignored and
   * the page zooms anyway, with nothing to notice.
   */
  it('leaves Ctrl to the browser', () => {
    expect(isZoomGesture({ ctrlKey: true, deltaY: -100 })).toBe(false)
  })

  it('leaves Meta alone too', () => {
    expect(isZoomGesture({ metaKey: true, deltaY: -100 })).toBe(false)
  })

  it('ignores a plain wheel, so the panel still scrolls', () => {
    expect(isZoomGesture({ deltaY: -100 })).toBe(false)
  })
})

describe('zoomFromWheel', () => {
  it('zooms in on a negative delta', () => {
    expect(zoomFromWheel(1, { altKey: true, deltaY: -300 })).toBeGreaterThan(1)
  })

  it('zooms out on a positive delta', () => {
    expect(zoomFromWheel(1, { altKey: true, deltaY: 300 })).toBeLessThan(1)
  })

  it('leaves the zoom alone when the gesture is not a zoom', () => {
    expect(zoomFromWheel(1.7, { deltaY: -300 })).toBe(1.7)
    expect(zoomFromWheel(1.7, { ctrlKey: true, deltaY: -300 })).toBe(1.7)
  })

  it('compounds, so repeated notches keep moving', () => {
    const once = zoomFromWheel(1, { altKey: true, deltaY: -300 })
    const twice = zoomFromWheel(once, { altKey: true, deltaY: -300 })
    expect(twice).toBeGreaterThan(once)
  })

  it('is reversible: in then out returns to the start', () => {
    const inn = zoomFromWheel(2, { altKey: true, deltaY: -300 })
    expect(zoomFromWheel(inn, { altKey: true, deltaY: 300 })).toBeCloseTo(2, 10)
  })

  it('moves gently — one notch is a nudge, not a jump', () => {
    const after = zoomFromWheel(1, { altKey: true, deltaY: -100 })
    expect(after).toBeLessThan(1.3)
    expect(after).toBeGreaterThan(1.05)
  })

  it('stops at the limits', () => {
    expect(zoomFromWheel(MAX_ZOOM, { altKey: true, deltaY: -10000 })).toBe(MAX_ZOOM)
    expect(zoomFromWheel(MIN_ZOOM, { altKey: true, deltaY: 10000 })).toBe(MIN_ZOOM)
  })
})

describe('clampZoom', () => {
  it.each([0, -1, 0.01])('raises %f to the floor', (value) => {
    expect(clampZoom(value)).toBe(MIN_ZOOM)
  })

  it('lowers an excessive value to the ceiling', () => {
    expect(clampZoom(999)).toBe(MAX_ZOOM)
  })

  it('leaves a usable value alone', () => {
    expect(clampZoom(1.7)).toBe(1.7)
  })
})

describe('fitZoom', () => {
  /** A 50x30mm label at 203 dpi. */
  const label = { widthDots: 400, heightDots: 240 }

  it('leaves room around the label rather than filling the column', () => {
    const zoom = fitZoom({ availableWidth: 800, availableHeight: 800, ...label })
    expect(zoom * label.widthDots).toBeLessThan(800)
  })

  it('occupies at least the floor share of the width', () => {
    const zoom = fitZoom({ availableWidth: 800, availableHeight: 800, ...label })
    expect(zoom * label.widthDots).toBeGreaterThanOrEqual(800 * MIN_FIT_SHARE)
  })

  /**
   * Height reduces the zoom, but only within the band above the width floor.
   * A square label in a short column is the case where it shows.
   */
  it('accounts for height inside the band the floor leaves', () => {
    const square = { widthDots: 400, heightDots: 400 }
    const roomy = fitZoom({ availableWidth: 800, availableHeight: 2000, ...square })
    const short = fitZoom({ availableWidth: 800, availableHeight: 700, ...square })
    expect(short).toBeLessThan(roomy)
  })

  /**
   * Width wins below that band. A label much taller than the column scrolls
   * rather than shrinking — legibility here is a function of width, and a
   * sliver is useless at any height.
   */
  it('holds the width floor however tall the label is', () => {
    const tall = { widthDots: 200, heightDots: 1200 }
    for (const availableHeight of [40, 200, 400, 2000]) {
      const zoom = fitZoom({ availableWidth: 800, availableHeight, ...tall })
      expect(zoom * tall.widthDots).toBeGreaterThanOrEqual(800 * MIN_FIT_SHARE)
    }
  })

  it('never reduces a long thin label to a sliver', () => {
    const thin = { widthDots: 800, heightDots: 100 }
    const zoom = fitZoom({ availableWidth: 800, availableHeight: 40, ...thin })
    expect(zoom * thin.widthDots).toBeGreaterThanOrEqual(800 * MIN_FIT_SHARE)
  })

  it('grows for a small label in a large column', () => {
    expect(fitZoom({ availableWidth: 1600, availableHeight: 1600, ...label })).toBeGreaterThan(1)
  })

  it('shrinks for a large label in a small column', () => {
    expect(fitZoom({ availableWidth: 200, availableHeight: 200, ...label })).toBeLessThan(1)
  })

  it('stays inside the usable range', () => {
    expect(fitZoom({ availableWidth: 100000, availableHeight: 100000, ...label })).toBeLessThanOrEqual(MAX_ZOOM)
    expect(fitZoom({ availableWidth: 10, availableHeight: 10, ...label })).toBeGreaterThanOrEqual(MIN_ZOOM)
  })

  it('survives a column with no measurable width', () => {
    expect(fitZoom({ availableWidth: 0, availableHeight: 0, ...label })).toBe(1)
  })
})
