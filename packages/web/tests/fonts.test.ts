/**
 * Which faces the interface loads, and which it must not.
 *
 * Two faces are involved and they are easy to confuse:
 *
 *   - **Inter** is the interface face for Latin text and numerals. It is
 *     bundled (this is a LAN appliance; no CDN) and it is *not* a render
 *     font: the label renderer never sees it, so offering it as a label font
 *     would print something else.
 *   - **Noto Serif CJK SC** is a render font — 「宋体」 in the editor's font
 *     menu — so its @font-face must stay. What must go is its use for the
 *     chrome: a previous version set page headings in it, which made a 3.2MB
 *     file a first-paint download on every page.
 *
 * The font binaries are gitignored and fetched by scripts/fetch-fonts.sh, so
 * this asserts the pipeline (manifest, fetch list, subset jobs) rather than
 * the presence of the files — a clean checkout has none of them.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { copy } from '../src/i18n/index.ts'

const WEB = new URL('..', import.meta.url).pathname
const ROOT = join(WEB, '..', '..')
const SRC = join(WEB, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the serif stays a render font and leaves the chrome', () => {
  const fontsCss = readFileSync(join(SRC, 'fonts.css'), 'utf8')
  const indexCss = stripComments(readFileSync(join(SRC, 'index.css'), 'utf8'))

  it('is still declared, because a label may be set in it', () => {
    expect(fontsCss).toMatch(/font-family: 'Noto Serif CJK SC'/)
  })

  it('is named nowhere in the stylesheet outside @font-face', () => {
    // `sans-serif` is the generic fallback in --font-sans and is not a serif.
    expect(indexCss).not.toMatch(/Noto Serif|font-display|font-serif|(?<![\w-])serif\b/)
  })

  it('is named in no component', () => {
    // Components only. Logic modules that map a label's font *choice* to a
    // family name (editor/elements.ts) have to say it: that is the render
    // font doing its job, not the chrome borrowing it.
    const hits = sourceFiles(SRC)
      .filter((file) => file.endsWith('.tsx') && !file.includes('/i18n/'))
      .flatMap((file) => {
        const matches = stripComments(readFileSync(file, 'utf8')).match(/font-display|font-serif|Noto Serif/g) ?? []
        return matches.map((match) => `${file.slice(SRC.length + 1)}: ${match}`)
      })
    expect(hits).toEqual([])
  })
})

describe('Inter is the interface face', () => {
  const fontsCss = readFileSync(join(SRC, 'fonts.css'), 'utf8')

  it('is declared at 400 and 500 from the bundled subset', () => {
    for (const [weight, file] of [['400', 'Inter-Regular'], ['500', 'Inter-Medium']]) {
      const block = new RegExp(
        `@font-face \\{[^}]*font-family: 'Inter';[^}]*url\\('/fonts/subset/${file}\\.woff2'\\)[^}]*font-weight: ${weight};`,
      )
      expect(fontsCss, `${file} at ${weight}`).toMatch(block)
    }
  })

  it('is pinned in the font pipeline like every other face', () => {
    const manifest = readFileSync(join(ROOT, 'fonts/MANIFEST.sha256'), 'utf8')
    const fetch = readFileSync(join(ROOT, 'scripts/fetch-fonts.sh'), 'utf8')
    const subset = readFileSync(join(ROOT, 'scripts/subset-fonts.py'), 'utf8')
    for (const face of ['Inter-Regular.otf', 'Inter-Medium.otf']) {
      expect(manifest, `${face} in the manifest`).toContain(face)
      expect(fetch, `${face} in the fetch list`).toContain(face)
      expect(subset, `${face} in the subset jobs`).toContain(face)
    }
  })

  it('is not a render font', () => {
    // The editor's font menu and the server's render set are the two places a
    // label's face can be chosen from. Inter in either would be a label that
    // previews in one face and prints in another.
    const menu = Object.values(copy.editor.fonts)
    expect(menu.some((name) => /inter/i.test(name))).toBe(false)

    const server = readFileSync(join(ROOT, 'packages/server/src/render/fonts.ts'), 'utf8')
    const families = /FONT_FAMILIES = \{([^}]*)\}/.exec(server)
    expect(families).not.toBeNull()
    expect(families![1]).not.toMatch(/Inter/)
  })
})
