/**
 * Variable fields.
 *
 * The feature that stops a template library from filling up with near-copies
 * that differ by one string. Two kinds, and the distinction matters:
 *
 *   - `manual`: typed in before printing; every copy in the batch shares it.
 *   - `sequence`: derived per copy, so eighty labels carry eighty numbers.
 *
 * Sequences are the delicate one. A repeated serial is a real problem — two
 * boxes with the same number cannot be told apart afterwards — while a skipped
 * one is merely a gap in a ledger. Every rule below follows from that
 * asymmetry: **skipping is harmless, repeating is not.**
 */
import { z } from 'zod'

export const fieldSourceSchema = z.enum(['manual', 'sequence'])
export type FieldSource = z.infer<typeof fieldSourceSchema>

export const MAX_SEQUENCE_DIGITS = 12

export const variableFieldSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'field name must be an identifier'),
    label: z.string().min(1).max(60),
    source: fieldSourceSchema,
    /** `manual` only: shown in the editor so the layout can be judged (FR-039). */
    sampleValue: z.string().max(200).optional(),
    seqStart: z.number().int().min(0).optional(),
    seqDigits: z.number().int().min(1).max(MAX_SEQUENCE_DIGITS).optional(),
    seqStep: z.number().int().min(1).optional(),
  })
  .refine(
    (field) =>
      field.source !== 'sequence' ||
      (field.seqStart !== undefined && field.seqDigits !== undefined && field.seqStep !== undefined),
    { message: 'a sequence field needs seqStart, seqDigits and seqStep', path: ['seqStart'] },
  )
  .refine((field) => field.source !== 'manual' || field.sampleValue !== undefined, {
    message: 'a manual field needs a sample value for the editor preview',
    path: ['sampleValue'],
  })

export type VariableField = z.infer<typeof variableFieldSchema>

/** Largest value the configured width can represent. */
export function maxRepresentable(digits: number): number {
  return 10 ** digits - 1
}

export interface SequenceRange {
  start: number
  end: number
  step: number
  /** Padding width. Stored, never inferred from `end` — see print-job.ts. */
  digits: number
}

export class SequenceOverflowError extends Error {
  readonly fieldName: string
  readonly requestedEnd: number
  readonly maxValue: number

  constructor(fieldName: string, requestedEnd: number, maxValue: number) {
    super(`sequence "${fieldName}" would reach ${requestedEnd}, above the maximum ${maxValue}`)
    this.name = 'SequenceOverflowError'
    this.fieldName = fieldName
    this.requestedEnd = requestedEnd
    this.maxValue = maxValue
  }
}

/**
 * The span a job of `copies` labels will consume, starting at `start`.
 *
 * `end` is the last value actually used, so a one-copy job spans a single
 * number rather than a half-open interval nobody can read at a glance.
 */
export function rangeFor(
  field: VariableField,
  start: number,
  copies: number,
): SequenceRange {
  if (field.source !== 'sequence') {
    throw new Error(`field "${field.name}" is not a sequence`)
  }
  const step = field.seqStep ?? 1
  const digits = field.seqDigits ?? 1
  const end = start + (copies - 1) * step

  const max = maxRepresentable(digits)
  if (end > max) {
    // Refused, not wrapped. Wrapping 999 back to 000 silently reissues serials
    // that already exist on physical labels (FR-046).
    throw new SequenceOverflowError(field.name, end, max)
  }

  return { start, end, step, digits }
}

/** Value for one copy within a locked range. */
export function valueAt(range: SequenceRange, copyIndex: number): string {
  return String(range.start + copyIndex * range.step).padStart(range.digits, '0')
}

/** Next free value after a range has been consumed. */
export function nextAfter(range: SequenceRange): number {
  return range.end + range.step
}

/** Whether two ranges of the same field would issue any common value. */
export function overlaps(a: SequenceRange, b: SequenceRange): boolean {
  return a.start <= b.end && b.start <= a.end
}
