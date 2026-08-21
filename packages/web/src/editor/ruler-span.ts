/**
 * Where the selected element sits, in dots, on each axis.
 *
 * Fed to the rulers so a selection is readable as a measurement rather than
 * only as a frame on the canvas: the band says where the element starts, where
 * it ends, and how many dots lie between — which is the number that decides
 * whether a barcode's quiet zone survives or a rule lands on a whole row.
 *
 * Measured with `boundsOf`, so it is the same rectangle the canvas outlines
 * and the pre-print check judges. A rotated element reports the space it
 * actually occupies, not the box it was drawn from.
 */
import { layoutGrid, type LabelIR } from '@zenith/shared'
import { boundsOf } from './guards.ts'

export interface Span {
  startDots: number
  endDots: number
}

export interface SelectionSpans {
  x: Span
  y: Span
}

/** Null when nothing is selected, or the selection has since been deleted. */
export function selectionSpans(ir: LabelIR, selectedId: string | null): SelectionSpans | null {
  if (selectedId === null) {
    return null
  }
  const element = ir.elements.find((candidate) => candidate.id === selectedId)
  if (element === undefined) {
    return null
  }

  const grid = layoutGrid({ widthMm: ir.widthMm, heightMm: ir.heightMm, dpi: ir.dpi })
  const box = boundsOf(element)

  const left = grid.xToDots(box.xMm)
  const top = grid.yToDots(box.yMm)
  return {
    x: { startDots: left, endDots: left + grid.lengthToDots(box.widthMm) },
    y: { startDots: top, endDots: top + grid.lengthToDots(box.heightMm) },
  }
}

/** How many dots the span covers. Never negative, whichever way it was drawn. */
export function spanLengthDots(span: Span): number {
  return Math.abs(span.endDots - span.startDots)
}
