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

describe('the type scale', () => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8')

  it('has a name for the density this application works at', () => {
    // `text-[11px]` was written 94 times: an arbitrary value below Tailwind's
    // smallest step, so the densest text in the product sat outside the system
    // and could only be changed 94 times over.
    expect(css).toMatch(/--text-2xs:/)
  })

  it('is never written as an arbitrary size', () => {
    const arbitrary = sourceFiles(SRC).flatMap((file) => {
      const matches = code(file).match(/\btext-\[[0-9.]+(px|rem|em)\]/g) ?? []
      return matches.map((match) => `${file.slice(SRC.length + 1)}: ${match}`)
    })
    expect(arbitrary).toEqual([])
  })
})

describe('the radius scale', () => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8')

  it('derives every step from the one number', () => {
    // `--radius` used to govern bare `rounded` and nothing else: `rounded-sm`,
    // `-md` and `-lg` read Tailwind's own values, so 27 of 40 rounded corners
    // ignored the token meant to decide them.
    for (const step of ['sm', 'md', 'lg']) {
      expect(css).toMatch(new RegExp(`--radius-${step}:[^;]*var\\(--radius\\)`))
    }
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
      'warning', 'info', 'success',
    ]
    expect(required.filter((name) => !css.includes(`--color-${name}:`))).toEqual([])
  })

  it('holds one palette and no second one', () => {
    /**
     * Dark mode is gone, deliberately.
     *
     * It cost two more copies of every token — the explicit choice and the
     * system preference were written out separately and could disagree — and
     * the thing it was for was the canvas: a white rectangle on near-black is
     * the harshest pairing in the product. The page ground is paper-grey now,
     * so the step from chrome to canvas is small without a second palette to
     * keep in step.
     *
     * Asserted so that adding one back is a visible decision rather than a
     * quiet media query.
     */
    expect(css).not.toContain('data-theme')
    expect(css).not.toContain('prefers-color-scheme')
  })

  it('keeps every text pair readable, by measurement', () => {
    /**
     * The palette's whole justification is that somebody reads it standing at
     * a bench. Contrast is the part of that which breaks silently: a colour
     * nudged half a step still looks fine on the screen it was nudged on.
     *
     * WCAG asks 4.5:1 of body text and 3:1 of the boundary of anything you can
     * act on. The values are read out of the stylesheet and converted, so this
     * measures what ships rather than what a comment claims.
     */
    const token = (name: string): [number, number, number] => {
      const match = new RegExp(`--color-${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css)
      expect(match, `--color-${name} is not an oklch triple`).not.toBeNull()
      return [Number(match![1]), Number(match![2]), Number(match![3])]
    }

    for (const [fg, bg, floor, what] of [
      ['foreground', 'background', 4.5, 'body text on the page'],
      ['card-foreground', 'card', 4.5, 'body text on a card'],
      ['muted-foreground', 'background', 4.5, 'secondary text'],
      ['primary-foreground', 'primary', 4.5, 'the label on a primary button'],
      ['destructive-foreground', 'destructive', 4.5, 'the label on a destructive button'],
      ['warning', 'background', 4.5, 'warning text'],
      ['info', 'background', 4.5, 'the in-progress state'],
      ['input', 'background', 3, 'the edge of something you can act on'],
      ['ring', 'background', 3, 'the focus ring'],
    ] as const) {
      const ratio = contrast(token(fg), token(bg))
      expect(ratio, `${what}: ${ratio.toFixed(2)}:1, needs ${floor}`).toBeGreaterThanOrEqual(floor)
    }
  })

  it('draws form controls with the edge meant for them', () => {
    /**
     * `--color-input` was defined, documented with the contrast ratio it
     * achieves, and referenced by nothing — every form control drew
     * `border-border` instead, a hairline at 1.22:1 against the page, well
     * under the 3:1 WCAG asks of the boundary of something you can act on.
     *
     * A token nobody uses is a decision that exists only in a comment, and
     * this one was load-bearing: it is the only reason a text field has a
     * visible edge on paper-grey.
     */
    for (const control of ['input.tsx', 'textarea.tsx', 'select.tsx']) {
      const source = readFileSync(join(SRC, 'components/ui', control), 'utf8')
      expect(source, `${control} does not draw border-input`).toContain('border-input')
    }
  })

  it('uses the names it invented for itself', () => {
    // shadcn's own set has to exist whether or not this application has
    // reached for it yet — a component added tomorrow expects it. The names
    // beyond that set are this project's, and one of those going unused means
    // a state was given a colour and then never shown in it.
    const OWN = ['warning', 'info', 'success']
    const source = sourceFiles(SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    expect(OWN.filter((name) => !source.includes(`-${name}`))).toEqual([])
  })

  it('reserves pure white for the thing being printed', () => {
    // `#FFFFFF` is not a background in this palette; it is the mark that says
    // this rectangle will exist on paper. There is exactly one, and a second
    // would quietly undo the rule.
    // Comments stripped first: the rule is about what the stylesheet paints,
    // not about the prose that explains it — and the prose says `#FFFFFF` out
    // loud, which is the point of it.
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const whites = [...declarations.matchAll(/#ffffff\b|#fff\b|\bwhite\b/gi)]
    expect(
      whites.map((match) => match[0]),
      'pure white outside the label canvas',
    ).toEqual(['#ffffff'])
  })
})

/**
 * OKLCH → sRGB → WCAG relative luminance.
 *
 * Written out because the stylesheet is authored in OKLCH and the requirement
 * is stated in sRGB; converting by hand in a comment is how a palette comes to
 * claim a ratio it does not have.
 */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const luminance = ([L, C, H]: [number, number, number]): number => {
    const h = (H * Math.PI) / 180
    const [aa, bb] = [C * Math.cos(h), C * Math.sin(h)]
    const l = (L + 0.3963377774 * aa + 0.2158037573 * bb) ** 3
    const m = (L - 0.1055613458 * aa - 0.0638541728 * bb) ** 3
    const s = (L - 0.0894841775 * aa - 1.291485548 * bb) ** 3
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => Math.min(1, Math.max(0, v)))
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
  }
  const sorted = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (sorted[0]! + 0.05) / (sorted[1]! + 0.05)
}
