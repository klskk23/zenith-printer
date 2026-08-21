/**
 * The values the first label in a batch will carry.
 *
 * A preview shows one label, and a batch's labels differ: a sequence field
 * counts up, so copy 40 is not copy 1. Showing the first is the only choice
 * that is both cheap and honest — it is a label that will genuinely be
 * printed, rather than a composite of none of them.
 */
import { formatSequence } from '@zenith/shared'
import type { PrintFormField } from '../templates/hooks.ts'

export interface FirstCopyInput {
  fields: readonly PrintFormField[]
  manualValues: Readonly<Record<string, string>>
  /** Where each sequence starts, when the operator has moved it. */
  sequenceOverrides: Readonly<Record<string, number>>
}

/**
 * Values for copy one, or null when the form is not filled in yet.
 *
 * Null rather than a partial map: rendering a label with a hole where a field
 * should be would preview something that will never print.
 */
export function firstCopyValues(input: FirstCopyInput): Record<string, string> | null {
  const values: Record<string, string> = {}

  for (const field of input.fields) {
    if (field.source === 'sequence') {
      const start = input.sequenceOverrides[field.name] ?? field.suggestedStart ?? 1
      values[field.name] = formatSequence(field.name, start, field.seqDigits ?? 3)
      continue
    }

    const typed = input.manualValues[field.name]
    if (typed === undefined || typed.length === 0) {
      return null
    }
    values[field.name] = typed
  }

  return values
}
