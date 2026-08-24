/**
 * The clipboard button on the API console, drawn once.
 *
 * Swagger UI 5.32 renders the copy button as `<button><svg/></button>` *and*
 * paints the same clipboard on that button as a CSS background image. Both are
 * white and the inline one carries `translate(2, -1)`, so the two land a couple
 * of pixels apart and the icon reads as a ghost of itself.
 *
 * The inline icon has a second consequence. The button is a flex item, and
 * `min-width: auto` will not let a flex item shrink below its content — which
 * was nothing while the button was empty and is now an svg. So it pushes out of
 * the 24px box it lives in, over the expand arrow beside it, and the box (which
 * collapses to width 0 until the row is hovered) stops hiding anything.
 *
 * Vitest does not process stylesheet imports, so the two sheets are put into
 * the document by hand and the cascade is asserted on the real markup. The last
 * test in each block mounts *without* the override, so what is being measured
 * is the override rather than the default.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import SwaggerUI from 'swagger-ui-react'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const VENDOR = 'node_modules/swagger-ui-react/swagger-ui.css'
const OVERRIDE = 'packages/web/src/pages/api-docs.css'

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'probe', version: '1' },
  paths: { '/api/printers': { get: { responses: { 200: { description: 'ok' } } } } },
}

/**
 * The vendor's own selector for the background icon.
 *
 * Its real declaration is a 900-character escaped data URI that happy-dom
 * gives up on and reports as an empty string — which would let "no background
 * image" pass for the wrong reason entirely. The *selector* is what these
 * tests are about, so it is taken from the stylesheet verbatim and re-stated
 * below with a value that can be read back.
 */
const VENDOR_SELECTOR = '.swagger-ui .copy-to-clipboard button'

function addStylesheet(path: string): void {
  addRule(readFileSync(join(root, path), 'utf8'))
}

function addRule(css: string): void {
  const el = document.createElement('style')
  el.textContent = css
  document.head.appendChild(el)
}

/** The console with its own stylesheet, and optionally ours on top of it. */
async function mount(withOverride: boolean): Promise<{ button: Element; wrapper: Element }> {
  addStylesheet(VENDOR)
  addRule(`${VENDOR_SELECTOR}{background:url(clipboard.svg) 50% no-repeat}`)
  if (withOverride) {
    addStylesheet(OVERRIDE)
  }
  render(<SwaggerUI spec={SPEC} />)
  const button = await waitFor(() => {
    const found = document.querySelector('.copy-to-clipboard button')
    expect(found).not.toBeNull()
    return found!
  })
  return { button, wrapper: button.parentElement! }
}

afterEach(() => {
  cleanup()
  document.head.querySelectorAll('style').forEach((el) => el.remove())
})

describe('the icon', () => {
  it('is in the markup as an element', async () => {
    const { button } = await mount(true)
    expect(button.querySelectorAll(':scope > svg')).toHaveLength(1)
  })

  it('is not also painted as a background', async () => {
    const { button } = await mount(true)
    expect(getComputedStyle(button).backgroundImage).toBe('none')
  })

  it('is painted twice without the override — the fault, held still', async () => {
    const { button } = await mount(false)
    expect(button.querySelectorAll(':scope > svg')).toHaveLength(1)
    expect(getComputedStyle(button).backgroundImage).toContain('url(')
  })

  it('is overridden on specificity, not on which sheet loaded last', async () => {
    // The vendor rule re-stated *after* ours, which is the arrangement a lazy
    // chunk could hand us. It still loses.
    addStylesheet(OVERRIDE)
    addRule(`${VENDOR_SELECTOR}{background:url(clipboard.svg) 50% no-repeat}`)
    render(<SwaggerUI spec={SPEC} />)
    const button = await waitFor(() => document.querySelector('.copy-to-clipboard button')!)
    expect(getComputedStyle(button).backgroundImage).toBe('none')
  })
})

describe('the space it takes', () => {
  it('sits between the summary and the expand arrow', async () => {
    // Which is why overflowing its box lands it on the arrow rather than in
    // empty space.
    const { wrapper } = await mount(true)
    expect(wrapper.nextElementSibling?.className).toContain('opblock-control-arrow')
  })

  it('may be narrower than its icon, so it stays inside its box', async () => {
    const { button } = await mount(true)
    expect(getComputedStyle(button).minWidth).toBe('0')
    expect(getComputedStyle(button).padding).toBe('0px')
  })

  it('is clipped by the box that closes to nothing', async () => {
    const { wrapper } = await mount(true)
    const style = getComputedStyle(wrapper)
    // Not hovered: zero wide, and now actually hiding what is inside it.
    expect(style.width).toBe('0px')
    expect(style.overflow).toBe('hidden')
  })

  it('is unclipped and unshrinkable without the override', async () => {
    const { button, wrapper } = await mount(false)
    expect(getComputedStyle(wrapper).overflow).not.toBe('hidden')
    expect(getComputedStyle(button).minWidth).not.toBe('0')
  })
})
