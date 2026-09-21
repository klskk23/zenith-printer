/**
 * Colour goes through the theme, never around it — and the theme is Nocturne.
 *
 * Two things are checked here, both by reading the source rather than
 * rendering it (happy-dom resolves no custom properties and paints nothing,
 * so `text-warning` and `text-amber-800` look the same to it):
 *
 *   1. The tokens in index.css are Nocturne's own values, verbatim. The
 *      design brief was "not one token changed", and a palette that has been
 *      nudged half a step still looks fine on the screen it was nudged on.
 *      So the contract table in specs/005/contracts/visual-tokens.md is
 *      repeated here and compared byte for byte.
 *   2. Every text pair is readable, by measurement. Nocturne ships its accent
 *      at ~3:1 against the ground and says so — fine for lines and large
 *      type, not for body text — which is why this application uses
 *      `accent-300` for accent-coloured words.
 *
 * And the one rule that is this product's rather than Nocturne's: pure white
 * means "this will be printed". It appears in `.paper` and in the canvas's own
 * SVG fills, and nowhere else.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src', import.meta.url).pathname
const css = readFileSync(join(SRC, 'index.css'), 'utf8')

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

const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The raw value of a `@theme` token, as written. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(declarations)
  expect(match, `--${name} is not defined`).not.toBeNull()
  return match![1]!.trim()
}

/**
 * The Nocturne values, verbatim — see contracts/visual-tokens.md.
 *
 * `destructive`, `warning` and `success` are this application's own three
 * state colours; Nocturne has one accent and no semantic states. They are
 * additions, held to the same contrast floor, not changes.
 */
const NOCTURNE: Record<string, string> = {
  'color-background': '#161826',
  'color-foreground': '#e9e9ed',
  'color-card': '#232532',
  'color-card-foreground': '#e9e9ed',
  'color-popover': '#232532',
  'color-popover-foreground': '#e9e9ed',
  'color-primary': '#9184d9',
  'color-primary-foreground': '#161826',
  'color-secondary': '#3f424d',
  'color-secondary-foreground': '#f3f5fe',
  'color-muted': '#292b31',
  'color-muted-foreground': '#9397ab',
  'color-accent': '#2b2741',
  'color-accent-foreground': '#e7e5fe',
  'color-ring': '#9184d9',
  'color-info': '#9184d9',
  'color-border': 'color-mix(in srgb, #e9e9ed 16%, transparent)',
  'color-input': 'color-mix(in srgb, #e9e9ed 45%, transparent)',
  'color-neutral-100': '#f3f5fe',
  'color-neutral-200': '#e4e7f5',
  'color-neutral-300': '#cfd3e5',
  'color-neutral-400': '#b2b6ca',
  'color-neutral-500': '#9397ab',
  'color-neutral-600': '#75798c',
  'color-neutral-700': '#595d6c',
  'color-neutral-800': '#3f424d',
  'color-neutral-900': '#292b31',
  'color-accent-100': '#f5f4ff',
  'color-accent-200': '#e7e5fe',
  'color-accent-300': '#d2cefd',
  'color-accent-400': '#b5abfc',
  'color-accent-500': '#968ae0',
  'color-accent-600': '#796cbf',
  'color-accent-700': '#5d5294',
  'color-accent-800': '#423a6a',
  'color-accent-900': '#2b2741',
  'radius-sm': '4px',
  'radius-md': '8px',
  'radius-lg': '14px',
  'shadow-sm': '0 0 0 1px #3f424d',
  'shadow-md': '0 0 0 1px #595d6c, 0 6px 18px rgba(0, 0, 0, 0.55)',
  'shadow-lg': '0 0 0 1px #9397ab, 0 16px 40px rgba(0, 0, 0, 0.65)',
}

describe('the tokens are Nocturne, verbatim', () => {
  it.each(Object.entries(NOCTURNE))('%s', (name, value) => {
    expect(token(name)).toBe(value)
  })

  it('sets the interface face to Inter with the CJK sans behind it', () => {
    expect(token('font-sans')).toMatch(/^'Inter', 'Noto Sans CJK SC'/)
  })

  it('has no display face — headings are the body face at weight 500', () => {
    expect(declarations).not.toContain('--font-display')
  })

  it('carries nothing of the previous palette', () => {
    for (const relic of ['classical', '--shadow-sheet', 'oklch(']) {
      expect(declarations, `${relic} survived the rewrite`).not.toContain(relic)
    }
  })

  it('holds one palette and no second one', () => {
    // Dark mode as a *choice* is gone; there is one palette and it is dark.
    // Asserted so that adding a switch back is a visible decision.
    expect(declarations).not.toContain('data-theme')
    expect(declarations).not.toContain('prefers-color-scheme')
  })
})

describe('the token set', () => {
  it('defines every name the components reach for', () => {
    const required = [
      'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
      'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
      'muted', 'muted-foreground', 'accent', 'accent-foreground',
      'destructive', 'destructive-foreground', 'border', 'input', 'ring',
      'warning', 'info', 'success',
    ]
    expect(required.filter((name) => !declarations.includes(`--color-${name}:`))).toEqual([])
  })

  it('has a name for the density this application works at', () => {
    expect(css).toMatch(/--text-2xs:/)
  })

  it('uses the names it invented for itself', () => {
    const OWN = ['warning', 'info', 'success', 'accent-300']
    const source = sourceFiles(SRC).map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(OWN.filter((name) => !source.includes(`-${name}`))).toEqual([])
  })

  it('draws form controls with the edge meant for them', () => {
    for (const control of ['input.tsx', 'textarea.tsx', 'select.tsx']) {
      const source = readFileSync(join(SRC, 'components/ui', control), 'utf8')
      expect(source, `${control} does not draw border-input`).toContain('border-input')
    }
  })
})

