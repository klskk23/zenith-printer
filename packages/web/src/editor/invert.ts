/**
 * Turning one element's ink white, or back to black.
 *
 * A function of its own rather than a spread at the call site: the inspector
 * and the right-click menu both do this, and the "which element, leave the
 * rest alone" part is exactly what gets written subtly differently twice.
 */
import type { LabelIR } from '@zenith/shared'

export function setInverted(ir: LabelIR, id: string, inverted: boolean): LabelIR {
  return {
    ...ir,
    elements: ir.elements.map((element) =>
      // Guarded: barcodes, QR codes and images have no such field, and adding
      // one here would put a property in the design that the schema refuses.
      element.id === id && 'inverted' in element ? { ...element, inverted } : element,
    ),
  }
}
