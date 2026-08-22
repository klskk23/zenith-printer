/**
 * Give elements a size, for tests that mount a virtualised list.
 *
 * happy-dom reports `getBoundingClientRect()` as all zeros and `offsetWidth` /
 * `offsetHeight` as 0, because it does no layout. A virtualiser asks how tall
 * the viewport is, is told nothing, and renders nothing — so a grid that works
 * perfectly in a browser mounts empty here.
 *
 * This compensates for the environment, not for a defect: in a browser the
 * container genuinely has a size. Without it the render assertion the
 * constitution requires would be impossible for any virtualised page, and the
 * alternative — asserting only "it did not throw" — is the weak form that let
 * an empty page pass once already.
 *
 * Scoped deliberately: call it from the files that need it rather than from a
 * global setup. Several editor tests read rects expecting zeros, and changing
 * that everywhere would move a lot of assertions for the benefit of two pages.
 */
const VIEWPORT = { width: 1024, height: 768 }

export interface SizeOptions {
  width?: number
  height?: number
}

/**
 * Patch layout measurement for the current test file.
 *
 * Returns the restore function; pass it to `afterEach` so one file's stub does
 * not leak into the next.
 */
export function giveElementsSize(options: SizeOptions = {}): () => void {
  const width = options.width ?? VIEWPORT.width
  const height = options.height ?? VIEWPORT.height

  const originalRect = Element.prototype.getBoundingClientRect
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')

  /**
   * An element's own inline size wins where it has one.
   *
   * A virtualised grid sets explicit pixel heights on its rows; reporting the
   * viewport height for those too would make every row look 768px tall and the
   * virtualiser would render exactly one.
   */
  function sizeOf(element: Element): { width: number; height: number } {
    const style = (element as HTMLElement).style
    const own = (value: string, fallback: number): number => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    }
    return { width: own(style?.width ?? '', width), height: own(style?.height ?? '', height) }
  }

  Element.prototype.getBoundingClientRect = function patched(this: Element): DOMRect {
    const { width: w, height: h } = sizeOf(this)
    return {
      x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h,
      toJSON: () => ({}),
    } as DOMRect
  }

  const define = (proto: object, name: string, get: (this: Element) => number): void => {
    Object.defineProperty(proto, name, { configurable: true, get })
  }
  define(HTMLElement.prototype, 'offsetWidth', function () { return sizeOf(this).width })
  define(HTMLElement.prototype, 'offsetHeight', function () { return sizeOf(this).height })
  define(Element.prototype, 'clientWidth', function () { return sizeOf(this).width })
  define(Element.prototype, 'clientHeight', function () { return sizeOf(this).height })

  return () => {
    Element.prototype.getBoundingClientRect = originalRect
    const restore = (proto: object, name: string, descriptor: PropertyDescriptor | undefined): void => {
      if (descriptor === undefined) {
        Reflect.deleteProperty(proto, name)
        return
      }
      Object.defineProperty(proto, name, descriptor)
    }
    restore(HTMLElement.prototype, 'offsetWidth', offsetWidth)
    restore(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    restore(Element.prototype, 'clientWidth', clientWidth)
    restore(Element.prototype, 'clientHeight', clientHeight)
  }
}
