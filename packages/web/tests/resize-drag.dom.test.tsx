/**
 * Resizing by dragging the handle.
 *
 * This file exists because the same defect was reported twice. The first fix
 * changed the inspector's width field, which is what the tests drove; the user
 * drags the handle, which is a different path through the editor, and it went
 * on writing only the box. A barcode or QR code is drawn at
 * `moduleWidth x moduleCount` and the renderer takes the smaller of that and
 * the declared box, so a box that grows on its own grows around a symbol that
 * has not moved.
 *
 * Driving a pointer drag needs `getBoundingClientRect`, which happy-dom
 * reports as all zeros — every delta is then zero and the gesture does
 * nothing, silently. Stubbing it is what makes the path testable at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ printers: [], templates: [], jobs: [], profiles: [] }),
      text: () => Promise.resolve('{}'),
    } as unknown as Response),
  ))
})

/**
 * The canvas SVG, with a geometry it can be dragged on.
 *
 * One screen pixel per dot, origin at zero — so a pointer moved by N reads as
 * N dots and the arithmetic in the test is the arithmetic the user's hand does.
 */
function openDesignWithGeometry(): SVGSVGElement {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('标签设计')[0]!)

  const svg = document.querySelector('[data-label-canvas] svg') as SVGSVGElement
  expect(svg, 'canvas not rendered').not.toBeNull()
  const width = Number(svg.getAttribute('viewBox')!.split(' ')[2])
  const height = Number(svg.getAttribute('viewBox')!.split(' ')[3])

  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect)
  return svg
}

/** The extent of what the renderer drew, in dots — see editor-elements.dom.test. */
function drawnExtent(): number {
  const path = document.querySelector('[data-label-canvas] g[transform] path')
  expect(path, 'nothing drawn for the symbol').not.toBeNull()
  const numbers = (path!.getAttribute('d') ?? '').match(/[\d.]+/g) ?? []
  return Math.max(...numbers.map(Number))
}

function frameWidth(): number {
  return Number(document.querySelector('rect[data-element-id]')!.getAttribute('width'))
}

/** Drag the resize handle by a delta in dots. */
function dragResizeHandle(deltaXDots: number, deltaYDots: number): void {
  const handle = document.querySelector('[data-handle="resize"]')
  expect(handle, 'no resize handle — is anything selected?').not.toBeNull()

  // happy-dom has no pointer capture; the handler calls it unconditionally.
  ;(handle as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => undefined

  fireEvent.pointerDown(handle!, { clientX: 0, clientY: 0, pointerId: 1 })
  const svg = document.querySelector('[data-label-canvas] svg')!
  fireEvent.pointerMove(svg, { clientX: deltaXDots, clientY: deltaYDots, pointerId: 1 })
  fireEvent.pointerUp(svg, { pointerId: 1 })
}

/** Select an element by clicking its hit rectangle. */
function selectFirstElement(): void {
  const rect = document.querySelector('rect[data-element-id]')!
  ;(rect as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => undefined
  fireEvent.pointerDown(rect, { clientX: 0, clientY: 0, pointerId: 1 })
  fireEvent.pointerUp(rect, { pointerId: 1 })
}

describe('dragging a QR code larger', () => {
  it('enlarges the symbol, not only its frame', () => {
    openDesignWithGeometry()
    fireEvent.click(screen.getByText('二维码'))
    selectFirstElement()

    const before = drawnExtent()
    dragResizeHandle(120, 120)

    expect(drawnExtent(), 'the symbol did not resize').toBeGreaterThan(before)
    expect(frameWidth()).toBeCloseTo(drawnExtent(), 0)
  })

  /**
   * The module width is readable straight off the drawn path: a QR is a grid,
   * so every coordinate in it is a multiple of one module. It has to be even,
   * because BWIPP draws matrix symbologies on a two-unit grid and only whole
   * steps of that grid put module edges on whole dots.
   */
  it('lands on a module width the renderer can draw', () => {
    openDesignWithGeometry()
    fireEvent.click(screen.getByText('二维码'))
    selectFirstElement()
    dragResizeHandle(160, 160)

    const d = document.querySelector('[data-label-canvas] g[transform] path')!.getAttribute('d')!
    const coords = [...new Set((d.match(/[\d.]+/g) ?? []).map(Number))].filter((n) => n > 0)
    const gcd = coords.reduce((a, b) => {
      let [x, y] = [a, b]
      while (y > 0) [x, y] = [y, x % y]
      return x
    })
    expect(gcd % 2).toBe(0)
    expect(frameWidth() % gcd).toBe(0)
  })

  it('shrinks the symbol when dragged inwards', () => {
    openDesignWithGeometry()
    fireEvent.click(screen.getByText('二维码'))
    selectFirstElement()

    // Enlarged first: a QR is created at the minimum module width, so from
    // there inwards there is nowhere legal to go and refusing is correct.
    dragResizeHandle(200, 200)
    const enlarged = drawnExtent()

    selectFirstElement()
    dragResizeHandle(-120, -120)

    expect(drawnExtent(), 'the symbol did not resize').toBeLessThan(enlarged)
    expect(frameWidth()).toBeCloseTo(drawnExtent(), 0)
  })

  /**
   * Two dots is the scanning floor, and a new QR code already sits on it. The
   * handle has to refuse rather than produce a symbol no reader can decode —
   * the inspector says why, next to the module width.
   */
  it('refuses to go below the scanning floor', () => {
    openDesignWithGeometry()
    fireEvent.click(screen.getByText('二维码'))
    selectFirstElement()

    const before = drawnExtent()
    dragResizeHandle(-60, -60)

    expect(drawnExtent()).toBe(before)
    expect(screen.getByText('已是可扫描的最小尺寸，无法再缩小')).toBeDefined()
  })

  it('keeps it square', () => {
    openDesignWithGeometry()
    fireEvent.click(screen.getByText('二维码'))
    selectFirstElement()

    dragResizeHandle(120, 20)
    const rect = document.querySelector('rect[data-element-id]')!
    expect(Number(rect.getAttribute('width'))).toBeCloseTo(Number(rect.getAttribute('height')), 0)
  })
})

describe('dragging a barcode wider', () => {
  it('widens the bars, not only the frame', () => {
    openDesignWithGeometry()
    fireEvent.click(screen.getByText('条码'))
    selectFirstElement()

    const before = frameWidth()
    const drawnBefore = drawnExtent()
    dragResizeHandle(150, 0)

    expect(frameWidth()).toBeGreaterThan(before)
    expect(drawnExtent(), 'the bars did not widen').toBeGreaterThan(drawnBefore)

    // Within one module of the frame rather than equal to it: a symbology's
    // module count includes trailing quiet modules, which are white and so
    // contribute nothing to the drawn path.
    const modulePitch = frameWidth() - drawnExtent()
    expect(modulePitch).toBeGreaterThanOrEqual(0)
    expect(modulePitch).toBeLessThan(frameWidth() / 10)
  })
})

describe('dragging a rectangle', () => {
  it('resizes freely — nothing quantises a box', () => {
    openDesignWithGeometry()
    fireEvent.click(screen.getByText('矩形'))
    selectFirstElement()

    const before = frameWidth()
    dragResizeHandle(40, 40)
    expect(frameWidth()).toBeGreaterThan(before)
  })
})