describe('colour', () => {
  /**
   * Tailwind's built-in palette scale, which this theme does not use.
   *
   * `neutral` is deliberately absent from the list: Nocturne's tonal ramp is
   * named `--color-neutral-100…900` and overrides Tailwind's, so
   * `bg-neutral-800` here is a theme token, not a palette step.
   */
  const PALETTE =
    /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|shadow|accent|caret|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|stone)-\d{2,3}\b/g

  const offenders = (): string[] =>
    sourceFiles(SRC).flatMap((file) => {
      const matches = code(file).match(PALETTE) ?? []
      return matches.map((match) => `${file.slice(SRC.length + 1)}: ${match}`)
    })

  it('scans something, so an empty pass cannot look like a passing one', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(50)
  })

  it('is written as tokens, not as palette steps', () => {
    expect(offenders()).toEqual([])
  })

  it('catches a palette step if one is written', () => {
    expect('className="text-amber-800"'.match(PALETTE)).toEqual(['text-amber-800'])
    expect('className="bg-blue-600/10"'.match(PALETTE)).toEqual(['bg-blue-600'])
  })

  it('is never written as an arbitrary size', () => {
    const arbitrary = sourceFiles(SRC).flatMap((file) => {
      const matches = code(file).match(/\btext-\[[0-9.]+(px|rem|em)\]/g) ?? []
      return matches.map((match) => `${file.slice(SRC.length + 1)}: ${match}`)
    })
    expect(arbitrary).toEqual([])
  })
})

describe('the only white is the paper', () => {
  /**
   * Files allowed to say white:
   *   - index.css, inside the `.paper` rules — the stock itself;
   *   - editor/canvas.tsx — the SVG the label is drawn in. Its fills are the
   *     label's own colours (the sheet, and ink inverted onto a black band),
   *     which is exactly the thing the rule reserves white for.
   */
  const WHITE = /#ffffff\b|#fff\b|\bwhite\b|\bbg-white\b|\btext-white\b/gi

  it('appears in index.css only inside .paper', () => {
    const outsidePaper = declarations.replace(/\.paper[^{]*\{[^}]*\}/g, '')
    expect(outsidePaper.match(WHITE) ?? []).toEqual([])
    expect(declarations.match(/\.paper\b/g)?.length ?? 0).toBeGreaterThan(0)
  })

  it('catches a white if one is written', () => {
    // The scan itself, scanned: a regex that matched nothing would make the
    // two tests around it pass for the wrong reason forever.
    expect('className="bg-white"'.match(WHITE)).toEqual(['bg-white'])
    expect('fill="#ffffff"'.match(WHITE)).toEqual(['#ffffff'])
    expect('text-white'.match(WHITE)).toEqual(['text-white'])
  })

  it('appears in no component other than the canvas', () => {
    const hits = sourceFiles(SRC)
      .filter((file) => !file.endsWith('editor/canvas.tsx') && !file.includes('/i18n/'))
      .flatMap((file) => {
        const matches = code(file).match(WHITE) ?? []
        return matches.map((match) => `${file.slice(SRC.length + 1)}: ${match}`)
      })
    expect(hits).toEqual([])
  })
})

describe('every text pair is readable, by measurement', () => {
  /** Composite a token over the page ground, resolving color-mix if needed. */
  const rgb = (name: string): [number, number, number] => {
    const value = token(name)
    const hex = /^#([0-9a-f]{6})$/i.exec(value)
    if (hex !== null) {
      return hexToRgb(hex[1]!)
    }
    const mix = /^color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%, transparent\)$/i.exec(value)
    expect(mix, `${name}: neither hex nor a color-mix over transparent`).not.toBeNull()
    const [r, g, b] = hexToRgb(mix![1]!.slice(1))
    const alpha = Number(mix![2]) / 100
    const [br, bg, bb] = hexToRgb(token('color-background').slice(1))
    return [r * alpha + br * (1 - alpha), g * alpha + bg * (1 - alpha), b * alpha + bb * (1 - alpha)]
  }

  it.each([
    ['color-foreground', 'color-background', 4.5, 'body text on the page'],
    ['color-card-foreground', 'color-card', 4.5, 'body text on a card'],
    ['color-muted-foreground', 'color-background', 4.5, 'secondary text'],
    ['color-muted-foreground', 'color-card', 4.5, 'secondary text on a card'],
    ['color-secondary-foreground', 'color-secondary', 4.5, 'text on a secondary surface'],
    ['color-accent-foreground', 'color-accent', 4.5, 'text on a tinted hover'],
    ['color-accent-300', 'color-background', 4.5, 'accent-coloured words at body size'],
    ['color-destructive', 'color-background', 4.5, 'the failed / irreversible state'],
    ['color-warning', 'color-background', 4.5, 'the printed-but-not-as-asked state'],
    ['color-success', 'color-background', 4.5, 'the finished state'],
    ['color-primary', 'color-background', 3, 'accent lines, outlines and large type'],
    ['color-ring', 'color-background', 3, 'the focus ring'],
    ['color-input', 'color-background', 3, 'the edge of something you can type into'],
  ] as const)('%s on %s ≥ %s (%s)', (fg, bg, floor, _what) => {
    const ratio = contrast(rgb(fg), rgb(bg))
    expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor)
  })
})

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]
}

/** WCAG 2.x relative luminance from 8-bit sRGB, then the contrast ratio. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (channels: [number, number, number]): number => {
    const [r, g, bl] = channels.map((c) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const sorted = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (sorted[0]! + 0.05) / (sorted[1]! + 0.05)
}
