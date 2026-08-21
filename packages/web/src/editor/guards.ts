/**
 * Editor guards.
 *
 * These catch the mistakes that produce a label which looks right on screen and
 * wrong on paper — the expensive kind, because you only find out after the
 * stock is gone:
 *
 *   - a canvas wider than the printhead loses its right edge with no error
 *     from the device (FR-005)
 *   - a stroke thinner than one dot is anti-aliased to grey and then
 *     thresholded away entirely (FR-008)
 *   - an element outside the canvas is simply not printed (FR-006)
 *
 * The first two block the action. The third only marks the region, because
 * dragging something briefly past the edge is normal and a modal would be
 * intolerable.
 */
import {
  isVariableRef,
  layoutGrid,
  mmToDots,
  type LabelElement,
  type LabelIR,
} from '@zenith/shared'

export interface PrinterLimits {
  dpi: number
  printheadPixels: number
}

export interface Violation {
  /** Stable key for the i18n layer; never shown raw. */
  code:
    | 'CANVAS_TOO_WIDE'
    | 'STROKE_TOO_THIN'
    | 'ELEMENT_OUT_OF_BOUNDS'
    | 'BARCODE_CONTENT_EMPTY'
  elementId?: string
  /** Numbers the message needs, e.g. the limit that was exceeded. */
  values?: Record<string, number | string>
  /** Whether the editor should refuse the change or merely mark it. */
  blocking: boolean
}

const MM_PER_INCH = 25.4

export function maxCanvasWidthMm(limits: PrinterLimits): number {
  return (limits.printheadPixels / limits.dpi) * MM_PER_INCH
}

export function minStrokeWidthMm(limits: PrinterLimits): number {
  return MM_PER_INCH / limits.dpi
}

/** Bounding box of an element in millimetres. */
export function boundsOf(element: LabelElement): {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
} {
  if (element.type === 'line') {
    const xMm = Math.min(element.xMm, element.x2Mm)
    const yMm = Math.min(element.yMm, element.y2Mm)
    return {
      xMm,
      yMm,
      widthMm: Math.abs(element.x2Mm - element.xMm),
      heightMm: Math.abs(element.y2Mm - element.yMm),
    }
  }
  return {
    xMm: element.xMm,
    yMm: element.yMm,
    widthMm: element.widthMm,
    heightMm: element.heightMm,
  }
}

/** Whether any part of an element falls outside the canvas. */
export function isOutOfBounds(element: LabelElement, ir: LabelIR): boolean {
  const box = boundsOf(element)
  const epsilon = 1e-9
  return (
    box.xMm < -epsilon ||
    box.yMm < -epsilon ||
    box.xMm + box.widthMm > ir.widthMm + epsilon ||
    box.yMm + box.heightMm > ir.heightMm + epsilon
  )
}

/** Every problem with the current design, blocking ones first. */
export function inspect(ir: LabelIR, limits: PrinterLimits): Violation[] {
  const violations: Violation[] = []

  const maxWidth = maxCanvasWidthMm(limits)
  if (ir.widthMm > maxWidth + 1e-6) {
    violations.push({
      code: 'CANVAS_TOO_WIDE',
      values: { widthMm: ir.widthMm, maxWidthMm: Number(maxWidth.toFixed(2)) },
      blocking: true,
    })
  }

  for (const element of ir.elements) {
    if ('strokeWidthDots' in element && element.strokeWidthDots < 1) {
      violations.push({
        code: 'STROKE_TOO_THIN',
        elementId: element.id,
        values: { minWidthMm: Number(minStrokeWidthMm(limits).toFixed(3)) },
        blocking: true,
      })
    }

    if (
      (element.type === 'barcode' || element.type === 'qrcode') &&
      !isVariableRef(element.content) &&
      element.content.length === 0
    ) {
      violations.push({ code: 'BARCODE_CONTENT_EMPTY', elementId: element.id, blocking: true })
    }

    if (isOutOfBounds(element, ir)) {
      // Marked, not blocked: dragging past the edge is a normal intermediate
      // state and interrupting it would make the editor unusable.
      violations.push({ code: 'ELEMENT_OUT_OF_BOUNDS', elementId: element.id, blocking: false })
    }
  }

  return violations.sort((a, b) => Number(b.blocking) - Number(a.blocking))
}

export function blockingViolations(violations: Violation[]): Violation[] {
  return violations.filter((v) => v.blocking)
}

export function canPrint(ir: LabelIR, limits: PrinterLimits): boolean {
  return blockingViolations(inspect(ir, limits)).length === 0
}

/**
 * Snap a millimetre value onto the dot grid.
 * The UI steps in dots because that is the machine's actual resolution;
 * asking anyone to enter multiples of 0.125mm would be absurd.
 */
export function snapMm(valueMm: number, dpi: number): number {
  return (mmToDots(valueMm, dpi) * MM_PER_INCH) / dpi
}

/** One dot expressed in millimetres — the increment for nudge controls. */
export function dotStepMm(dpi: number): number {
  return MM_PER_INCH / dpi
}

/** Canvas size in dots, for laying out the editor viewport. */
export function canvasDots(ir: LabelIR): { widthDots: number; heightDots: number } {
  const grid = layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })
  return { widthDots: grid.widthDots, heightDots: grid.heightDots }
}
