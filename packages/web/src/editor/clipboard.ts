/**
 * Copying and pasting elements.
 *
 * The clipboard holds a detached copy of the element, not a reference to it:
 * copy, then edit the original, then paste, and what lands is what was copied.
 * Holding the id and re-reading it at paste time would produce the opposite,
 * and would break entirely once the original is deleted.
 *
 * Nothing here touches the system clipboard. An element is an object in this
 * label's coordinate system, not text, and round-tripping it through the OS
 * clipboard would mean serialising an IR fragment that any other application
 * would paste as gibberish. Images are the exception, and they arrive as
 * files — see the paste handler in the editor page.
 */
import type { LabelElement, LabelIR } from '@zenith/shared'
import { translateElement, uniqueElementId, type ElementType } from './elements.ts'

/**
 * How far a pasted copy lands from its source.
 *
 * Far enough to be visibly a second object rather than a redraw of the first,
 * and a whole number of snap steps so it stays on the grid.
 */
export const PASTE_OFFSET_MM = 2

/** The element to put on the clipboard, or null if nothing is selected. */
export function copyElement(ir: LabelIR, id: string | null): LabelElement | null {
  if (id === null) {
    return null
  }
  // Structured copy, so later edits to the original cannot reach into it.
  return structuredClone(ir.elements.find((element) => element.id === id) ?? null)
}

export interface PasteResult {
  ir: LabelIR
  /** The new element's id, so the caller can select what it just created. */
  id: string
}

/**
 * Add a copy of `element` to the label.
 *
 * It goes on top — a paste the user cannot see because it landed under
 * something else looks like a paste that did not happen.
 */
export function pasteElement(ir: LabelIR, element: LabelElement, offsetMm = PASTE_OFFSET_MM): PasteResult {
  const id = uniqueElementId(ir, element.type as ElementType)
  const placed = { ...translateElement(structuredClone(element), offsetMm, offsetMm), id }
  return { ir: { ...ir, elements: [...ir.elements, placed] }, id }
}

/** Copy and paste in one step, for Ctrl+D and the context menu. */
export function duplicateElement(ir: LabelIR, id: string | null): PasteResult | null {
  const source = copyElement(ir, id)
  return source === null ? null : pasteElement(ir, source)
}
