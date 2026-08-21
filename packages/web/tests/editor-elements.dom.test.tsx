/**
 * Element editing: rotation, copy/paste, and choosing an image.
 *
 * All three were reported as absent by someone using the application, and all
 * three were absent in the same way — the rule existed, the endpoint existed,
 * the translated label existed, and no control was ever rendered that reached
 * them. So these tests mount the real editor and drive the real controls; a
 * test of the underlying module would have passed throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App.tsx'

const uploaded: File[] = []

function wrap(ui: React.ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

afterEach(() => {
  cleanup()
  // The image-decoder stubs below would otherwise outlive their tests.
  vi.unstubAllGlobals()
})
beforeEach(() => {
  uploaded.length = 0
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    let body: unknown = {}
    if (url.includes('/api/images') && init?.method === 'POST') {
      const form = init.body as FormData
      uploaded.push(form.get('file') as File)
      body = { id: 'img-1', filename: 'pasted.png', mimeType: 'image/png', sizeBytes: 3 }
    } else if (url.includes('/printers')) {
      body = { printers: [] }
    } else if (url.includes('/templates')) {
      body = { templates: [] }
    } else if (url.includes('/print-jobs')) {
      body = { jobs: [] }
    }
    return Promise.resolve({
      ok: true,
      status: url.includes('/api/images') && init?.method === 'POST' ? 201 : 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }))
})

/** Open the design page and return the editor's root, which owns the keys. */
function openDesign(): HTMLElement {
  render(wrap(<App />))
  fireEvent.click(screen.getAllByText('标签设计')[0]!)
  const toolbar = screen.getByRole('toolbar', { name: '标签设计' })
  const root = toolbar.closest('[tabindex]')
  expect(root, 'editor root not found').not.toBeNull()
  return root as HTMLElement
}

/** Add an element from the palette by its translated name. */
function addElement(name: string): void {
  fireEvent.click(screen.getByText(name))
}

function elementRects(): SVGRectElement[] {
  return [...document.querySelectorAll('rect[data-element-id]')] as SVGRectElement[]
}

describe('rotation control', () => {
  it('is offered for a selected element', () => {
    openDesign()
    addElement('矩形')
    for (const degrees of ['0°', '90°', '180°', '270°']) {
      expect(screen.getByRole('radio', { name: degrees }), `no ${degrees} option`).toBeDefined()
    }
  })

  /**
   * Asserted through the rendered SVG rather than through the control's own
   * pressed state: the point of the field is that it reaches the label, and a
   * toggle that highlights itself while changing nothing is exactly the
   * failure this file exists to catch.
   */
  it('turns the element in the rendered label', () => {
    openDesign()
    addElement('矩形')
    expect(document.querySelector('g[transform*="rotate"]')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: '90°' }))

    const rotated = document.querySelector('g[transform*="rotate"]')
    expect(rotated, 'no rotation reached the renderer').not.toBeNull()
    expect(rotated!.getAttribute('transform')).toMatch(/rotate\(90 [\d.]+ [\d.]+\)/)
  })

  it('shows the rotation the element already has', () => {
    openDesign()
    addElement('矩形')
    fireEvent.click(screen.getByRole('radio', { name: '180°' }))
    expect(screen.getByRole('radio', { name: '180°' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: '0°' }).getAttribute('aria-checked')).toBe('false')
  })
})

