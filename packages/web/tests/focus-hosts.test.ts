/**
 * A rule about focus rings, checked by reading the source.
 *
 * Two containers carry `tabIndex={-1}`, and neither is a control: they exist so
 * that Ctrl+Z, Delete and the clipboard shortcuts have somewhere to be heard.
 * `tabIndex={-1}` means Tab never lands on them, so their focus ring can only
 * ever appear as a surprise.
 *
 * And it did. Clicking inside the designer focuses the nearest focusable
 * ancestor — that container. The click is mouse-driven, so nothing is drawn.
 * Then Delete arrives, the browser switches to keyboard modality, and
 * `:focus-visible` starts matching an element that fills the page: a white box
 * around the whole design area, appearing on a keystroke that had nothing to do
 * with focus.
 *
 * Checked statically because it cannot be checked any other way: happy-dom
 * performs no layout and paints nothing, so a focus ring is invisible to the
 * DOM tests. The constitution bars component tests from asserting class names;
 * this is the same exception `scroll-regions.test.ts` already relies on.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../src', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return path.endsWith('.tsx') ? [path] : []
  })
}

/**
 * Every element that declares `tabIndex={-1}`, as its whole opening tag.
 *
 * JSX puts the attributes on separate lines, so the tag is read from `<` to the
 * `>` that closes it rather than by a single-line match.
 */
function focusHosts(): Array<{ file: string; tag: string }> {
  return sourceFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    const found: Array<{ file: string; tag: string }> = []
    for (let at = source.indexOf('tabIndex={-1}'); at !== -1; at = source.indexOf('tabIndex={-1}', at + 1)) {
      const open = source.lastIndexOf('<', at)
      const close = source.indexOf('>', at)
      if (open !== -1 && close !== -1) {
        found.push({ file: file.slice(SRC.length + 1), tag: source.slice(open, close + 1) })
      }
    }
    return found
  })
}

describe('containers that exist only to hear keystrokes', () => {
  const hosts = focusHosts()

  it('finds them, so an empty pass cannot look like a passing one', () => {
    expect(hosts.length).toBeGreaterThan(0)
  })

  it.each(hosts)('$file suppresses its focus ring', ({ tag }) => {
    expect(
      /\boutline-none\b/.test(tag),
      'A tabIndex={-1} container is unreachable by Tab, so this ring is never ' +
        'navigation feedback — it is a box that appears around the page the ' +
        'first time somebody presses a key. Add `focus:outline-none`.',
    ).toBe(true)
  })
})
