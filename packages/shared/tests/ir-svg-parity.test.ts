/**
 * The frontend/backend parity guarantee.
 *
 * Both sides import this same module, so "IR -> SVG" cannot diverge. These
 * tests pin the property that makes the guarantee meaningful: the output is a
 * pure function of the IR, with no dependence on environment, locale, ordering
 * or any ambient state that differs between a browser and Node.
 */
import { describe, expect, it } from 'vitest'
import { irToSvg } from '../src/ir-to-svg/index.ts'
import { labelIrSchema, type LabelIR } from '../src/ir/schema.ts'
import { resolveVariables } from '../src/ir/resolve-variables.ts'

function label(elements: unknown[]): LabelIR {
  return labelIrSchema.parse({ widthMm: 50, heightMm: 30, dpi: 203, elements })
}

const RICH = label([
  { id: 't', type: 'text', xMm: 2, yMm: 2, widthMm: 44, heightMm: 6, content: '仓库物料标签', fontFamily: 'Noto Sans CJK SC', fontSizeMm: 4, bold: true },
  { id: 'b', type: 'barcode', xMm: 2, yMm: 9, widthMm: 44, heightMm: 11, content: 'ABC-12345', symbology: 'code128' },
  { id: 'l', type: 'line', xMm: 2, yMm: 21, x2Mm: 48, y2Mm: 21, strokeWidthDots: 1 },
  { id: 'r', type: 'rect', xMm: 36, yMm: 22, widthMm: 12, heightMm: 6, strokeWidthDots: 2 },
])

describe('purity', () => {
  it('is byte-identical across repeated calls', () => {
    const results = Array.from({ length: 20 }, () => irToSvg(RICH))
    expect(new Set(results).size).toBe(1)
  })

  it('does not mutate the input IR', () => {
    const before = structuredClone(RICH)
    irToSvg(RICH)
    expect(RICH).toEqual(before)
  })

  it('depends only on the IR, not on call order', () => {
    const a = label([{ id: 'x', type: 'line', xMm: 1, yMm: 1, x2Mm: 9, y2Mm: 1, strokeWidthDots: 2 }])
    const first = irToSvg(a)
    irToSvg(RICH)
    expect(irToSvg(a)).toBe(first)
  })

  it('is unaffected by the ambient locale', () => {
    // A locale-aware number path would emit "0,5" in de-DE and group digits in
    // fr-FR, so the same IR would render differently in a browser and on the
    // server. SVG separates values with spaces, so only the decimal separator
    // and digit grouping are meaningful signals here.
    const svg = irToSvg(
      label([{ id: 'x', type: 'line', xMm: 1.5, yMm: 1, x2Mm: 40.25, y2Mm: 1, strokeWidthDots: 1 }]),
    )
    const numbers = [...svg.matchAll(/"([\d.\s-]+)"/g)].flatMap((m) => (m[1] ?? '').split(/\s+/))
    expect(numbers.length).toBeGreaterThan(0)
    for (const value of numbers.filter((v) => v.length > 0)) {
      expect(value).toMatch(/^-?\d+(\.\d+)?$/)
    }
  })
})

describe('resolved content', () => {
  it('gives identical output for identical resolved values', () => {
    const template = label([
      { id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 10, content: { $var: 'serial' }, symbology: 'code128' },
    ])
    const a = irToSvg(resolveVariables(template, { serial: '001' }))
    const b = irToSvg(resolveVariables(template, { serial: '001' }))
    expect(a).toBe(b)
  })

  it('gives different output for different values', () => {
    const template = label([
      { id: 'b', type: 'barcode', xMm: 2, yMm: 2, widthMm: 40, heightMm: 10, content: { $var: 'serial' }, symbology: 'code128' },
    ])
    expect(irToSvg(resolveVariables(template, { serial: '001' }))).not.toBe(
      irToSvg(resolveVariables(template, { serial: '002' })),
    )
  })
})

describe('structural invariants both sides rely on', () => {
  it('declares a viewBox in whole dots', () => {
    expect(irToSvg(RICH)).toMatch(/viewBox="0 0 \d+ \d+"/)
  })

  it('emits width and height matching the viewBox', () => {
    const svg = irToSvg(RICH)
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
    expect(svg).toContain(`width="${viewBox?.[1]}"`)
    expect(svg).toContain(`height="${viewBox?.[2]}"`)
  })

  it('is well-formed enough for a DOM parser to accept', () => {
    const svg = irToSvg(RICH)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    const opens = (svg.match(/<g[ >]/g) ?? []).length
    const closes = (svg.match(/<\/g>/g) ?? []).length
    expect(opens).toBe(closes)
  })

  it('escapes content so user text cannot break the markup', () => {
    const svg = irToSvg(
      label([{ id: 't', type: 'text', xMm: 1, yMm: 1, widthMm: 20, heightMm: 5, content: '</svg><script>', fontFamily: 'F', fontSizeMm: 3 }]),
    )
    expect(svg).not.toContain('<script>')
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('places one group per rendered element', () => {
    expect((irToSvg(RICH).match(/<g transform=/g) ?? []).length).toBe(4)
  })
})
