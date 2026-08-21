/**
 * Standing content for a design that is still being written.
 *
 * The renderer refuses to draw a `$var` it has no value for, and rightly:
 * printing a label with a hole where a part number belongs is worse than
 * refusing to print. The editor is where those bindings are made, though, so
 * it needs an answer for every one of them — including the ones that have no
 * good answer, such as a binding left behind by a field that was deleted.
 *
 * So this never throws. A design mid-edit is full of states that are not
 * printable yet, and the editor has to survive all of them; the guards say
 * what is wrong, and the print path refuses on its own terms.
 */
import { isVariableRef, resolveVariables, sampleValues, type LabelIR } from '@zenith/shared'
import type { VariableField } from '../features/templates/hooks.ts'

/** What a binding shows when nothing describes it. */
const UNKNOWN = ''

/** Every variable the design mentions, whether or not a field defines it. */
function referencedNames(ir: LabelIR): string[] {
  const names = new Set<string>()
  for (const element of ir.elements) {
    if ('content' in element && isVariableRef(element.content)) {
      names.add(element.content.$var)
    }
  }
  return [...names]
}

/**
 * The design as it should be drawn, with bindings filled in.
 *
 * A copy — the stored IR keeps its bindings, so an edit made while looking at
 * a sample writes back the binding rather than the sample.
 */
export function previewIr(ir: LabelIR, fields: readonly VariableField[]): LabelIR {
  const values = sampleValues(fields)

  // A binding whose field was deleted still has to draw as something. Leaving
  // it out would throw, and throwing here blanks the editor.
  for (const name of referencedNames(ir)) {
    values[name] ??= UNKNOWN
  }

  return resolveVariables(ir, values)
}