describe('copy and paste', () => {
  it('duplicates the selected element with Ctrl+D', () => {
    const root = openDesign()
    addElement('矩形')
    expect(elementRects()).toHaveLength(1)

    fireEvent.keyDown(root, { key: 'd', ctrlKey: true })
    expect(elementRects()).toHaveLength(2)
  })

  it('copies with Ctrl+C and pastes with Ctrl+V', () => {
    const root = openDesign()
    addElement('矩形')

    fireEvent.keyDown(root, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(root, { key: 'v', ctrlKey: true })
    fireEvent.keyDown(root, { key: 'v', ctrlKey: true })

    // Two pastes, two new elements — not one clipboard entry pasted once.
    expect(elementRects()).toHaveLength(3)
  })

  it('leaves the copy somewhere the user can see it', () => {
    const root = openDesign()
    addElement('矩形')
    const before = elementRects()[0]!.getAttribute('x')

    fireEvent.keyDown(root, { key: 'd', ctrlKey: true })
    const positions = elementRects().map((rect) => rect.getAttribute('x'))
    expect(new Set(positions).size).toBe(2)
    expect(positions).toContain(before)
  })

  it('does not steal Ctrl+C from a field being typed in', () => {
    const root = openDesign()
    addElement('文字')
    const textarea = document.querySelector('textarea')
    expect(textarea, 'text element has no content field').not.toBeNull()

    fireEvent.keyDown(textarea!, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(root, { key: 'v', ctrlKey: true })
    // Nothing was copied, so nothing pastes — the browser's own copy ran.
    expect(elementRects()).toHaveLength(1)
  })
})

describe('choosing an image', () => {
  it('offers a picker on an image element', () => {
    openDesign()
    addElement('图片')
    expect(screen.getByText('选择图片…')).toBeDefined()
    expect(screen.getByText('尚未选择图片')).toBeDefined()
  })

  it('rejects a file the server would reject, without sending it', () => {
    openDesign()
    addElement('图片')
    const input = screen.getByLabelText('图片') as HTMLInputElement
    const bad = new File(['x'], 'note.txt', { type: 'text/plain' })
    Object.defineProperty(input, 'files', { value: [bad], configurable: true })

    fireEvent.change(input)

    expect(screen.getByText('只支持 PNG 和 JPEG 图片')).toBeDefined()
    expect(uploaded).toHaveLength(0)
  })

  it('uploads a chosen file and points the element at the result', async () => {
    openDesign()
    addElement('图片')
    const input = screen.getByLabelText('图片') as HTMLInputElement
    const png = new File(['abc'], 'logo.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [png], configurable: true })

    fireEvent.change(input)

    await vi.waitFor(() => expect(uploaded).toHaveLength(1))
    // The element carries the returned id, which is what the print renderer
    // resolves — the picker is not merely showing a local preview.
    await vi.waitFor(() =>
      expect(document.querySelector('image[href="/api/images/img-1/content"]')).not.toBeNull(),
    )
  })
})

describe('pasting an image from the clipboard', () => {
  it('uploads it and adds an image element', async () => {
    openDesign()
    expect(elementRects()).toHaveLength(0)

    const png = new File(['abc'], 'pasted.png', { type: 'image/png' })
    // Fired at the document, which is where a paste actually lands once the
    // user has clicked the canvas — a handler bound to the editor element
    // never saw it, and this test would have certified that as working.
    fireEvent.paste(document, { clipboardData: { files: [png], items: [], getData: () => '' } })

    await vi.waitFor(() => expect(uploaded).toHaveLength(1))
    await vi.waitFor(() => expect(elementRects()).toHaveLength(1))
    await vi.waitFor(() =>
      expect(document.querySelector('image[href="/api/images/img-1/content"]')).not.toBeNull(),
    )
  })

  it('ignores a paste that carries no image', () => {
    openDesign()
    fireEvent.paste(document, { clipboardData: { files: [], items: [], getData: () => 'hello' } })
    expect(uploaded).toHaveLength(0)
    expect(elementRects()).toHaveLength(0)
  })
})

describe('the snapping grid', () => {
  /**
   * Snapping was reported as not implemented. It was implemented — it rounded
   * to whole dots, which at 203 dpi is 0.125 mm, and it drew nothing. A rule
   * finer than the lines drawn over it and invisible besides is
   * indistinguishable from no rule at all, so "is it drawn" is part of the
   * feature rather than decoration.
   */
  it('is drawn on the canvas', () => {
    openDesign()
    const grid = document.querySelector('[data-layout-grid]')
    expect(grid, 'no grid drawn on the canvas').not.toBeNull()
    expect(document.querySelector('pattern#layout-grid')).not.toBeNull()
  })

  it('spaces the grid a millimetre apart, not a dot apart', () => {
    openDesign()
    const pattern = document.querySelector('pattern#layout-grid')!
    // 1 mm at 203 dpi is 8 dots, and the canvas is measured in dots.
    expect(Number(pattern.getAttribute('width'))).toBeGreaterThan(4)
  })

  it('does not take pointer events away from the elements above it', () => {
    openDesign()
    expect(document.querySelector('[data-layout-grid]')!.getAttribute('pointer-events')).toBe('none')
  })
})

/** The interaction frame the user sees and grabs, in dots. */
function frameOf(index = 0): { width: number; height: number } {
  const rect = elementRects()[index]!
  return { width: Number(rect.getAttribute('width')), height: Number(rect.getAttribute('height')) }
}

/** 1 mm at the 203 dpi the blank label uses. */
const MM = 203 / 25.4

describe('the box around a text element', () => {
  /**
   * A new text element declares a 30x5 mm box and holds about 6x3 mm of
   * glyphs, and nothing in the renderer derives one from the other: `heightMm`
   * does not affect the drawing at all and `widthMm` only places the anchor
   * for centred and right-aligned text. The frame, the overflow check and the
   * layers panel all described the declared box.
   */
  it('fits the glyphs rather than the declared 30 mm', () => {
    openDesign()
    addElement('文字')
    expect(frameOf().width).toBeLessThan(20 * MM)
    expect(frameOf().height).toBeCloseTo(3 * MM, 0)
  })

  it('follows the text as it is typed', () => {
    openDesign()
    addElement('文字')
    const before = frameOf().width

    const textarea = document.querySelector('textarea')!
    fireEvent.change(textarea, { target: { value: 'a much longer piece of text' } })

    expect(frameOf().width).toBeGreaterThan(before)
  })

  it('grows a line at a time', () => {
    openDesign()
    addElement('文字')
    const oneLine = frameOf().height

    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'a\nb\nc' } })

    // Three lines at the renderer's own 1.2 line height.
    expect(frameOf().height).toBeCloseTo(oneLine * (1 + 1.2 * 2), 0)
  })

  it('stays grabbable while the field is empty', () => {
    openDesign()
    addElement('文字')
    fireEvent.change(document.querySelector('textarea')!, { target: { value: '' } })
    expect(frameOf().width).toBeGreaterThan(0)
    expect(frameOf().height).toBeGreaterThan(0)
  })

  it('does not refit when the element is merely moved', () => {
    openDesign()
    addElement('文字')
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'fixed' } })
    const fitted = frameOf().width

    // Widen the box by hand, then move the element: the width the user chose
    // has to survive a move, or nudging anything would undo their layout.
    const xField = [...document.querySelectorAll('label')].find((l) => l.textContent === 'X 坐标')!
    fireEvent.change(xField.parentElement!.querySelector('input')!, { target: { value: '10' } })

    expect(frameOf().width).toBeCloseTo(fitted, 6)
  })
})

