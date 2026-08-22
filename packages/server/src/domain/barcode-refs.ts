/**
 * Columns a barcode or QR code depends on, and whether any selected row leaves
 * one of them empty.
 *
 * Barcode content cannot be empty. Without this check the encoder throws
 * partway through the batch — after some labels are already out — and the
 * operator is left reconciling a stack against a spreadsheet.
 *
 * **This is not the per-row width check that FR-045 rules out.** It compares
 * strings, one column at a time; nothing is encoded. What FR-045 refuses is
 * encoding every row in order to measure it, which for a thousand rows means a
 * thousand encodes before the first label comes out.
 */
import { parse, type LabelIR } from '@zenith/shared'

export class BarcodeEmptyValueError extends Error {
  readonly column: string
  readonly ordinals: number[]

  constructor(column: string, ordinals: number[]) {
    super(`column "${column}" is empty in row(s): ${ordinals.join(', ')}`)
    this.name = 'BarcodeEmptyValueError'
    this.column = column
    this.ordinals = ordinals
  }
}

/** Names referenced from a barcode or QR element, de-duplicated. */
export function barcodeReferences(ir: LabelIR): string[] {
  const names: string[] = []
  for (const element of ir.elements) {
    if (element.type !== 'barcode' && element.type !== 'qrcode') {
      continue
    }
    for (const segment of parse(element.content)) {
      if (segment.kind === 'ref' && !names.includes(segment.name)) {
        names.push(segment.name)
      }
    }
  }
  return names
}

export interface SelectedRow {
  ordinal: number
  values: Record<string, string>
}

/**
 * Refuse if any barcode-bound column is blank in any selected row.
 *
 * Only names the rows actually about to print: a blank in row 900 of a table
 * where rows 1-10 were selected is somebody else's problem today.
 */
export function assertBarcodeValuesPresent(
  ir: LabelIR,
  rows: readonly SelectedRow[],
  /** Names the design resolves itself; those cannot be blank per row. */
  designValues: Readonly<Record<string, string>>,
): void {
  const columns = barcodeReferences(ir).filter((name) => designValues[name] === undefined)
  if (columns.length === 0 || rows.length === 0) {
    return
  }

  for (const column of columns) {
    const empty = rows
      .filter((row) => (row.values[column] ?? '').length === 0)
      .map((row) => row.ordinal)
    if (empty.length > 0) {
      throw new BarcodeEmptyValueError(column, empty)
    }
  }
}
