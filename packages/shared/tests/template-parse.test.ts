import { describe, expect, it } from 'vitest'
import { parse, type Segment } from '../src/template/parse.ts'

/**
 * The 13 boundary cases from contracts/variable-grammar.md.
 *
 * The grammar is frozen: existing label content is interpreted by it, so a
 * change here silently alters what already-printed designs mean. These cases
 * are the contract, not examples of it.
 */

/** Compact rendering so a failure shows the whole parse, not one field. */
function shape(content: string): string {
  return parse(content)
    .map((seg: Segment) =>
      seg.kind === 'literal'
        ? `L(${seg.text})`
        : seg.kind === 'ref'
          ? `R(${seg.name})`
          : `U(${seg.text})`,
    )
    .join('')
}

describe('parse — contract boundary cases', () => {
  it('splits two references around a literal dot', () => {
    // The case that decided the grammar: a version string must not be read as
    // a two-segment path.
    expect(shape('版本 ${major}.${minor}')).toBe('L(版本 )R(major)L(.)R(minor)')
  })

  it('treats a single brace after a reference as literal text', () => {
    expect(shape('批号 ${lot}.{已校验}')).toBe('L(批号 )R(lot)L(.{已校验})')
  })

  it('escapes ${ with $${', () => {
    expect(shape('$${sku}')).toBe('L(${sku})')
  })

  it('pairs $$ first, so $$${sku} is a literal dollar plus a reference', () => {
    // The price-label case: "$${price}" would print the text "${price}".
    // Escaping the dollar is what makes "$19.90" expressible.
    expect(shape('$$${sku}')).toBe('L($)R(sku)')
  })

  it('turns a bare $$ into one literal dollar', () => {
    expect(shape('$$')).toBe('L($)')
  })

  it('trims surrounding whitespace inside the braces', () => {
    expect(shape('${ sku }')).toBe('R(sku)')
  })

  it('cannot resolve an empty name', () => {
    expect(parse('${}')).toEqual([{ kind: 'ref', name: '' }])
  })

  it('cannot resolve a whitespace-only name', () => {
    expect(parse('${ }')).toEqual([{ kind: 'ref', name: '' }])
  })

  it('reports an unclosed reference as unterminated, not as an error', () => {
    // Somebody is mid-keystroke. This is a normal state.
    expect(shape('${sk')).toBe('U(${sk)')
  })

  it('treats a dot inside the braces as an ordinary character', () => {
    // Single-level namespace: there is no path to split.
    expect(shape('${单价.含税}')).toBe('R(单价.含税)')
  })

  it('keeps every dot, however many', () => {
    expect(shape('${a.b.c}')).toBe('R(a.b.c)')
  })

  it('allows spaces inside a name', () => {
    expect(shape('${收件 人}')).toBe('R(收件 人)')
  })

  it('treats a double quote inside the braces as an ordinary character', () => {
    expect(shape('${说"明"}')).toBe('R(说"明")')
  })

  it('leaves a lone dollar sign alone', () => {
    expect(shape('价格 $100')).toBe('L(价格 $100)')
  })
})

describe('parse — general shape', () => {
  it('returns no segments for empty content', () => {
    expect(parse('')).toEqual([])
  })

  it('merges adjacent literal text into one segment', () => {
    expect(shape('abc def')).toBe('L(abc def)')
  })

  it('handles a reference at the very start and very end', () => {
    expect(shape('${a}x${b}')).toBe('R(a)L(x)R(b)')
  })

  it('keeps a trailing dollar sign', () => {
    expect(shape('abc$')).toBe('L(abc$)')
  })

  it('collapses a trailing $$ to one dollar', () => {
    expect(shape('abc$$')).toBe('L(abc$)')
  })

  it('never throws, whatever the input', () => {
    for (const input of ['${', '$', '$$', '${{', '}}', '${a}${', '${}${}', '$${', '${a']) {
      expect(() => parse(input)).not.toThrow()
    }
  })
})
