/**
 * Which variable fields the print dialog should ask about.
 *
 * Two sources, and neither alone is right.
 *
 * The **design** knows which fields it has, including ones added since the
 * template was last saved. Without it, an unsaved design with variables
 * offered nothing to fill in — so the values never reached the preview, the
 * server refused to resolve a `$var` it had no value for, and the preview came
 * back as "could not render" with no way to act on it.
 *
 * The **server** knows where a sequence has got to. That number lives in the
 * sequence claims, not in the design, and it is the one thing the editor
 * cannot work out: printing continues from where the last batch stopped rather
 * than starting over.
 *
 * So the design decides *which* fields, and the server fills in what it alone
 * knows about them.
 */
import type { PrintFormField, VariableField } from '../templates/hooks.ts'

export function printFormFields(
  design: readonly VariableField[],
  fromServer: readonly PrintFormField[],
): PrintFormField[] {
  const known = new Map(fromServer.map((field) => [field.name, field]))

  return design.map((field) => {
    const server = known.get(field.name)
    const merged: PrintFormField = {
      name: field.name,
      label: field.label,
      source: field.source,
    }

    const sample = server?.sampleValue ?? field.sampleValue
    if (sample !== undefined) {
      merged.sampleValue = sample
    }
    // The server's suggestion continues the sequence; the design only knows
    // where it was first told to start.
    const start = server?.suggestedStart ?? field.seqStart
    if (start !== undefined) {
      merged.suggestedStart = start
    }
    const digits = server?.seqDigits ?? field.seqDigits
    if (digits !== undefined) {
      merged.seqDigits = digits
    }
    const step = server?.seqStep ?? field.seqStep
    if (step !== undefined) {
      merged.seqStep = step
    }
    if (server?.maxRepresentable !== undefined) {
      merged.maxRepresentable = server.maxRepresentable
    }
    return merged
  })
}

/**
 * Whether this batch needs a saved template before it can be printed.
 *
 * A sequence's claim is recorded against a template, because its whole purpose
 * is to carry on across print runs — and there is nothing for an unsaved
 * design to carry on from. Submitting one produces a job that fails in the
 * queue when the renderer meets a `$var` with no value, which is a wasted trip
 * and a confusing place to learn about it.
 */
export function needsSavingForSequences(
  fields: readonly VariableField[],
  templateId: string | null,
): boolean {
  return templateId === null && fields.some((field) => field.source === 'sequence')
}