describe('the box around a pasted image', () => {
  /** A stand-in decoder: every picture reports the same shape. */
  function stubImageDecoder(width: number, height: number): void {
    class FakeImage {
      naturalWidth = width
      naturalHeight = height
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', FakeImage)
  }

  /**
   * The default image box is a 15 mm square and the renderer letterboxes into
   * it, so a 16:9 screenshot was drawn as a strip across the middle with the
   * frame around the whole square.
   */
  it('takes the picture’s own proportions', async () => {
    stubImageDecoder(1600, 900)
    openDesign()

    const png = new File(['abc'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(document, { clipboardData: { files: [png], items: [], getData: () => '' } })

    await vi.waitFor(() => expect(elementRects()).toHaveLength(1))
    await vi.waitFor(() => {
      const frame = frameOf()
      expect(frame.width / frame.height).toBeCloseTo(1600 / 900, 1)
    })
  })

  it('still places the image when the picture cannot be measured', async () => {
    // The decoder that never answers. The upload must not be waiting on it.
    class SilentImage {
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {}
    }
    vi.stubGlobal('Image', SilentImage)
    openDesign()

    const png = new File(['abc'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(document, { clipboardData: { files: [png], items: [], getData: () => '' } })

    await vi.waitFor(() =>
      expect(document.querySelector('image[href="/api/images/img-1/content"]')).not.toBeNull(),
    )
  })
})

/**
 * The field sitting under a given label **in the inspector**.
 *
 * Scoped deliberately. The left column's canvas size fields carry the same two
 * labels, and they come first in the document — an unscoped query found those
 * instead, so three tests here passed a value to the canvas and then reported
 * that the element had not resized.
 */
function mmField(label: string): HTMLInputElement | HTMLTextAreaElement {
  const inspector = document.querySelector('[data-inspector]')
  expect(inspector, 'inspector not rendered').not.toBeNull()
  const found = [...inspector!.querySelectorAll('label')].find((l) => l.textContent === label)
  expect(found, `no field labelled ${label}`).toBeDefined()
  // Either kind: the content field is a textarea for the types that can hold
  // more than one line.
  const control = found!.parentElement!.querySelector('input, textarea')
  expect(control, `no control under ${label}`).not.toBeNull()
  return control as HTMLInputElement | HTMLTextAreaElement
}

/**
 * The extent of what the renderer actually drew, in dots.
 *
 * A symbol comes out as one `<path>` whose coordinates are dots in the
 * element's own space, starting at zero — so the largest number in it is the
 * symbol's side. Reading it is the only way to tell a box that resized from a
 * symbol that resized: the box follows whatever number is typed into it
 * whether or not the renderer agrees.
 */
function drawnExtent(): number {
  const path = document.querySelector('[data-label-canvas] g[transform] path')
  expect(path, 'nothing drawn for the symbol').not.toBeNull()
  const numbers = (path!.getAttribute('d') ?? '').match(/[\d.]+/g) ?? []
  expect(numbers.length, 'symbol path carries no coordinates').toBeGreaterThan(0)
  return Math.max(...numbers.map(Number))
}

describe('sizing a QR code', () => {
  /**
   * A QR's side is moduleWidth x moduleCount, and the renderer takes the
   * *smaller* of that and the declared box. So a new QR — a 15 mm square
   * holding about 6 mm of symbol — could only ever be made smaller: typing a
   * larger width was stored and changed nothing at all on the canvas.
   */
  it('grows when the width field is increased', () => {
    openDesign()
    addElement('二维码')
    const before = drawnExtent()

    fireEvent.change(mmField('宽度'), { target: { value: '25' } })

    // Measured from the symbol the renderer drew, not from the box the element
    // declares. The box always followed the number typed into it; the symbol
    // did not, because the renderer sizes it from the module width and takes
    // the smaller of that and the box.
    expect(drawnExtent()).toBeGreaterThan(before)
  })

  it('starts out the size of the symbol, not of the default square', () => {
    openDesign()
    addElement('二维码')
    // The declared square was 15 mm and the symbol inside it was not; the
    // frame now reports the symbol.
    expect(frameOf().width).toBeLessThan(15 * MM)
    expect(frameOf().width).toBeCloseTo(drawnExtent(), 0)
  })

  it('stays square', () => {
    openDesign()
    addElement('二维码')
    fireEvent.change(mmField('宽度'), { target: { value: '25' } })
    const frame = frameOf()
    expect(frame.width).toBeCloseTo(frame.height, 6)
  })

  /**
   * The frame has to equal the symbol, not merely contain it — that equality
   * is what makes the overflow warning mean something.
   */
  /**
   * The frame has to *equal* the symbol, not merely contain it — that equality
   * is what makes the overflow warning mean anything.
   */
  it.each(['20', '25', '8'])('draws the symbol at exactly the size of its frame (%s mm)', (width) => {
    openDesign()
    addElement('二维码')
    fireEvent.change(mmField('宽度'), { target: { value: width } })
    expect(frameOf().width).toBeCloseTo(drawnExtent(), 0)
    expect(frameOf().height).toBeCloseTo(drawnExtent(), 0)
  })

  it('resizes when the module width is changed', () => {
    openDesign()
    addElement('二维码')
    const before = drawnExtent()

    fireEvent.change(mmField('模块宽度'), { target: { value: '6' } })

    // Three times the module width is three times the side, and the frame
    // comes with it.
    expect(drawnExtent()).toBeCloseTo(before * 3, 0)
    expect(frameOf().width).toBeCloseTo(drawnExtent(), 0)
  })

  it('regrows when the content gets longer', () => {
    openDesign()
    addElement('二维码')
    const before = drawnExtent()

    fireEvent.change(mmField('内容'), { target: { value: 'x'.repeat(200) } })

    // More content is more modules, and more modules at the same module width
    // is a larger symbol.
    expect(drawnExtent()).toBeGreaterThan(before)
    expect(frameOf().width).toBeCloseTo(drawnExtent(), 0)
  })

  it('does not offer a height field that would be ignored', () => {
    openDesign()
    addElement('二维码')
    expect((mmField('高度') as HTMLInputElement).disabled).toBe(true)
  })
})

describe('sizing a barcode', () => {
  it('keeps its box equal to the width the module count produces', () => {
    openDesign()
    addElement('条码')
    const before = frameOf().width

    fireEvent.change(mmField('模块宽度'), { target: { value: '4' } })

    // The declared box used to stay where it was while the bars doubled.
    expect(frameOf().width).toBeCloseTo(before * 2, 0)
  })

  it('leaves the height alone — a barcode’s height is a free choice', () => {
    openDesign()
    addElement('条码')
    fireEvent.change(mmField('高度'), { target: { value: '12' } })
    expect(frameOf().height).toBeCloseTo(12 * MM, 0)
  })
})

describe('QR code content', () => {
  /**
   * A QR code holds bytes, and a newline is a byte like any other — a vCard, a
   * Wi-Fi credential and a postal address are all several lines by definition.
   * The encoder handled them the whole time; the editor offered a single-line
   * field, so there was no way to type one.
   */
  it('is entered in a field that accepts more than one line', () => {
    openDesign()
    addElement('二维码')
    const field = mmField('内容')
    expect(field.tagName).toBe('TEXTAREA')
  })

  it('encodes the newline rather than dropping it', () => {
    openDesign()
    addElement('二维码')

    // Two contents of the same length differing only in that one byte. If the
    // newline were stripped or turned into a space on the way to the encoder,
    // the two symbols would be identical — which is why this compares the
    // pattern rather than the size: both encode to the same number of modules,
    // so a size assertion here would pass either way.
    fireEvent.change(mmField('内容'), { target: { value: 'a b' } })
    const withSpace = document.querySelector('[data-label-canvas] g[transform] path')!.getAttribute('d')

    fireEvent.change(mmField('内容'), { target: { value: 'a\nb' } })
    const withNewline = document.querySelector('[data-label-canvas] g[transform] path')!.getAttribute('d')

    expect((mmField('内容') as HTMLTextAreaElement).value).toContain('\n')
    expect(withNewline).not.toBe(withSpace)
  })

  it('grows for content long enough to need more modules', () => {
    openDesign()
    addElement('二维码')
    const before = drawnExtent()
    fireEvent.change(mmField('内容'), {
      target: { value: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') },
    })
    expect(drawnExtent()).toBeGreaterThan(before)
  })

  it('keeps a barcode on a single-line field', () => {
    // The numeric symbologies cannot carry a newline at all, and a scanner
    // emitting one mid-field is rarely what anyone wanted.
    openDesign()
    addElement('条码')
    expect(mmField('内容').tagName).toBe('INPUT')
  })
})

describe('content that cannot be encoded', () => {
  /**
   * Clearing a QR code's content blanked the entire application.
   *
   * The editor renders the label inside React's render pass, and `irToSvg`
   * threw a `QrcodeContentError` for empty content — so the throw escaped
   * render and React unmounted the whole tree. Every state a half-typed symbol
   * passes through is reachable this way: a cleared QR code, an EAN-13 that is
   * three digits in.
   */
  it('survives a QR code whose content is deleted', () => {
    openDesign()
    addElement('矩形')
    // Added second, so it is the one selected and its content field is the one
    // in the inspector.
    addElement('二维码')

    fireEvent.change(mmField('内容'), { target: { value: '' } })

    // Still an application, and still the label — the other element is intact.
    expect(screen.getByRole('toolbar', { name: '标签设计' })).toBeDefined()
    expect(document.querySelector('[data-label-canvas]')).not.toBeNull()
  })

  it('survives a barcode part-way through a valid number', () => {
    openDesign()
    addElement('条码')
    const symbology = document
      .querySelector('[data-inspector]')!
      .querySelectorAll('select')[0] as HTMLSelectElement
    fireEvent.change(symbology, { target: { value: 'ean13' } })
    fireEvent.change(mmField('内容'), { target: { value: '49' } })

    expect(screen.getByRole('toolbar', { name: '标签设计' })).toBeDefined()
  })

  it('keeps the rest of the label drawn', () => {
    openDesign()
    addElement('矩形')
    addElement('二维码')
    expect(elementRects()).toHaveLength(2)

    fireEvent.change(mmField('内容'), { target: { value: '' } })

    // The unencodable element is left out of the drawing, not the label: it is
    // still selectable, still in the layer list, and still editable — which is
    // the only way to type the content back in.
    expect(elementRects()).toHaveLength(2)
    expect(mmField('内容')).toBeDefined()
  })

  it('says why, rather than leaving an element mysteriously blank', () => {
    openDesign()
    addElement('二维码')
    fireEvent.change(mmField('内容'), { target: { value: '' } })
    expect(screen.getByText('条码内容为空')).toBeDefined()
  })
})

describe('making a QR code smaller', () => {
  /**
   * BWIPP draws a QR on a two-unit grid, so the module width passed to it was
   * half what it produced: the smallest QR was twice the size it needed to be
   * and could not be reduced, while the inspector reported a 0.25 mm module
   * and drew a 0.5 mm one.
   */
  it('reaches a module width of two dots', () => {
    openDesign()
    addElement('二维码')
    const hint = document.querySelector('[data-inspector]')!.textContent ?? ''
    expect(hint).toContain('2 dot')
    expect(hint).toContain('0.250 mm')
  })

  it('draws modules of exactly that width', () => {
    openDesign()
    addElement('二维码')
    const d = document.querySelector('[data-label-canvas] g[transform] path')!.getAttribute('d')!
    const coords = [...new Set((d.match(/[\d.]+/g) ?? []).map(Number))].filter((n) => n > 0)
    const gcd = coords.reduce((a, b) => {
      let [x, y] = [a, b]
      while (y > 0) [x, y] = [y, x % y]
      return x
    })
    // Two dots, not the four the doubled scale produced.
    expect(gcd).toBe(2)
  })
})

describe('the warning strip under the canvas', () => {
  /**
   * Overflow used to be listed there. Dragging an element produces and clears
   * one on every pointer move, so the strip appeared and vanished under the
   * hand doing the dragging, and shoved the warnings that do need reading
   * around the screen.
   *
   * It is still reported twice, and both are better: the canvas outlines the
   * element in red the moment it crosses the edge, and the print dialog lists
   * what will be clipped before any stock is consumed.
   */
  it('says nothing about an element hanging off the edge', () => {
    openDesign()
    addElement('矩形')

    const xField = [...document.querySelectorAll('label')].find((l) => l.textContent === 'X 坐标')!
    fireEvent.change(xField.parentElement!.querySelector('input')!, { target: { value: '48' } })

    expect(screen.queryByText(/超出画布/)).toBeNull()
  })

  it('still outlines it on the canvas', () => {
    openDesign()
    addElement('矩形')
    const xField = [...document.querySelectorAll('label')].find((l) => l.textContent === 'X 坐标')!
    fireEvent.change(xField.parentElement!.querySelector('input')!, { target: { value: '48' } })

    // Deselected first: a selected element is outlined in the selection colour
    // whether or not it overflows, so the overflow colour is only visible once
    // nothing is selected.
    fireEvent.pointerDown(document.querySelector('[data-label-canvas] svg')!)

    // The silent signal stays. It costs no layout and never moves anything,
    // which is exactly what the banner could not manage.
    expect(elementRects()[0]!.getAttribute('stroke')).toBe('#dc2626')
  })

  it('still says something that genuinely blocks printing', () => {
    // Removing the noise must not remove the strip: an image with no file
    // chosen cannot print, and that has to stay visible.
    openDesign()
    addElement('图片')
    expect(screen.getByText('还没有为这个图片元素选择图片')).toBeDefined()
  })
})

describe('the rulers', () => {
  function highlights(): SVGElement[] {
    return [...document.querySelectorAll('[data-ruler-highlight]')] as SVGElement[]
  }

  it('shows nothing while nothing is selected', () => {
    openDesign()
    expect(highlights()).toHaveLength(0)
  })

  /**
   * One band per axis. A frame on the canvas says where an element is relative
   * to the other elements; the rulers say where it is relative to the paper,
   * which is the question a ruler exists to answer.
   */
  it('bands both axes for the selected element', () => {
    openDesign()
    addElement('矩形')
    expect(highlights()).toHaveLength(2)
  })

  it('spells out the extent in dots', () => {
    openDesign()
    addElement('矩形')
    const spans = [...document.querySelectorAll('[data-ruler-span]')].map((n) => n.textContent)
    // A new rectangle is 20x10 mm, which at 203 dpi is 160x80 dots.
    expect(spans).toContain('160')
    expect(spans).toContain('80')
  })

  it('follows the element as it moves', () => {
    openDesign()
    addElement('矩形')
    const before = highlights()[0]!.querySelector('rect')!.getAttribute('x')

    const xField = [...document.querySelectorAll('label')].find((l) => l.textContent === 'X 坐标')!
    fireEvent.change(xField.parentElement!.querySelector('input')!, { target: { value: '20' } })

    expect(highlights()[0]!.querySelector('rect')!.getAttribute('x')).not.toBe(before)
  })

  it('reports the space a rotated element actually occupies', () => {
    // A 20x10 turned a quarter turn covers 10x20; a ruler saying otherwise
    // would contradict the frame drawn around it on the canvas.
    openDesign()
    addElement('矩形')
    fireEvent.click(screen.getByRole('radio', { name: '90°' }))

    const spans = [...document.querySelectorAll('[data-ruler-span]')].map((n) => n.textContent)
    expect(spans).toContain('80')
    expect(spans).toContain('160')
  })

  it('clears when the element is deleted', () => {
    openDesign()
    addElement('矩形')
    fireEvent.keyDown(screen.getByRole('toolbar', { name: '标签设计' }).closest('[tabindex]')!, {
      key: 'Delete',
    })
    expect(highlights()).toHaveLength(0)
  })

  it('does not take pointer events from the ruler', () => {
    openDesign()
    addElement('矩形')
    expect(highlights()[0]!.getAttribute('pointer-events')).toBe('none')
  })
})

describe('binding an element to a variable field', () => {
  /**
   * Radix activates a tab on focus, not on click, so a bare click leaves the
   * panel where it was — and every assertion after it passes against the wrong
   * panel.
   */
  function openFieldsTab(): void {
    const tab = screen.getByRole('tab', { name: '可变字段' })
    fireEvent.focus(tab)
    fireEvent.click(tab)
    expect(document.querySelector('[data-inspector]'), 'the fields tab did not open').toBeNull()
  }

  /**
   * The crash: `irToSvg` refuses a `$var` it has no value for — correct when
   * printing, since a label with a hole where a part number belongs is worse
   * than one that does not print. But the editor is where bindings are *made*,
   * and it draws inside React's render pass, so the throw escaped and blanked
   * the application the moment a field was added.
   */
  it.each(['手工填入', '递增序号'])('survives adding a %s field', (kind) => {
    openDesign()
    addElement('文字')

    openFieldsTab()
    fireEvent.click(screen.getByText(kind))

    expect(screen.getByRole('toolbar', { name: '标签设计' })).toBeDefined()
    expect(document.querySelector('[data-label-canvas]')).not.toBeNull()
  })

  it('draws the sample value rather than nothing', () => {
    openDesign()
    addElement('文字')
    openFieldsTab()
    fireEvent.click(screen.getByText('手工填入'))

    // Something is still drawn where the text was: a bound element shows what
    // it will say, so the layout can be judged before the values exist.
    expect(document.querySelector('[data-label-canvas] text')).not.toBeNull()
  })

  it('keeps the binding in the design, not the sample', () => {
    // The stored element has to keep pointing at the field; drawing a sample
    // must not write the sample back.
    openDesign()
    addElement('文字')
    openFieldsTab()
    fireEvent.click(screen.getByText('递增序号'))

    const propertiesTab = screen.getByRole('tab', { name: '元素属性' })
    fireEvent.focus(propertiesTab)
    fireEvent.click(propertiesTab)
    // A bound element has no free-text content field to type into.
    const inspector = document.querySelector('[data-inspector]')!
    expect(inspector.querySelector('textarea')).toBeNull()
  })
})
