/**
 * Scanner for `${}` variable references.
 *
 * The grammar is frozen (contracts/variable-grammar.md): existing label
 * content is interpreted by it, so a change here silently alters what
 * already-printed designs mean.
 *
 * Two rules, and that is the whole language:
 *
 *   ${名称}   a reference
 *   $$       an escape, producing a literal "$"
 *
 * `$${` therefore yields a literal "${" (FR-012), and `$$${price}` yields a
 * literal "$" followed by a reference — which is how a price label is written.
 * Escaping the dollar rather than the whole `${` is what makes that case
 * expressible at all; under the narrower rule it silently printed the text
 * "${price}".
 *
 * Inside the braces every character except `}` belongs to the name. There is
 * no path separator and no quoted segment, because a design binds to at most
 * one data source — a source prefix would be a value that is always derivable
 * and always has to be typed.
 */

export type Segment =
  | { kind: 'literal'; text: string }
  | { kind: 'ref'; name: string }
  /** `${sk` — somebody is mid-keystroke. A normal state, never an error. */
  | { kind: 'unterminated'; text: string }

/**
 * Split content into literals and references.
 *
 * Total: every input produces a parse. Malformed content becomes literal or
 * unterminated text, never an exception — the editor calls this on every
 * keystroke (FR-016).
 */
export function parse(content: string): Segment[] {
  const segments: Segment[] = []
  let literal = ''
  let index = 0

  const flushLiteral = (): void => {
    if (literal !== '') {
      segments.push({ kind: 'literal', text: literal })
      literal = ''
    }
  }

  while (index < content.length) {
    const dollar = content.indexOf('$', index)
    if (dollar === -1) {
      literal += content.slice(index)
      break
    }

    literal += content.slice(index, dollar)

    // `$$` pairs first. `$${` therefore reads as (escaped $) + literal `{`,
    // giving a literal "${"; `$$${x}` reads as (escaped $) + reference.
    if (content.startsWith('$$', dollar)) {
      literal += '$'
      index = dollar + 2
      continue
    }

    if (!content.startsWith('${', dollar)) {
      literal += '$'
      index = dollar + 1
      continue
    }

    const close = content.indexOf('}', dollar + 2)
    if (close === -1) {
      flushLiteral()
      segments.push({ kind: 'unterminated', text: content.slice(dollar) })
      return segments
    }

    flushLiteral()
    segments.push({ kind: 'ref', name: content.slice(dollar + 2, close).trim() })
    index = close + 1
  }

  flushLiteral()
  return segments
}
