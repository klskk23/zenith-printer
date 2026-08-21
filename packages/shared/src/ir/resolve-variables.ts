/**
 * Replace variable references with literal values, producing an IR that the
 * renderer can consume without knowing anything about fields.
 *
 * Pure: the input IR is never mutated. A print job renders once per copy
 * (sequence fields differ per copy), so this runs many times against the same
 * template and must not accumulate state.
 */
import { isVariableCapable, isVariableRef, type LabelElement, type LabelIR } from './schema.ts'

export class MissingVariableError extends Error {
  readonly fieldName: string

  constructor(fieldName: string) {
    super(`no value supplied for variable field "${fieldName}"`)
    this.name = 'MissingVariableError'
    this.fieldName = fieldName
  }
}

export type VariableValues = Readonly<Record<string, string>>

function resolveElement(element: LabelElement, values: VariableValues): LabelElement {
  if (!isVariableCapable(element) || !isVariableRef(element.content)) {
    return element
  }
  const name = element.content.$var
  const value = values[name]
  if (value === undefined) {
    throw new MissingVariableError(name)
  }
  return { ...element, content: value }
}

/** Return a copy of `ir` with every variable reference replaced. */
export function resolveVariables(ir: LabelIR, values: VariableValues): LabelIR {
  return { ...ir, elements: ir.elements.map((element) => resolveElement(element, values)) }
}

/**
 * Format a sequence counter for a field, zero-padded to its configured width.
 * Overflow is refused rather than truncated or wrapped (FR-046): a silently
 * wrapped serial produces duplicates, and duplicates are the one failure mode
 * the sequence feature exists to prevent.
 */
export class SequenceOverflowError extends Error {
  readonly fieldName: string
  readonly value: number
  readonly digits: number

  constructor(fieldName: string, value: number, digits: number) {
    super(`sequence "${fieldName}" reached ${value}, which exceeds ${digits} digits`)
    this.name = 'SequenceOverflowError'
    this.fieldName = fieldName
    this.value = value
    this.digits = digits
  }
}

export function formatSequence(fieldName: string, value: number, digits: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`sequence value must be a non-negative integer, received ${value}`)
  }
  if (!Number.isInteger(digits) || digits < 1) {
    throw new Error(`sequence digits must be a positive integer, received ${digits}`)
  }
  const max = 10 ** digits - 1
  if (value > max) {
    throw new SequenceOverflowError(fieldName, value, digits)
  }
  return String(value).padStart(digits, '0')
}


/**
 * The shape needed to produce a stand-in value; both sides' field types fit.
 */
export interface SampleableField {
  name: string
  source: 'manual' | 'sequence'
  sampleValue?: string
  seqStart?: number
  seqDigits?: number
}

/**
 * Stand-in values for fields whose real content is not known yet.
 *
 * Shared because two places need the same answer and a disagreement between
 * them is invisible until it is expensive: the editor draws the design with
 * these, and the pre-print check measures overflow with them. If the editor
 * showed `1` where the check assumed `0001`, a barcode could be reported as
 * fitting on a canvas it does not fit on.
 *
 * A manual field has whatever sample the author gave it, and an empty string
 * if none — an empty box is honest about a field nobody described. A sequence
 * shows its starting number, padded, because that is the value the first label
 * of the next batch will actually carry.
 */
export function sampleValues(fields: readonly SampleableField[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    values[field.name] =
      field.source === 'manual'
        ? (field.sampleValue ?? '')
        : String(field.seqStart ?? 1).padStart(field.seqDigits ?? 1, '0')
  }
  return values
}
