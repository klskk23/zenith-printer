/**
 * Layer order.
 *
 * Draw order is the element array's order — last drawn is on top. Only
 * front/back are offered, which is what the requirement asked for: with a
 * handful of elements, arbitrary reordering is machinery nobody needs.
 *
 * The panel that uses this exists mainly so a completely covered element can
 * still be selected. Clicking the canvas cannot reach one.
 */
import type { LabelElement, LabelIR } from '@zenith/shared'

/** Topmost first — how a layer list reads. */
export function layersTopFirst(ir: LabelIR): LabelElement[] {
  return [...ir.elements].reverse()
}

export function bringToFront(ir: LabelIR, id: string): LabelIR {
  const element = ir.elements.find((e) => e.id === id)
  if (element === undefined) {
    return ir
  }
  return { ...ir, elements: [...ir.elements.filter((e) => e.id !== id), element] }
}

export function sendToBack(ir: LabelIR, id: string): LabelIR {
  const element = ir.elements.find((e) => e.id === id)
  if (element === undefined) {
    return ir
  }
  return { ...ir, elements: [element, ...ir.elements.filter((e) => e.id !== id)] }
}

export function isFrontmost(ir: LabelIR, id: string): boolean {
  return ir.elements[ir.elements.length - 1]?.id === id
}

export function isBackmost(ir: LabelIR, id: string): boolean {
  return ir.elements[0]?.id === id
}
