/**
 * Overflow check for the design.
 *
 * **Runs once, not once per label.** It used to walk every copy in the batch,
 * which meant encoding a barcode for every one of them — a thousand encodes
 * before the first label could come out, which is precisely the wait the page
 * source exists to remove (FR-045). Whether row 7 of a thousand overflows is
 * now something the physical labels reveal, and the print dialog says so rather
 * than staying quiet and being read as "checked, and fine" (FR-045a).
 *
 * The result is advice. Overflow does not stop a batch (FR-067, FR-089):
 * content past the edge is clipped, and whether that is acceptable is a
 * judgement about this particular label that the operator is better placed to
 * make than the software. Holding back ninety-nine good labels because one will
 * be clipped is the worse outcome — the labels in a batch usually correspond to
 * something, and a batch with gaps in it is harder to sort out than a reprint.
 *
 * What the software owes them is knowing about it beforehand, in full.
 */
import {
  evaluate,
  renderBarcodeSvg,
  rotatedBounds,
  type LabelElement,
  type LabelIR,
} from '@zenith/shared'

export type OverflowReason = 'ELEMENT_OUT_OF_BOUNDS' | 'BARCODE_TOO_WIDE'

export interface OverflowWarning {
  /** Which label in the batch, zero-based. */
  rowIndex: number
  elementId: string
  reason: OverflowReason
  actualWidthMm: number
  availableWidthMm: number
}


/** Width a barcode will actually occupy once its content is known. */
function barcodeWidthMm(element: LabelElement, values: Record<string, string>, dpi: number): number | null {
  if (element.type !== 'barcode') {
    return null
  }
  const content = evaluate(element.content, values).text
  if (content.length === 0) {
    return null
  }
  try {
    const rendered = renderBarcodeSvg({
      symbology: element.symbology,
      content,
      heightDots: 10,
      moduleWidthDots: element.moduleWidthDots,
    })
    return (rendered.widthDots * 25.4) / dpi
  } catch {
    // Unencodable content is a different fault, reported by its own check.
    return null
  }
}

/** Warnings for one label's resolved content. */
export function checkLabel(
  ir: LabelIR,
  values: Record<string, string>,
  rowIndex: number,
): OverflowWarning[] {
  const warnings: OverflowWarning[] = []

  for (const element of ir.elements) {
    const actualWidth = barcodeWidthMm(element, values, ir.dpi)
    if (actualWidth !== null) {
      const available = ir.widthMm - element.xMm
      if (actualWidth > available + 1e-6) {
        warnings.push({
          rowIndex,
          elementId: element.id,
          reason: 'BARCODE_TOO_WIDE',
          actualWidthMm: Number(actualWidth.toFixed(2)),
          availableWidthMm: Number(available.toFixed(2)),
        })
        continue
      }
    }

    // Rotation-aware: a 40x10 element turned on its side occupies 10x40, and
    // checking its unrotated box would pass one that is half off the label.
    const box =
      element.type === 'line'
        ? rotatedBounds({
            xMm: Math.min(element.xMm, element.x2Mm),
            yMm: Math.min(element.yMm, element.y2Mm),
            widthMm: Math.abs(element.x2Mm - element.xMm),
            heightMm: Math.abs(element.y2Mm - element.yMm),
            rotation: element.rotation,
          })
        : rotatedBounds({
            xMm: element.xMm,
            yMm: element.yMm,
            widthMm: element.widthMm,
            heightMm: element.heightMm,
            rotation: element.rotation,
          })

    const outside =
      box.xMm < -1e-9 ||
      box.yMm < -1e-9 ||
      box.xMm + box.widthMm > ir.widthMm + 1e-6 ||
      box.yMm + box.heightMm > ir.heightMm + 1e-6

    if (outside) {
      warnings.push({
        rowIndex,
        elementId: element.id,
        reason: 'ELEMENT_OUT_OF_BOUNDS',
        actualWidthMm: Number((box.xMm + box.widthMm).toFixed(2)),
        availableWidthMm: Number(ir.widthMm.toFixed(2)),
      })
    }
  }

  return warnings
}
