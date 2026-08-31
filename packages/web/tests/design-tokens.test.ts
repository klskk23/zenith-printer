/**
 * Colour goes through the theme, never around it.
 *
 * The constitution's UI rule — build on shadcn/ui and reuse its design tokens —
 * had nothing checking it, and five places had drifted: a warning Alert painted
 * `text-amber-800`, the queue's "printing" state `text-blue-600`, three more
 * amber spans. Every one of them was a colour picked for white paper and then
 * rendered onto a near-black background, because this application has a dark
 * theme and Tailwind's palette scale does not.
 *
 * So the rule is checked by reading the source. A rendered test cannot see it:
 * happy-dom resolves no custom properties and paints nothing, so `text-warning`
 * and `text-amber-800` are the same string to it either way.
 *
 * Two escapes are allowed, both stated where they are used:
 *   - `[data-label-canvas]`, which is a sheet of paper and stays white in
 *     either theme, or the preview would lie about the print;
 *   - the tokens' own definitions in index.css, which is where colour is
 *     supposed to be written down.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src', import.meta.url).pathname

/** Tailwind's built-in palette scale — the thing that has no dark variant. */
const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|shadow|accent|caret|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

/**
 * Comments stripped: these files explain at length what they used to say, and
 * an assertion that matched the prose describing the fault would pass the day
 * the fault came back.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const offenders = (): string[] =>
  sourceFiles(SRC).flatMap((file) => {
    const matches = code(file).match(PALETTE) ?? []
    return matches.map((match) => `${file.slice(SRC.length + 1)}: ${match}`)
  })

describe('colour', () => {
  it('scans something, so an empty pass cannot look like a passing one', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(50)
  })

  it('is written as tokens, not as palette steps', () => {
    expect(offenders()).toEqual([])
  })

  it('catches a palette step if one is written', () => {
    // The check itself, checked: a regex that matched nothing would make the
    // test above pass for the wrong reason forever.
    expect('className="text-amber-800"'.match(PALETTE)).toEqual(['text-amber-800'])
    expect('className="bg-blue-600/10"'.match(PALETTE)).toEqual(['bg-blue-600'])
  })
})

describe('the token set', () => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8')

  it('defines every name the components reach for', () => {
    // Both halves of a shadcn colour pair, plus the two this application adds.
    const required = [
      'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
      'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
      'muted', 'muted-foreground', 'accent', 'accent-foreground',
      'destructive', 'destructive-foreground', 'border', 'input', 'ring',
      'warning', 'warning-foreground', 'info', 'success',
    ]
    expect(required.filter((name) => !css.includes(`--color-${name}:`))).toEqual([])
  })

  it('gives every one of them a dark value too', () => {
    // A token defined only in the light block is a colour that silently keeps
    // its light value on a black background — which is how this started.
    const light = [...css.matchAll(/@theme \{([\s\S]*?)\n\}/g)][0]?.[1] ?? ''
    const dark = [...css.matchAll(/\[data-theme='dark'\] \{([\s\S]*?)\n\}/g)][0]?.[1] ?? ''
    const names = (block: string): string[] =>
      [...block.matchAll(/--color-([a-z-]+):/g)].map((match) => match[1]!).sort()
    expect(names(light)).toEqual(names(dark))
  })

  it('says the same thing in both dark blocks', () => {
    // The explicit choice and the system preference are two selectors carrying
    // one palette. They are written out twice, so they can disagree.
    const blocks = [...css.matchAll(/:root(?:\[data-theme='dark'\]|:not\(\[data-theme='light'\]\)) \{([\s\S]*?)\n\s*\}/g)]
    expect(blocks).toHaveLength(2)
    const normalise = (block: string): string =>
      block.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    expect(normalise(blocks[0]![1]!)).toBe(normalise(blocks[1]![1]!))
  })
})
