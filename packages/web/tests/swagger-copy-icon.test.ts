/**
 * The premise behind packages/web/src/pages/api-docs.css, and its expiry date.
 *
 * That file corrects a Swagger UI 5.32 defect: the copy button carries an
 * inline `<svg>` while the stylesheet still paints the same clipboard on it as
 * a background image. What the correction *does* is measured next door, in
 * swagger-copy-icon.dom.test.tsx, against the real markup and the real sheets.
 *
 * What is checked here is the part a rendered page cannot tell you: that the
 * upstream fault is still there. A workaround for a bug that has since been
 * fixed is worse than no workaround — it goes on suppressing something nobody
 * remembers, and nothing ever asks whether it should. So the day this fails,
 * the answer is to delete the CSS file, not to update the test.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

const vendorCss = read('node_modules/swagger-ui-react/swagger-ui.css')
/**
 * Comments stripped, because the file explains itself at length and the first
 * version of the assertion below was happily matching the prose that says
 * `:has(> svg)` rather than the rule that uses it. Deleting the scoping left
 * the test green.
 */
const overrideCss = read('packages/web/src/pages/api-docs.css').replace(/\/\*[\s\S]*?\*\//g, '')
const page = read('packages/web/src/pages/api-docs-page.tsx')

/** The vendor rule that paints the second clipboard, outside any media query. */
const backgroundIconRule = vendorCss
  .split('}')
  .map((chunk) => `${chunk}}`)
  .find((rule) => rule.startsWith('.swagger-ui .copy-to-clipboard button{'))

describe('the upstream fault', () => {
  it('is still there: swagger paints a clipboard as the button background', () => {
    expect(backgroundIconRule).toBeDefined()
    expect(backgroundIconRule).toContain('background:url(')
  })

  it('is still under the selector the DOM test re-states', () => {
    // That test cannot use the vendor's real declaration — a 900-character
    // escaped data URI that happy-dom will not parse — so it restates the
    // selector with a readable value. This keeps the two in step.
    expect(vendorCss).toContain('.swagger-ui .copy-to-clipboard button{')
  })
})

describe('the correction', () => {
  it('switches itself off if the inline icon ever goes away', () => {
    // `:has(> svg)` is load-bearing, not decoration: without it, a future
    // swagger that drops the inline icon would leave this file turning the
    // button into a blank grey square. Asserted on the source because the
    // condition it guards against is one that cannot be rendered today.
    expect(overrideCss).toMatch(/:has\(\s*>\s*svg\s*\)/)
  })

  it('rides in the same lazy chunk as swagger itself', () => {
    // A megabyte of console that nobody printing labels opens. The correction
    // must not drag itself into the first paint either.
    expect(page).toMatch(/lazy\(async/)
    expect(page).toContain('./api-docs.css')
  })

  it('is imported after the vendor stylesheet', () => {
    // It wins on specificity regardless, but a sheet that corrects another one
    // and loads before it is a trap for whoever edits it next.
    const vendor = page.indexOf('swagger-ui-react/swagger-ui.css')
    const override = page.indexOf('./api-docs.css')
    expect(vendor).toBeGreaterThan(-1)
    expect(override).toBeGreaterThan(vendor)
  })
})
