/**
 * Evaluate `${}` references against a value table.
 *
 * One implementation, two callers: the editor draws the canvas with it and the
 * print path renders with it. Two implementations would put "what you see is
 * what gets burned" in the hands of two pieces of code that must agree forever.
 */
import { parse } from './parse.ts'
import type { VariableDefinition } from './variables.ts'
import type { LabelIR } from '../ir/schema.ts'

export type ValueLookup = Readonly<Record<string, string>>

export interface Evaluation {
  text: string
  /** Closed references with no value, de-duplicated, in first-seen order. */
  unresolved: string[]
}

/**
 * Total: never throws. The editor calls this on every keystroke, and an
 * exception there is a blank screen (FR-016).
 *
 * Substituted text is **not** re-scanned. Otherwise a spreadsheet cell reading
 * `${sku}` would expand, letting a data source reach into the design's own
 * variables.
 */
export function evaluate(content: string, values: ValueLookup): Evaluation {
  let text = ''
  const unresolved: string[] = []

  for (const segment of parse(content)) {
    if (segment.kind === 'literal') {
      text += segment.text
      continue
    }
    if (segment.kind === 'unterminated') {
      // Mid-keystroke on the way to a valid reference. Show it, say nothing.
      text += segment.text
      continue
    }

    const value = values[segment.name]
    if (value === undefined) {
      text += `\${${segment.name}}`
      if (!unresolved.includes(segment.name)) {
        unresolved.push(segment.name)
      }
      continue
    }
    text += value
  }

  return { text, unresolved }
}

/** Elements whose content can carry references. */
function contentOf(element: LabelIR['elements'][number]): string | null {
  return element.type === 'text' || element.type === 'barcode' || element.type === 'qrcode'
    ? element.content
    : null
}

/**
 * Every closed reference in a design, de-duplicated, in document order.
 *
 * Shared by the pre-submit check (is each one resolvable?) and the data-source
 * impact scan (which columns does this design depend on?).
 */
export function collectReferences(ir: LabelIR): string[] {
  const names: string[] = []
  for (const element of ir.elements) {
    const content = contentOf(element)
    if (content === null) continue
    for (const segment of parse(content)) {
      if (segment.kind === 'ref' && !names.includes(segment.name)) {
        names.push(segment.name)
      }
    }
  }
  return names
}

/**
 * Names claimed by both a design variable and a column of the bound source.
 *
 * Reported so the caller can refuse. Picking a winner instead would make the
 * meaning of an existing label change the day somebody adds a column — and the
 * person adding it has no way to know what they shadowed (FR-009b).
 */
export function detectNameCollisions(
  variables: readonly VariableDefinition[],
  columns: readonly string[],
): string[] {
  const columnSet = new Set(columns)
  return variables.filter((variable) => columnSet.has(variable.name)).map((variable) => variable.name)
}

/** Return a copy of `ir` with every element's content evaluated. */
export function evaluateIr(ir: LabelIR, values: ValueLookup): { ir: LabelIR; unresolved: string[] } {
  const unresolved: string[] = []
  const elements = ir.elements.map((element) => {
    const content = contentOf(element)
    if (content === null) return element
    const result = evaluate(content, values)
    for (const name of result.unresolved) {
      if (!unresolved.includes(name)) unresolved.push(name)
    }
    return { ...element, content: result.text }
  })
  return { ir: { ...ir, elements }, unresolved }
}

/**
 * The print path's guard: an unresolved reference must never reach paper.
 *
 * Enforced here rather than by scanning the rendered text, because after
 * evaluation `$${sku}` legitimately *is* the literal text `${sku}` — a scanner
 * could not tell that apart from a reference nobody substituted.
 */
export class UnresolvedVariableError extends Error {
  readonly names: string[]

  constructor(names: string[]) {
    super(`unresolved variable reference(s): ${names.join(', ')}`)
    this.name = 'UnresolvedVariableError'
    this.names = names
  }
}

/**
 * Evaluate for printing. Throws rather than drawing a placeholder onto stock:
 * a label that comes out reading "${sku}" is waste that looks like output.
 */
export function evaluateIrStrict(ir: LabelIR, values: ValueLookup): LabelIR {
  const result = evaluateIr(ir, values)
  if (result.unresolved.length > 0) {
    throw new UnresolvedVariableError(result.unresolved)
  }
  return result.ir
}
